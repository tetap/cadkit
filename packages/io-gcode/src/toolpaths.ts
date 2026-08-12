import {
  resolveLayerGcode,
  type Layer,
  type LayerGcodeParams,
} from '@cadkit/document'
import {
  entityToOffsetContours,
  entityWorldBounds,
  resolveWorldMatrix,
  tessellateArc,
  transformPoint,
  type OffsetContour,
} from '@cadkit/geometry'
import type { Entity, EntityId, LayerId, Vec2 } from '@cadkit/types'
import { emptyAABB, expandAABB, isValidAABB } from '@cadkit/types'
import { hatchPolygon, type HatchSegment } from './hatch.js'
import { optimizePathOrder } from './optimize-order.js'

export interface GcodeExportOptions {
  /** Travel (laser off) feed mm/min. Default 3000. */
  travelSpeed?: number
  /** Flip Y so machine origin is bottom-left (CAD is Y-down). Default true. */
  flipY?: boolean
  /** Decimal places for coordinates. Default 3. */
  decimals?: number
  /** Emit M3 (spindle/laser CW). Use M4 for some diode firmwares. */
  laserOn?: string
  laserOff?: string
  /** Header comment. */
  title?: string
  /**
   * Minimize empty travel (chain + NN + 2-opt, closed-loop entry).
   * Default true. Cut geometry length is unchanged — only order/direction.
   */
  optimizeOrder?: boolean
  /** Tool start / home in CAD space before first cut. Default {0,0}. */
  start?: Vec2
}

export interface GcodeExportInput {
  entities: readonly Entity[]
  layers: readonly Layer[]
  /** Optional entity lookup for nested groups / world matrices. */
  getEntity?: (id: EntityId) => Entity | undefined
}

/** One continuous cut polyline in CAD/document space (Y-down, matches canvas). */
export interface GcodeCutPath {
  points: Vec2[]
  layerId: LayerId
  layerName: string
  feed: number
  power: number
  /** Path length in document units (mm). */
  length: number
}

/** Rapid move between cuts (laser off). */
export interface GcodeTravel {
  from: Vec2
  to: Vec2
  feed: number
  length: number
}

export type GcodeMotion =
  | { kind: 'travel'; travel: GcodeTravel; startDist: number; endDist: number }
  | { kind: 'cut'; path: GcodeCutPath; startDist: number; endDist: number }

export interface GcodeToolpathPlan {
  /** Machine-space motions in run order (travels + cuts). */
  motions: GcodeMotion[]
  /** Cut paths only (same order as executed). */
  cuts: GcodeCutPath[]
  /** Total path length including travels. */
  totalLength: number
  /** Cut-only length. */
  cutLength: number
  travelSpeed: number
  flipY: boolean
  yBase: number
  decimals: number
  laserOn: string
  laserOff: string
  title?: string
}

/**
 * Build optimized GRBL toolpaths from document geometry.
 * Geometry sources match canvas contours (`entityToOffsetContours`);
 * fill layers use hatch; line layers stroke outlines.
 */
export function buildToolpaths(
  input: GcodeExportInput,
  options: GcodeExportOptions = {},
): GcodeToolpathPlan {
  const travelSpeed = options.travelSpeed ?? 3000
  const flipY = options.flipY !== false
  const decimals = options.decimals ?? 3
  const laserOn = options.laserOn ?? 'M3'
  const laserOff = options.laserOff ?? 'M5'
  const doOptimize = options.optimizeOrder !== false
  const home = options.start ?? { x: 0, y: 0 }
  const lookup = input.getEntity ?? ((id: EntityId) => input.entities.find((e) => e.id === id))

  const layerById = new Map<LayerId, Layer>()
  for (const l of input.layers) layerById.set(l.id, l)

  const byLayer = new Map<LayerId, Entity[]>()
  for (const e of input.entities) {
    if (e.type === 'group' || e.type === 'image') continue
    if (e.style.visible === false) continue
    const layer = layerById.get(e.layerId)
    if (layer && layer.visible === false) continue
    // Image layers never contribute vector cuts.
    if (resolveLayerGcode(layer).mode === 'image') continue
    const list = byLayer.get(e.layerId) ?? []
    list.push(e)
    byLayer.set(e.layerId, list)
  }

  const docBox = emptyAABB()
  for (const e of input.entities) {
    if (e.type === 'group' || e.style.visible === false) continue
    const m = resolveWorldMatrix(e, lookup)
    const b = entityWorldBounds(e, m)
    if (isValidAABB(b)) {
      expandAABB(docBox, b.minX, b.minY)
      expandAABB(docBox, b.maxX, b.maxY)
    }
  }
  const yBase = isValidAABB(docBox) ? docBox.maxY : 0

  const cuts: GcodeCutPath[] = []
  /** Carry tool position across layers so the next layer starts near where the last ended. */
  let cursor: Vec2 = { ...home }
  const orderedLayers = [...input.layers].reverse()
  const seen = new Set<LayerId>()
  for (const layer of orderedLayers) {
    const ents = byLayer.get(layer.id)
    if (!ents?.length) continue
    seen.add(layer.id)
    cursor = appendLayerCuts(layer, ents, resolveLayerGcode(layer), cursor)
  }
  for (const [layerId, ents] of byLayer) {
    if (seen.has(layerId)) continue
    const layer = layerById.get(layerId) ?? {
      id: layerId,
      name: String(layerId),
      visible: true,
      locked: false,
    }
    cursor = appendLayerCuts(layer, ents, resolveLayerGcode(layer), cursor)
  }

  const motions = planMotions(cuts, travelSpeed, home)
  let cutLength = 0
  for (const m of motions) {
    if (m.kind === 'cut') cutLength += m.path.length
  }
  const totalLength = motions.length ? motions[motions.length - 1]!.endDist : 0

  return {
    motions,
    cuts: motions
      .filter((m): m is Extract<GcodeMotion, { kind: 'cut' }> => m.kind === 'cut')
      .map((m) => m.path),
    totalLength,
    cutLength,
    travelSpeed,
    flipY,
    yBase,
    decimals,
    laserOn,
    laserOff,
    title: options.title,
  }

  function appendLayerCuts(
    layer: Layer,
    ents: Entity[],
    gcode: LayerGcodeParams,
    start: Vec2,
  ): Vec2 {
    if (gcode.mode === 'image') return start
    const raw = collectCadPaths(ents, gcode, lookup)
    // Fill hatch: allow chaining across ~1.25× spacing (serpentine row ends).
    const chainTol =
      gcode.mode === 'fill' ? Math.max(0.05, gcode.lineSpacing * 1.25) : 0.05
    const ordered = doOptimize
      ? optimizePathOrder(raw, { start, chainTolerance: chainTol })
      : raw
    let end = start
    for (let pass = 0; pass < gcode.passes; pass++) {
      // Re-orient each pass from the current tool position.
      const passPaths =
        doOptimize && pass > 0
          ? optimizePathOrder(ordered, { start: end, chainTolerance: chainTol })
          : ordered
      for (const pts of passPaths) {
        if (pts.length < 2) continue
        const length = pathLength(pts)
        if (length < 1e-9) continue
        cuts.push({
          points: pts,
          layerId: layer.id,
          layerName: layer.name,
          feed: gcode.speed,
          power: gcode.power,
          length,
        })
        end = pts[pts.length - 1]!
      }
    }
    return end
  }
}

function collectCadPaths(
  ents: Entity[],
  gcode: LayerGcodeParams,
  lookup: (id: EntityId) => Entity | undefined,
): Vec2[][] {
  const out: Vec2[][] = []
  for (const e of ents) {
    // Pie / wedge fill: close through center so hatch matches filled canvas.
    if (gcode.mode === 'fill' && (e.type === 'arc' || (e.type === 'ellipse' && !isFullEllipse(e)))) {
      const pie = entityPieRing(e, lookup)
      if (pie) {
        pushFillRing(out, pie, gcode)
        continue
      }
    }
    const contours = entityToOffsetContours(e, lookup)
    if (gcode.mode === 'line') {
      for (const c of contours) {
        const pts = closedRing(c)
        if (pts.length >= 2) out.push(pts)
      }
      continue
    }
    for (const c of contours) {
      if (!c.closed || c.points.length < 3) {
        const pts = closedRing(c)
        if (pts.length >= 2) out.push(pts)
        continue
      }
      pushFillRing(out, dedupe(c.points), gcode)
      for (const hole of c.holes ?? []) {
        const h = closedRing({ points: hole, closed: true })
        if (h.length >= 2) out.push(h)
      }
    }
  }
  return out
}

function pushFillRing(out: Vec2[][], ring: Vec2[], gcode: LayerGcodeParams): void {
  if (ring.length < 3) return
  const spacing = gcode.lineSpacing
  const angleRad = ((gcode.fillAngle ?? 0) * Math.PI) / 180
  const segs: HatchSegment[] = []
  if (gcode.fillStyle === 'crossHatch') {
    // Primary direction + orthogonal pass → rotatable cross / grid fill.
    segs.push(...hatchPolygon(ring, spacing, angleRad))
    segs.push(...hatchPolygon(ring, spacing, angleRad + Math.PI / 2))
  } else {
    // bidirectional: hatchPolygon already alternates row direction.
    segs.push(...hatchPolygon(ring, spacing, angleRad))
  }
  for (const s of segs) out.push([s.a, s.b])
}

function isFullEllipse(e: Extract<Entity, { type: 'ellipse' }>): boolean {
  let sweep = e.endAngle - e.startAngle
  while (sweep <= 0) sweep += Math.PI * 2
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2
  return sweep >= Math.PI * 2 - 1e-3
}

function entityPieRing(
  entity: Entity,
  lookup: (id: EntityId) => Entity | undefined,
): Vec2[] | null {
  const m = resolveWorldMatrix(entity, lookup)
  const xf = (p: Vec2) => transformPoint(m, p)
  if (entity.type === 'arc') {
    const rim = tessellateArc(
      entity.center,
      entity.radius,
      entity.startAngle,
      entity.endAngle,
      0.5,
      0.25,
    )
    if (rim.length < 2) return null
    return dedupe([xf(entity.center), ...rim.map(xf), xf(entity.center)])
  }
  if (entity.type === 'ellipse') {
    let sweep = entity.endAngle - entity.startAngle
    while (sweep <= 0) sweep += Math.PI * 2
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2
    const n = Math.max(16, Math.ceil(48 * (sweep / (Math.PI * 2))))
    const cosR = Math.cos(entity.rotation)
    const sinR = Math.sin(entity.rotation)
    const rim: Vec2[] = []
    for (let i = 0; i <= n; i++) {
      const a = entity.startAngle + (sweep * i) / n
      const lx = entity.radiusX * Math.cos(a)
      const ly = entity.radiusY * Math.sin(a)
      rim.push({
        x: entity.center.x + lx * cosR - ly * sinR,
        y: entity.center.y + lx * sinR + ly * cosR,
      })
    }
    return dedupe([xf(entity.center), ...rim.map(xf), xf(entity.center)])
  }
  return null
}

function planMotions(
  cuts: GcodeCutPath[],
  travelSpeed: number,
  home: Vec2 = { x: 0, y: 0 },
): GcodeMotion[] {
  if (!cuts.length) return []
  const motions: GcodeMotion[] = []
  let cursor: Vec2 = { ...home }
  let dist = 0
  let first = true
  for (const path of cuts) {
    const start = path.points[0]!
    const gap = Math.hypot(cursor.x - start.x, cursor.y - start.y)
    if (gap > 1e-6) {
      const travel: GcodeTravel = {
        from: first ? { ...home } : cursor,
        to: start,
        feed: travelSpeed,
        length: gap,
      }
      motions.push({ kind: 'travel', travel, startDist: dist, endDist: dist + gap })
      dist += gap
    }
    first = false
    motions.push({ kind: 'cut', path, startDist: dist, endDist: dist + path.length })
    dist += path.length
    cursor = path.points[path.points.length - 1]!
  }
  return motions
}

function pathLength(pts: readonly Vec2[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    len += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return len
}

function dedupe(points: readonly Vec2[], eps = 1e-9): Vec2[] {
  if (!points.length) return []
  const out: Vec2[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const prev = out[out.length - 1]!
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p)
  }
  return out
}

function closedRing(c: OffsetContour): Vec2[] {
  const pts = dedupe(c.points)
  if (pts.length < 2) return pts
  if (c.closed) {
    const a = pts[0]!
    const b = pts[pts.length - 1]!
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-9) pts.push({ ...a })
  }
  return pts
}

/** Sample plan at progress t∈[0,1] for preview coloring. */
export function samplePlanProgress(
  plan: GcodeToolpathPlan,
  t: number,
): { done: Vec2[][]; remaining: Vec2[][] } {
  const target = Math.max(0, Math.min(1, t)) * plan.totalLength
  const done: Vec2[][] = []
  const remaining: Vec2[][] = []
  for (const m of plan.motions) {
    if (m.kind === 'travel') continue
    const { path, startDist, endDist } = m
    if (endDist <= target + 1e-9) {
      done.push(path.points)
      continue
    }
    if (startDist >= target - 1e-9) {
      remaining.push(path.points)
      continue
    }
    const local = target - startDist
    const split = splitPolylineAtLength(path.points, local)
    if (split.before.length >= 2) done.push(split.before)
    if (split.after.length >= 2) remaining.push(split.after)
  }
  return { done, remaining }
}

function splitPolylineAtLength(
  points: readonly Vec2[],
  length: number,
): { before: Vec2[]; after: Vec2[] } {
  if (length <= 0) return { before: [], after: points.map((p) => ({ ...p })) }
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (acc + seg >= length - 1e-12) {
      const u = seg < 1e-12 ? 0 : (length - acc) / seg
      const mid = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
      return {
        before: [...points.slice(0, i).map((p) => ({ ...p })), mid],
        after: [mid, ...points.slice(i).map((p) => ({ ...p }))],
      }
    }
    acc += seg
  }
  return { before: points.map((p) => ({ ...p })), after: [] }
}

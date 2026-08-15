import type { ControlHandle } from './handles.js'
import { worldToEntityLocal } from './handles.js'
import type { Entity, EntityId, PolylineEntity, Vec2 } from '@cadkit/types'
import {
  buildStarPath,
  parseRectCornerId,
  pointsAABB,
  rectCornerRadiusFromLocal,
  slideArcTextOnCircle,
  starCenter,
  starConstructionRadius,
  starCornerFromHandleX,
  starTipsFromDelta,
  starTipsFromHandleY,
  tessellateRoundedRect,
  translate,
  updateArcTextPath,
  type EntityLookup,
  type RectCornerId,
} from '@cadkit/geometry'
import { transformEntityPatch, worldDeltaToParentLocal } from './selection-transform.js'
import { parsePathVertexHandleId, type PathVertexRef } from './path-vertex.js'

const FULL_CIRCLE = Math.PI * 2 - 1e-3

function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2)
  if (x < 0) x += Math.PI * 2
  return x
}

function sweepAbs(start: number, end: number): number {
  let s = end - start
  while (s <= 0) s += Math.PI * 2
  while (s > Math.PI * 2) s -= Math.PI * 2
  return s
}

export type { PathVertexRef } from './path-vertex.js'

/** Translate entity by world delta; nested entities convert into parent-local space. */
export function translateEntityPatch(
  entity: Entity,
  dx: number,
  dy: number,
  lookup?: (id: EntityId) => Entity | undefined,
): Partial<Entity> | null {
  if (dx === 0 && dy === 0) return null
  const world = translate(dx, dy)
  const local = lookup ? worldDeltaToParentLocal(entity, world, lookup) : world
  return transformEntityPatch(entity, local)
}

/** Drag sensitivity for arc-text radius handle (1 = 1:1 with pointer). */
export const ARC_TEXT_RADIUS_SENSITIVITY = 0.55

/**
 * Remove polyline vertices (outer and/or holes). Returns `'remove'` when the outer
 * ring would have too few points (open < 2, closed < 3). Hole rings with fewer
 * than 3 points after deletion are dropped.
 */
export function removePolylineVertices(
  entity: PolylineEntity,
  refs: Iterable<number | PathVertexRef>,
): Partial<Entity> | 'remove' | null {
  const outerRemove = new Set<number>()
  const holeRemove = new Map<number, Set<number>>()
  for (const raw of refs) {
    const ref: PathVertexRef =
      typeof raw === 'number' ? { holeIndex: null, pointIndex: raw } : raw
    if (ref.holeIndex === null) {
      if (
        Number.isInteger(ref.pointIndex) &&
        ref.pointIndex >= 0 &&
        ref.pointIndex < entity.points.length
      ) {
        outerRemove.add(ref.pointIndex)
      }
      continue
    }
    const ring = entity.holes?.[ref.holeIndex]
    if (!ring) continue
    if (
      Number.isInteger(ref.pointIndex) &&
      ref.pointIndex >= 0 &&
      ref.pointIndex < ring.length
    ) {
      let set = holeRemove.get(ref.holeIndex)
      if (!set) {
        set = new Set()
        holeRemove.set(ref.holeIndex, set)
      }
      set.add(ref.pointIndex)
    }
  }
  if (outerRemove.size === 0 && holeRemove.size === 0) return null

  const points = entity.points.filter((_, i) => !outerRemove.has(i))
  const minPts = entity.closed ? 3 : 2
  if (points.length < minPts) return 'remove'

  let holes = entity.holes?.map((h) => h.map((p) => ({ x: p.x, y: p.y })))
  if (holes && holeRemove.size) {
    holes = holes
      .map((h, hi) => {
        const rem = holeRemove.get(hi)
        return rem ? h.filter((_, i) => !rem.has(i)) : h
      })
      .filter((h) => h.length >= 3)
  }

  if (entity.holes?.length || holeRemove.size) {
    // Use `[]` (not `undefined`) so patch merge/coalesce reliably clears holes.
    return {
      points,
      holes: holes && holes.length > 0 ? holes : [],
    } as Partial<Entity>
  }
  return { points } as Partial<Entity>
}

export interface HandleEditOptions {
  /** Pointer world position at drag start (for dampened radius edits). */
  startWorld?: Vec2
  /** Arc-circle center in entity-local space at drag start. */
  startCenter?: Vec2
  /** Path radius frozen at drag start. */
  startRadius?: number
  /** Multiplier applied to pointer delta; defaults to {@link ARC_TEXT_RADIUS_SENSITIVITY}. */
  sensitivity?: number
  /** Frozen star construction frame for tips / corner handle drags. */
  starDrag?: {
    cx: number
    cy: number
    outerR: number
    tips: number
    corner: number
  }
  /** Frozen rect construction box for corner-radius handle drags. */
  rectDrag?: {
    minX: number
    minY: number
    maxX: number
    maxY: number
    cornerId: RectCornerId
    /** Visual pad used when placing the handle (world units). */
    pad: number
    /** Snapshot of shape.cornerRadii at drag start. */
    cornerRadii: number | readonly [number, number, number, number]
  }
  /** Frozen angles for circle/arc/ellipse parametric handle drags. */
  arcDrag?: {
    startAngle: number
    endAngle: number
  }
}

function ellipseParamAngle(
  center: Vec2,
  radiusX: number,
  radiusY: number,
  rotation: number,
  local: Vec2,
): number {
  const dx = local.x - center.x
  const dy = local.y - center.y
  const c = Math.cos(-rotation)
  const s = Math.sin(-rotation)
  const lx = dx * c - dy * s
  const ly = dx * s + dy * c
  return Math.atan2(ly / Math.max(radiusY, 1e-9), lx / Math.max(radiusX, 1e-9))
}

/**
 * Apply control-handle drag. `world` is the pointer in world space; nested
 * entities convert into local geometry before writing start/end/center/points.
 */
export function handleEditPatch(
  entity: Entity,
  handle: ControlHandle,
  world: Vec2,
  lookup?: EntityLookup,
  opts?: HandleEditOptions,
): Partial<Entity> | null {
  const local = worldToEntityLocal(entity, world, lookup)
  if (entity.type === 'line') {
    if (handle.id.endsWith(':start')) return { start: { x: local.x, y: local.y } } as Partial<Entity>
    if (handle.id.endsWith(':end')) return { end: { x: local.x, y: local.y } } as Partial<Entity>
  }
  if (entity.type === 'circle') {
    if (handle.kind === 'center') return { center: { x: local.x, y: local.y } } as Partial<Entity>
    if (handle.kind === 'radius' || handle.id.endsWith(':radius')) {
      const r = Math.hypot(local.x - entity.center.x, local.y - entity.center.y)
      return { radius: Math.max(1e-6, r) } as Partial<Entity>
    }
    if (handle.id.endsWith(':arc-open')) {
      // Open from the east rim so the wedge grows from a stable start.
      const start = opts?.arcDrag?.startAngle ?? 0
      let end = Math.atan2(local.y - entity.center.y, local.x - entity.center.x)
      if (sweepAbs(start, end) < 1e-3) end = start + 1e-3
      if (sweepAbs(start, end) >= FULL_CIRCLE) return null
      return {
        type: 'arc',
        center: entity.center,
        radius: entity.radius,
        startAngle: start,
        endAngle: end,
      } as Partial<Entity>
    }
  }
  if (entity.type === 'arc') {
    if (handle.kind === 'center') return { center: { x: local.x, y: local.y } } as Partial<Entity>
    // Continue an open gesture after circle→arc conversion (handle id stays :arc-open).
    if (handle.id.endsWith(':arc-open') || handle.id.endsWith(':arc-sweep') || handle.id.endsWith(':arc-end')) {
      const start = opts?.arcDrag?.startAngle ?? entity.startAngle
      let end = Math.atan2(local.y - entity.center.y, local.x - entity.center.x)
      if (sweepAbs(start, end) < 1e-3) end = start + 1e-3
      if (sweepAbs(start, end) >= FULL_CIRCLE) {
        // Snap back to a full circle when the sweep closes.
        return {
          type: 'circle',
          center: entity.center,
          radius: entity.radius,
          startAngle: undefined,
          endAngle: undefined,
        } as Partial<Entity>
      }
      return { startAngle: start, endAngle: end } as Partial<Entity>
    }
    if (handle.id.endsWith(':arc-start')) {
      const prevStart = opts?.arcDrag?.startAngle ?? entity.startAngle
      const prevEnd = opts?.arcDrag?.endAngle ?? entity.endAngle
      const nextStart = Math.atan2(local.y - entity.center.y, local.x - entity.center.x)
      const delta = nextStart - prevStart
      return {
        startAngle: nextStart,
        endAngle: prevEnd + delta,
      } as Partial<Entity>
    }
  }
  if (entity.type === 'ellipse') {
    if (handle.kind === 'center') return { center: { x: local.x, y: local.y } } as Partial<Entity>
    const angle = ellipseParamAngle(
      entity.center,
      entity.radiusX,
      entity.radiusY,
      entity.rotation,
      local,
    )
    if (handle.id.endsWith(':arc-open') || handle.id.endsWith(':arc-sweep')) {
      const start = opts?.arcDrag?.startAngle ?? entity.startAngle
      let end = angle
      if (sweepAbs(start, end) < 1e-3) end = start + 1e-3
      if (sweepAbs(start, end) >= FULL_CIRCLE) {
        return { startAngle: 0, endAngle: Math.PI * 2 } as Partial<Entity>
      }
      return { startAngle: start, endAngle: end } as Partial<Entity>
    }
    if (handle.id.endsWith(':arc-start')) {
      const prevStart = opts?.arcDrag?.startAngle ?? entity.startAngle
      const prevEnd = opts?.arcDrag?.endAngle ?? entity.endAngle
      const delta = angle - prevStart
      return {
        startAngle: angle,
        endAngle: prevEnd + delta,
      } as Partial<Entity>
    }
  }
  if (entity.type === 'polyline' && entity.shape?.kind === 'rect') {
    const cornerId = parseRectCornerId(handle.id)
    if (cornerId) {
      const live = pointsAABB(entity.points)
      const box = opts?.rectDrag ?? live
      const pad = opts?.rectDrag?.pad ?? 0
      const prevRadii = opts?.rectDrag?.cornerRadii ?? entity.shape.cornerRadii ?? 0
      const r = rectCornerRadiusFromLocal(box, cornerId, local, pad)
      // Uniform number stays uniform; tuple updates only the dragged corner.
      let cornerRadii: number | [number, number, number, number]
      if (typeof prevRadii === 'number' || prevRadii == null) {
        cornerRadii = r
      } else {
        const next: [number, number, number, number] = [
          prevRadii[0] ?? 0,
          prevRadii[1] ?? 0,
          prevRadii[2] ?? 0,
          prevRadii[3] ?? 0,
        ]
        const idx = { tl: 0, tr: 1, br: 2, bl: 3 }[cornerId]
        next[idx] = r
        cornerRadii = next
      }
      const shape = { ...entity.shape, cornerRadii }
      return {
        shape,
        points: tessellateRoundedRect(box.minX, box.minY, box.maxX, box.maxY, cornerRadii),
      } as Partial<Entity>
    }
  }
  if (entity.type === 'polyline' && entity.shape?.kind === 'star') {
    const liveTips = entity.shape.points ?? 5
    const liveCorner =
      typeof entity.shape.cornerRadii === 'number'
        ? entity.shape.cornerRadii
        : (entity.shape.cornerRadii?.[0] ?? 0)
    const { cx: liveCx, cy: liveCy } = starCenter(entity.points)
    const liveOuterR = starConstructionRadius(
      entity.points,
      liveCx,
      liveCy,
      liveTips,
      liveCorner,
    )
    const cx = opts?.starDrag?.cx ?? liveCx
    const cy = opts?.starDrag?.cy ?? liveCy
    const outerR = Math.max(1e-6, opts?.starDrag?.outerR ?? liveOuterR)
    if (handle.id.endsWith(':star-tips')) {
      const corner = opts?.starDrag?.corner ?? liveCorner
      const startTips = opts?.starDrag?.tips ?? liveTips
      let tips: number
      if (opts?.starDrag && opts.startWorld) {
        const startLocal = worldToEntityLocal(entity, opts.startWorld, lookup)
        tips = starTipsFromDelta(startTips, outerR, local.y - startLocal.y)
      } else {
        tips = starTipsFromHandleY(cy, outerR, local.y)
      }
      const shape = { ...entity.shape, points: tips, cornerRadii: corner }
      return {
        shape,
        points: buildStarPath(cx, cy, outerR, tips, 0.4, corner),
      } as Partial<Entity>
    }
    if (handle.id.endsWith(':star-corner')) {
      const corner = starCornerFromHandleX(cx, outerR, local.x)
      const tips = opts?.starDrag?.tips ?? liveTips
      const shape = { ...entity.shape, points: tips, cornerRadii: corner }
      return {
        shape,
        points: buildStarPath(cx, cy, outerR, tips, 0.4, corner),
      } as Partial<Entity>
    }
  }
  if (entity.type === 'bezier') {
    const m = /^.*:bez:(\d+)(?::(in|out))?$/.exec(handle.id)
    if (!m) return null
    const i = Number(m[1])
    const which = m[2] as 'in' | 'out' | undefined
    const pts = entity.points.map((p) => ({ x: p.x, y: p.y }))
    if (pts.length < 4 || (pts.length - 1) % 3 !== 0) return null
    const segs = (pts.length - 1) / 3
    const n = entity.closed ? segs : segs + 1
    if (i < 0 || i >= n) return null
    if (!which) {
      const pi = Math.min(i * 3, pts.length - 1)
      const prev = pts[pi]!
      const dx = local.x - prev.x
      const dy = local.y - prev.y
      pts[pi] = { x: local.x, y: local.y }
      if (i < segs) {
        const ho = pts[i * 3 + 1]!
        pts[i * 3 + 1] = { x: ho.x + dx, y: ho.y + dy }
      }
      if (i > 0) {
        const hi = pts[i * 3 - 1]!
        pts[i * 3 - 1] = { x: hi.x + dx, y: hi.y + dy }
      } else if (entity.closed && segs >= 1) {
        const hi = pts[pts.length - 2]!
        pts[pts.length - 2] = { x: hi.x + dx, y: hi.y + dy }
        pts[pts.length - 1] = { x: local.x, y: local.y }
      }
      return { points: pts } as Partial<Entity>
    }
    if (which === 'out' && i < segs) {
      pts[i * 3 + 1] = { x: local.x, y: local.y }
      return { points: pts } as Partial<Entity>
    }
    if (which === 'in') {
      if (i > 0) pts[i * 3 - 1] = { x: local.x, y: local.y }
      else if (entity.closed) pts[pts.length - 2] = { x: local.x, y: local.y }
      else return null
      return { points: pts } as Partial<Entity>
    }
    return null
  }
  if (entity.type === 'polyline' && handle.kind === 'endpoint') {
    const ref = parsePathVertexHandleId(handle.id)
    if (!ref) return null
    if (ref.holeIndex === null) {
      if (ref.pointIndex < 0 || ref.pointIndex >= entity.points.length) return null
      const points = entity.points.map((p, i) =>
        i === ref.pointIndex ? { x: local.x, y: local.y } : p,
      )
      return { points } as Partial<Entity>
    }
    const srcHoles = entity.holes
    if (!srcHoles || !srcHoles[ref.holeIndex]) return null
    const ring = srcHoles[ref.holeIndex]!
    if (ref.pointIndex < 0 || ref.pointIndex >= ring.length) return null
    const holes = srcHoles.map((h, hi) =>
      hi === ref.holeIndex
        ? h.map((p, i) => (i === ref.pointIndex ? { x: local.x, y: local.y } : p))
        : h.map((p) => ({ x: p.x, y: p.y })),
    )
    return { holes } as Partial<Entity>
  }
  if (entity.type === 'text' && entity.path?.kind === 'arc') {
    if (handle.kind === 'center' || handle.id.endsWith(':arc-center')) {
      return { position: { x: local.x, y: local.y } } as Partial<Entity>
    }
    if (
      handle.kind === 'angle' ||
      handle.appearance === 'arc-angle' ||
      handle.id.endsWith(':arc-angle')
    ) {
      const midAngle = Math.atan2(local.y - entity.position.y, local.x - entity.position.x)
      const placed = slideArcTextOnCircle(entity, midAngle)
      return { path: placed.path } as Partial<Entity>
    }
    if (handle.kind === 'radius' || handle.id.endsWith(':arc-radius')) {
      const sensitivity = opts?.sensitivity ?? ARC_TEXT_RADIUS_SENSITIVITY
      const startWorld = opts?.startWorld
      const startCenter = opts?.startCenter ?? entity.position
      const startRadius = opts?.startRadius ?? entity.path.radius
      let radius: number
      if (startWorld) {
        // Distances against the frozen drag-start center — `updateArcTextPath`
        // moves `entity.position` each frame to keep the string midpoint fixed.
        const startLocal = worldToEntityLocal(entity, startWorld, lookup)
        const startDist = Math.hypot(startLocal.x - startCenter.x, startLocal.y - startCenter.y)
        const curDist = Math.hypot(local.x - startCenter.x, local.y - startCenter.y)
        radius = Math.max(1e-3, startRadius + (curDist - startDist) * sensitivity)
      } else {
        const layoutR = Math.hypot(local.x - entity.position.x, local.y - entity.position.y)
        const baseline = entity.path.baseline ?? 'outer'
        radius =
          baseline === 'inner'
            ? Math.max(1e-3, layoutR + entity.fontSize)
            : Math.max(1e-3, layoutR)
      }
      const placed = updateArcTextPath(entity, { radius })
      return { position: placed.position, path: placed.path } as Partial<Entity>
    }
  }
  return null
}

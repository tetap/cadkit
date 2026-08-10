import {
  areaD,
  inflatePathsD,
  EndType,
  JoinType,
  type PathD,
  type PathsD,
} from 'clipper2-ts'
import type { Entity, EntityId, Vec2 } from '@cadkit/types'
import { entityWorldBounds } from './bounds.js'
import { transformPoint, type Matrix3 } from './matrix.js'
import { tessellateArc, tessellateCubicChain } from './tessellate.js'
import { textEntityToLocalOutlines } from './text-outlines.js'
import { resolveWorldMatrix, type EntityLookup } from './world-matrix.js'

export type OffsetDirection = 'external' | 'inner'
export type OffsetJoin = 'miter' | 'round' | 'bevel'

export interface OffsetOptions {
  /** World-unit distance (mm when document unit is mm). */
  distance: number
  direction?: OffsetDirection
  join?: OffsetJoin
  /** Keep only outer rings (drop hole loops). */
  outerShapesOnly?: boolean
  /**
   * Clipper decimal precision (digits after decimal). Higher = smoother, slower.
   * Default 4 (~0.0001 world unit).
   */
  precision?: number
  /** Arc segments quality for round joins / curve tessellation. */
  arcTolerance?: number
}

export interface OffsetContour {
  points: Vec2[]
  closed: boolean
}

const JOIN_MAP: Record<OffsetJoin, JoinType> = {
  miter: JoinType.Miter,
  round: JoinType.Round,
  bevel: JoinType.Bevel,
}

function dedupeClose(points: Vec2[], eps = 1e-9): Vec2[] {
  if (points.length === 0) return []
  const out: Vec2[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const prev = out[out.length - 1]!
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p)
  }
  return out
}

function toPathD(points: Vec2[]): PathD {
  return points.map((p) => ({ x: p.x, y: p.y }))
}

function fromPathD(path: PathD): Vec2[] {
  return path.map((p) => ({ x: p.x, y: p.y }))
}

function sampleEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  segments: number,
): Vec2[] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const pts: Vec2[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const lx = rx * Math.cos(a)
    const ly = ry * Math.sin(a)
    pts.push({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos })
  }
  return pts
}

function transformContour(points: Vec2[], m: Matrix3): Vec2[] {
  return points.map((p) => transformPoint(m, p))
}

function boundsRect(entity: Entity, m: Matrix3): OffsetContour | null {
  const box = entityWorldBounds(entity, m)
  if (!Number.isFinite(box.minX) || box.maxX - box.minX < 1e-9 || box.maxY - box.minY < 1e-9) {
    return null
  }
  return {
    closed: true,
    points: [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ],
  }
}

/** Extract world-space contours suitable for Clipper offset. */
export function entityToOffsetContours(
  entity: Entity,
  lookup: EntityLookup = () => undefined,
  opts?: { arcTolerance?: number },
): OffsetContour[] {
  const m = resolveWorldMatrix(entity, lookup)
  const tol = Math.max(1e-4, opts?.arcTolerance ?? 0.25)

  switch (entity.type) {
    case 'line':
      return [
        {
          closed: false,
          points: transformContour([entity.start, entity.end], m),
        },
      ]
    case 'polyline': {
      const pts = dedupeClose(transformContour(entity.points, m))
      if (pts.length < 2) return []
      return [{ closed: entity.closed, points: pts }]
    }
    case 'bezier': {
      const sampled = tessellateCubicChain(
        entity.points,
        0.5,
        Math.max(tol, 1e-3),
        !!entity.closed,
      )
      const pts = dedupeClose(transformContour(sampled, m))
      if (pts.length < 2) return []
      return [{ closed: !!entity.closed, points: pts }]
    }
    case 'circle': {
      const segs = Math.max(16, Math.ceil((Math.PI * 2 * entity.radius) / Math.max(tol, 1e-6)))
      const local = sampleEllipse(entity.center.x, entity.center.y, entity.radius, entity.radius, 0, segs)
      return [{ closed: true, points: transformContour(local, m) }]
    }
    case 'ellipse': {
      const avg = (entity.radiusX + entity.radiusY) / 2
      const segs = Math.max(16, Math.ceil((Math.PI * 2 * avg) / Math.max(tol, 1e-6)))
      const local = sampleEllipse(
        entity.center.x,
        entity.center.y,
        entity.radiusX,
        entity.radiusY,
        entity.rotation,
        segs,
      )
      return [{ closed: true, points: transformContour(local, m) }]
    }
    case 'arc': {
      const local = tessellateArc(
        entity.center,
        entity.radius,
        entity.startAngle,
        entity.endAngle,
        0.5,
        Math.max(tol, 1e-3),
      )
      const pts = dedupeClose(transformContour(local, m))
      if (pts.length < 2) return []
      return [{ closed: false, points: pts }]
    }
    case 'text': {
      // Glyph outlines in-place (straight + arc). Never offset the baseline arc.
      const outlines = textEntityToLocalOutlines(entity)
      if (outlines.length) {
        return outlines.map((c) => ({
          closed: true as const,
          points: dedupeClose(transformContour(c.points, m)),
        }))
      }
      const rect = boundsRect(entity, m)
      return rect ? [rect] : []
    }
    case 'image': {
      const rect = boundsRect(entity, m)
      return rect ? [rect] : []
    }
    default:
      return []
  }
}

function filterOuterOnly(paths: PathsD): PathsD {
  if (paths.length <= 1) return paths
  // Clipper: positive area is typically CCW; holes reverse. Keep largest |area| rings
  // that share the sign of the biggest path (outer contour orientation).
  const scored = paths
    .map((path) => ({ path, area: areaD(path) }))
    .filter((p) => Math.abs(p.area) > 1e-12)
  if (!scored.length) return paths
  scored.sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
  const sign = Math.sign(scored[0]!.area) || 1
  return scored.filter((p) => Math.sign(p.area) === sign).map((p) => p.path)
}

/**
 * Offset contours. External uses positive delta; inner uses negative.
 * Closed shapes use Polygon ends; open polylines use Round ends (capsule-like).
 */
export function offsetContours(
  contours: readonly OffsetContour[],
  options: OffsetOptions,
): OffsetContour[] {
  const distance = Math.abs(options.distance)
  if (!(distance > 0) || contours.length === 0) return []

  const direction = options.direction ?? 'external'
  const join = JOIN_MAP[options.join ?? 'round']
  const precision = options.precision ?? 4
  const arcTolerance = options.arcTolerance ?? 0.25
  const signed = direction === 'external' ? distance : -distance

  const closed: PathsD = []
  const open: PathsD = []
  for (const c of contours) {
    const pts = dedupeClose(c.points)
    if (c.closed) {
      if (pts.length < 3) continue
      closed.push(toPathD(pts))
    } else {
      if (pts.length < 2) continue
      open.push(toPathD(pts))
    }
  }

  const out: OffsetContour[] = []

  if (closed.length) {
    let result = inflatePathsD(
      closed,
      signed,
      join,
      EndType.Polygon,
      2,
      precision,
      arcTolerance,
    )
    if (options.outerShapesOnly) result = filterOuterOnly(result)
    for (const path of result) {
      const points = dedupeClose(fromPathD(path))
      if (points.length >= 3) out.push({ points, closed: true })
    }
  }

  if (open.length) {
    // Open path: only external offset is meaningful as a parallel curve band;
    // use Joined for single parallel, Round for stroke-like outline.
    // CAD "offset line" usually wants a parallel open curve → EndType.Butt + positive.
    const delta = direction === 'inner' ? -distance : distance
    const result = inflatePathsD(open, delta, join, EndType.Round, 2, precision, arcTolerance)
    for (const path of result) {
      const points = dedupeClose(fromPathD(path))
      if (points.length >= 2) out.push({ points, closed: true })
    }
  }

  return out
}

/** Convenience: entity → offset contours in world space. */
export function offsetEntity(
  entity: Entity,
  options: OffsetOptions,
  lookup: EntityLookup = () => undefined,
): OffsetContour[] {
  const contours = entityToOffsetContours(entity, lookup, {
    arcTolerance: options.arcTolerance,
  })
  return offsetContours(contours, options)
}

export function offsetEntities(
  entities: readonly Entity[],
  options: OffsetOptions,
  lookup: EntityLookup,
): OffsetContour[] {
  const all: OffsetContour[] = []
  for (const e of entities) {
    all.push(...offsetEntity(e, options, lookup))
  }
  return all
}

export type { EntityId }

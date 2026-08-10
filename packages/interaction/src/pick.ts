import type { AABB, Entity, EntityId, ScreenPoint, WorldPoint } from '@cadkit/types'
import { isValidAABB } from '@cadkit/types'
import type { Camera2D } from '@cadkit/geometry'
import {
  distancePointToCircle,
  distancePointToSegment,
  entityLocalBounds,
  resolveWorldMatrix,
  transformAABB,
  transformPoint,
  type Matrix3,
} from '@cadkit/geometry'
import type { SceneProjector } from '@cadkit/scene'
import type { CadDocument } from '@cadkit/document'

export interface PickContext {
  doc: CadDocument
  camera: Camera2D
  scene: SceneProjector
  /** Screen-pixel pad when inflating thin AABBs (default 6). */
  pixelTolerance?: number
  /** ToolContext carries snap.pixelTolerance — used when pixelTolerance is omitted. */
  snap?: { pixelTolerance?: number }
}

function pointInAABB(p: { x: number; y: number }, box: AABB): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY
}

function inflateAABB(box: AABB, pad: number): AABB {
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  }
}

/** World-space AABB for an entity (local bounds × world matrix). */
export function entityPickBounds(entity: Entity, worldMatrix?: Matrix3): AABB {
  const local = entityLocalBounds(entity)
  return worldMatrix ? transformAABB(local, worldMatrix) : local
}

/**
 * Distance from point to entity stroke geometry in world units.
 * Kept for tests / future geometry-mode tools; selection uses AABB hits.
 */
export function distanceToEntity(entity: Entity, world: WorldPoint, worldMatrix?: Matrix3): number {
  const m = worldMatrix
  const wp = (p: { x: number; y: number }) => (m ? transformPoint(m, p) : p)
  switch (entity.type) {
    case 'line':
      return distancePointToSegment(world, wp(entity.start), wp(entity.end))
    case 'polyline': {
      if (entity.points.length < 2) return Infinity
      let best = Infinity
      for (let i = 0; i + 1 < entity.points.length; i++) {
        best = Math.min(best, distancePointToSegment(world, wp(entity.points[i]!), wp(entity.points[i + 1]!)))
      }
      if (entity.closed && entity.points.length >= 2) {
        best = Math.min(
          best,
          distancePointToSegment(world, wp(entity.points[entity.points.length - 1]!), wp(entity.points[0]!)),
        )
      }
      return best
    }
    case 'circle': {
      const center = wp(entity.center)
      const rim = wp({ x: entity.center.x + entity.radius, y: entity.center.y })
      const r = Math.hypot(rim.x - center.x, rim.y - center.y)
      return distancePointToCircle(world, center, r)
    }
    case 'arc': {
      const center = wp(entity.center)
      const rim = wp({
        x: entity.center.x + entity.radius * Math.cos(entity.startAngle),
        y: entity.center.y + entity.radius * Math.sin(entity.startAngle),
      })
      const r = Math.hypot(rim.x - center.x, rim.y - center.y)
      const rot = m ? Math.atan2(m[1], m[0]) : 0
      const d = distancePointToCircle(world, center, r)
      const ang = Math.atan2(world.y - center.y, world.x - center.x)
      if (!angleInSweep(ang, entity.startAngle + rot, entity.endAngle + rot)) return Infinity
      return d
    }
    case 'ellipse': {
      const center = wp(entity.center)
      const r = Math.max(entity.radiusX, entity.radiusY)
      return distancePointToCircle(world, center, r)
    }
    case 'text':
    case 'image': {
      const box = entityPickBounds(entity, worldMatrix)
      if (!isValidAABB(box)) return Infinity
      const dx = Math.max(box.minX - world.x, 0, world.x - box.maxX)
      const dy = Math.max(box.minY - world.y, 0, world.y - box.maxY)
      return Math.hypot(dx, dy)
    }
    case 'group':
      return Infinity
    default:
      return Infinity
  }
}

function angleInSweep(angle: number, start: number, end: number): boolean {
  const twoPi = Math.PI * 2
  let a = ((angle % twoPi) + twoPi) % twoPi
  let s = ((start % twoPi) + twoPi) % twoPi
  let e = ((end % twoPi) + twoPi) % twoPi
  if (Math.abs(e - s) < 1e-9) return true
  if (s <= e) return a >= s && a <= e
  return a >= s || a <= e
}

/**
 * Pick the topmost entity whose (optionally padded) world AABB contains the point.
 * Stack order: higher scene pickId wins (later-created / upper in draw stack).
 */
export function pickEntity(ctx: PickContext, world: WorldPoint, _screen: ScreenPoint): EntityId | null {
  const zoom = ctx.camera.getState().zoom
  const tolPx = ctx.pixelTolerance ?? ctx.snap?.pixelTolerance ?? 6
  const pad = tolPx / Math.max(zoom, 1e-9)
  const ids = ctx.scene.query({
    minX: world.x - pad,
    minY: world.y - pad,
    maxX: world.x + pad,
    maxY: world.y + pad,
  })

  let best: EntityId | null = null
  let bestOrder = -Infinity

  for (const id of ids) {
    const e = ctx.doc.getEntity(id)
    if (!e || e.style.visible === false || e.style.locked || e.type === 'group') continue
    const m = resolveWorldMatrix(e, (eid) => ctx.doc.getEntity(eid))
    const box = entityPickBounds(e, m)
    if (!isValidAABB(box)) continue
    // Inflate so zero-thickness strokes remain hittable near the line.
    if (!pointInAABB(world, inflateAABB(box, pad))) continue
    const order = ctx.scene.getPickId(id) ?? 0
    if (order >= bestOrder) {
      bestOrder = order
      best = id
    }
  }
  return best
}

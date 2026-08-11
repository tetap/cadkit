import type { Entity, EntityId, ScreenPoint, Vec2, WorldPoint } from '@cadkit/types'
import {
  IDENTITY,
  arcTextLocalBounds,
  arcTextStringMidpoint,
  invert,
  resolveWorldMatrix,
  transformPoint,
  type Camera2D,
  type EntityLookup,
  type Matrix3,
} from '@cadkit/geometry'

export type ScaleCorner = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface ControlHandle {
  id: string
  entityId: EntityId
  kind: 'endpoint' | 'center' | 'radius' | 'scale' | 'rotate' | 'dimension-text' | 'angle'
  world: WorldPoint
  cursor: string
  /** Present when kind === 'scale' */
  scaleCorner?: ScaleCorner
  /** Optional visual variant for the DOM handle overlay. */
  appearance?: 'default' | 'arc-radius' | 'arc-center' | 'arc-angle'
  /** Companion path-circle guide for arc text (world space). */
  arcGuide?: { center: WorldPoint; rim: WorldPoint }
  /** Path-edit: vertex is in the active point selection. */
  selected?: boolean
}

export type HandleActionHandler = (
  handle: ControlHandle,
  world: WorldPoint,
  phase: 'start' | 'move' | 'end',
) => void

function toWorldPoint(m: Matrix3, p: Vec2): WorldPoint {
  const w = transformPoint(m, p)
  return { x: w.x, y: w.y, __space: 'world' }
}

/** Map a world point into the entity's local geometry space (inverse of resolveWorldMatrix). */
export function worldToEntityLocal(
  entity: Entity,
  world: Vec2,
  lookup?: EntityLookup,
): Vec2 {
  if (!lookup) return { x: world.x, y: world.y }
  const m = resolveWorldMatrix(entity, lookup)
  const inv = invert(m)
  if (!inv) return { x: world.x, y: world.y }
  return transformPoint(inv, world)
}

/**
 * Build edit handles for an entity.
 * When `lookup` is provided, handle positions are transformed through the parent
 * group chain so nested children appear at their on-canvas world locations.
 */
export function buildsHandlesForEntity(
  entity: Entity,
  camera: Camera2D,
  lookup?: EntityLookup,
): ControlHandle[] {
  const m = lookup ? resolveWorldMatrix(entity, lookup) : IDENTITY
  const handles: ControlHandle[] = []
  if (entity.type === 'line') {
    handles.push(
      {
        id: `${entity.id}:start`,
        entityId: entity.id,
        kind: 'endpoint',
        world: toWorldPoint(m, entity.start),
        cursor: 'move',
      },
      {
        id: `${entity.id}:end`,
        entityId: entity.id,
        kind: 'endpoint',
        world: toWorldPoint(m, entity.end),
        cursor: 'move',
      },
    )
  } else if (entity.type === 'circle') {
    handles.push({
      id: `${entity.id}:center`,
      entityId: entity.id,
      kind: 'center',
      world: toWorldPoint(m, entity.center),
      cursor: 'move',
    })
    handles.push({
      id: `${entity.id}:radius`,
      entityId: entity.id,
      kind: 'radius',
      world: toWorldPoint(m, { x: entity.center.x + entity.radius, y: entity.center.y }),
      cursor: 'ew-resize',
    })
  } else if (entity.type === 'polyline') {
    entity.points.forEach((p, i) => {
      handles.push({
        id: `${entity.id}:${i}`,
        entityId: entity.id,
        kind: 'endpoint',
        world: toWorldPoint(m, p),
        cursor: 'move',
      })
    })
    entity.holes?.forEach((hole, hi) => {
      hole.forEach((p, i) => {
        handles.push({
          id: `${entity.id}:h${hi}:${i}`,
          entityId: entity.id,
          kind: 'endpoint',
          world: toWorldPoint(m, p),
          cursor: 'move',
        })
      })
    })
  } else if (entity.type === 'text' && entity.path?.kind === 'arc') {
    const fontSize = Math.max(1e-6, entity.fontSize)
    const baseline = entity.path.baseline ?? 'outer'
    const layoutR =
      baseline === 'inner'
        ? Math.max(1e-3, entity.path.radius - fontSize)
        : Math.max(1e-3, entity.path.radius)
    const box = arcTextLocalBounds(
      entity.content,
      fontSize,
      entity.position,
      entity.path,
      entity.widthFactor ?? 1,
      entity.fontFamily || 'sans-serif',
    )
    // Past the glyph AABB right edge so it clears the selection's east scale handle.
    const padWorld = 22 / Math.max(camera.getState().zoom, 1e-9)
    const radiusLocal = {
      x: box.maxX + padWorld,
      y: (box.minY + box.maxY) / 2,
    }
    const arcGuide = {
      center: toWorldPoint(m, entity.position),
      rim: toWorldPoint(m, {
        x: entity.position.x + layoutR,
        y: entity.position.y,
      }),
    }
    handles.push({
      id: `${entity.id}:arc-center`,
      entityId: entity.id,
      kind: 'center',
      world: toWorldPoint(m, entity.position),
      cursor: 'move',
      appearance: 'arc-center',
      arcGuide,
    })
    const mid = arcTextStringMidpoint(entity)
    if (mid) {
      handles.push({
        id: `${entity.id}:arc-angle`,
        entityId: entity.id,
        kind: 'angle',
        world: toWorldPoint(m, mid),
        cursor: 'grab',
        appearance: 'arc-angle',
      })
    }
    handles.push({
      id: `${entity.id}:arc-radius`,
      entityId: entity.id,
      kind: 'radius',
      world: toWorldPoint(m, radiusLocal),
      cursor: 'ew-resize',
      appearance: 'arc-radius',
    })
  }
  return handles
}

export function hitTestHandle(
  handles: ControlHandle[],
  screen: ScreenPoint,
  camera: Camera2D,
  pixelTol = 8,
): ControlHandle | null {
  let best: ControlHandle | null = null
  let bestDist = pixelTol
  for (const h of handles) {
    const s = camera.worldToScreen(h.world)
    const d = Math.hypot(s.x - screen.x, s.y - screen.y)
    if (d <= bestDist) {
      best = h
      bestDist = d
    }
  }
  return best
}

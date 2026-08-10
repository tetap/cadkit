import type { ControlHandle } from './handles.js'
import { worldToEntityLocal } from './handles.js'
import type { Entity, EntityId, Vec2 } from '@cadkit/types'
import { translate, type EntityLookup } from '@cadkit/geometry'
import { transformEntityPatch, worldDeltaToParentLocal } from './selection-transform.js'

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

/**
 * Apply control-handle drag. `world` is the pointer in world space; nested
 * entities convert into local geometry before writing start/end/center/points.
 */
export function handleEditPatch(
  entity: Entity,
  handle: ControlHandle,
  world: Vec2,
  lookup?: EntityLookup,
): Partial<Entity> | null {
  const local = worldToEntityLocal(entity, world, lookup)
  if (entity.type === 'line') {
    if (handle.id.endsWith(':start')) return { start: { x: local.x, y: local.y } } as Partial<Entity>
    if (handle.id.endsWith(':end')) return { end: { x: local.x, y: local.y } } as Partial<Entity>
  }
  if (entity.type === 'circle') {
    if (handle.kind === 'center') return { center: { x: local.x, y: local.y } } as Partial<Entity>
    if (handle.kind === 'radius') {
      const r = Math.hypot(local.x - entity.center.x, local.y - entity.center.y)
      return { radius: Math.max(1e-6, r) } as Partial<Entity>
    }
  }
  if (entity.type === 'polyline' && handle.kind === 'endpoint') {
    const idx = Number(handle.id.split(':').pop())
    if (!Number.isFinite(idx) || idx < 0 || idx >= entity.points.length) return null
    const points = entity.points.map((p, i) => (i === idx ? { x: local.x, y: local.y } : p))
    return { points } as Partial<Entity>
  }
  return null
}

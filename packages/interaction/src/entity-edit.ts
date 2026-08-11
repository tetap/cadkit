import type { ControlHandle } from './handles.js'
import { worldToEntityLocal } from './handles.js'
import type { Entity, EntityId, PolylineEntity, Vec2 } from '@cadkit/types'
import {
  slideArcTextOnCircle,
  translate,
  updateArcTextPath,
  type EntityLookup,
} from '@cadkit/geometry'
import { transformEntityPatch, worldDeltaToParentLocal } from './selection-transform.js'
import { parsePathVertexHandleId, type PathVertexRef } from './path-vertex.js'

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
    if (handle.kind === 'radius') {
      const r = Math.hypot(local.x - entity.center.x, local.y - entity.center.y)
      return { radius: Math.max(1e-6, r) } as Partial<Entity>
    }
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

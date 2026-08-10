import {
  asEntityId,
  createAABB,
  isValidAABB,
  type AABB,
  type Entity,
  type EntityId,
  type WorldPoint,
} from '@cadkit/types'
import {
  aggregateBounds,
  entityWorldBounds,
  invert,
  multiply,
  multiplyTransform,
  resolveWorldMatrix,
  rotate,
  scale,
  translate,
  transformPoint,
  type Matrix3,
} from '@cadkit/geometry'
import type { Camera2D } from '@cadkit/geometry'
import type { ControlHandle, ScaleCorner } from './handles.js'

export type { ScaleCorner }

export const SELECTION_HANDLE_OWNER = asEntityId('__selection__')

const SCALE_CURSORS: Record<ScaleCorner, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

/** World AABB of selected entities, or null if empty/invalid. */
export function selectionWorldBounds(
  entities: readonly Entity[],
  lookup?: (id: EntityId) => Entity | undefined,
): AABB | null {
  const boxes = entities.map((e) => {
    if (e.type === 'group' && lookup) {
      const childBoxes = e.children
        .map((id) => lookup(id))
        .filter((c): c is Entity => !!c)
        .map((c) => entityWorldBounds(c, resolveWorldMatrix(c, lookup)))
      return aggregateBounds(childBoxes)
    }
    const m = lookup ? resolveWorldMatrix(e, lookup) : (e.transform as unknown as Matrix3)
    return entityWorldBounds(e, m)
  })
  const box = aggregateBounds(boxes)
  return isValidAABB(box) ? box : null
}

export function aabbCenter(box: AABB): WorldPoint {
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
    __space: 'world',
  }
}

export function scaleHandleWorld(box: AABB, corner: ScaleCorner): WorldPoint {
  const midX = (box.minX + box.maxX) / 2
  const midY = (box.minY + box.maxY) / 2
  switch (corner) {
    case 'nw':
      return { x: box.minX, y: box.minY, __space: 'world' }
    case 'n':
      return { x: midX, y: box.minY, __space: 'world' }
    case 'ne':
      return { x: box.maxX, y: box.minY, __space: 'world' }
    case 'e':
      return { x: box.maxX, y: midY, __space: 'world' }
    case 'se':
      return { x: box.maxX, y: box.maxY, __space: 'world' }
    case 's':
      return { x: midX, y: box.maxY, __space: 'world' }
    case 'sw':
      return { x: box.minX, y: box.maxY, __space: 'world' }
    case 'w':
      return { x: box.minX, y: midY, __space: 'world' }
  }
}

/** Opposite corner/edge used as scale anchor. */
export function oppositeScaleCorner(corner: ScaleCorner): ScaleCorner {
  const map: Record<ScaleCorner, ScaleCorner> = {
    nw: 'se',
    n: 's',
    ne: 'sw',
    e: 'w',
    se: 'nw',
    s: 'n',
    sw: 'ne',
    w: 'e',
  }
  return map[corner]
}

/** Object-mode selection frame: AABB + optional live rotation (radians about center). */
export interface SelectionFrame {
  box: AABB
  /** Live OBB angle while rotating; 0 means axis-aligned. */
  rotation: number
}

/** Object-mode handles: 8 scale + 1 rotate above top-center. */
export function buildTransformHandles(
  box: AABB,
  camera: Camera2D,
  rotationRad = 0,
): ControlHandle[] {
  const zoom = Math.max(1e-6, camera.getState().zoom)
  const rotateOffset = 28 / zoom
  const center = aabbCenter(box)
  const mapPoint = (p: WorldPoint): WorldPoint => {
    if (Math.abs(rotationRad) < 1e-12) return p
    const q = transformPoint(rotateMatrixAbout(center, rotationRad), p)
    return { x: q.x, y: q.y, __space: 'world' }
  }
  const corners: ScaleCorner[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const handles: ControlHandle[] = corners.map((corner) => ({
    id: `selection:scale:${corner}`,
    entityId: SELECTION_HANDLE_OWNER,
    kind: 'scale' as const,
    world: mapPoint(scaleHandleWorld(box, corner)),
    cursor: SCALE_CURSORS[corner],
    scaleCorner: corner,
  }))
  const midTop = scaleHandleWorld(box, 'n')
  handles.push({
    id: 'selection:rotate',
    entityId: SELECTION_HANDLE_OWNER,
    kind: 'rotate',
    world: mapPoint({ x: midTop.x, y: midTop.y - rotateOffset, __space: 'world' }),
    cursor: 'grab',
  })
  return handles
}

export function scaleMatrixAbout(
  anchor: { x: number; y: number },
  sx: number,
  sy: number,
): Matrix3 {
  return multiply(translate(anchor.x, anchor.y), multiply(scale(sx, sy), translate(-anchor.x, -anchor.y)))
}

export function rotateMatrixAbout(center: { x: number; y: number }, angleRad: number): Matrix3 {
  return multiply(
    translate(center.x, center.y),
    multiply(rotate(angleRad), translate(-center.x, -center.y)),
  )
}

/** Build scale factors from drag, locking axes for edge handles. */
export function scaleFactorsFromDrag(
  corner: ScaleCorner,
  anchor: { x: number; y: number },
  start: { x: number; y: number },
  current: { x: number; y: number },
): { sx: number; sy: number } {
  const startX = start.x - anchor.x
  const startY = start.y - anchor.y
  const curX = current.x - anchor.x
  const curY = current.y - anchor.y
  const eps = 1e-8
  let sx = Math.abs(startX) > eps ? curX / startX : 1
  let sy = Math.abs(startY) > eps ? curY / startY : 1
  if (corner === 'n' || corner === 's') sx = 1
  if (corner === 'e' || corner === 'w') sy = 1
  // Avoid collapsing to zero / flipping through zero
  if (Math.abs(sx) < eps) sx = sx < 0 ? -eps : eps
  if (Math.abs(sy) < eps) sy = sy < 0 ? -eps : eps
  return { sx, sy }
}

/** Apply affine map in parent-local space (groups → transform; leaves → geometry). */
export function transformEntityPatch(entity: Entity, m: Matrix3): Partial<Entity> | null {
  if (entity.type === 'group') {
    return { transform: multiplyTransform(entity.transform, m) } as Partial<Entity>
  }
  const tp = (p: { x: number; y: number }) => transformPoint(m, p)
  switch (entity.type) {
    case 'line':
      return { start: tp(entity.start), end: tp(entity.end) } as Partial<Entity>
    case 'polyline':
    case 'bezier':
      return { points: entity.points.map(tp) } as Partial<Entity>
    case 'circle': {
      const center = tp(entity.center)
      const rim = tp({ x: entity.center.x + entity.radius, y: entity.center.y })
      return {
        center,
        radius: Math.max(1e-6, Math.hypot(rim.x - center.x, rim.y - center.y)),
      } as Partial<Entity>
    }
    case 'arc': {
      const center = tp(entity.center)
      const rim = tp({
        x: entity.center.x + entity.radius * Math.cos(entity.startAngle),
        y: entity.center.y + entity.radius * Math.sin(entity.startAngle),
      })
      const angle = Math.atan2(m[1], m[0])
      return {
        center,
        radius: Math.max(1e-6, Math.hypot(rim.x - center.x, rim.y - center.y)),
        startAngle: entity.startAngle + angle,
        endAngle: entity.endAngle + angle,
      } as Partial<Entity>
    }
    case 'ellipse': {
      const center = tp(entity.center)
      const xAxis = tp({
        x: entity.center.x + entity.radiusX * Math.cos(entity.rotation),
        y: entity.center.y + entity.radiusX * Math.sin(entity.rotation),
      })
      const yAxis = tp({
        x: entity.center.x - entity.radiusY * Math.sin(entity.rotation),
        y: entity.center.y + entity.radiusY * Math.cos(entity.rotation),
      })
      return {
        center,
        radiusX: Math.max(1e-6, Math.hypot(xAxis.x - center.x, xAxis.y - center.y)),
        radiusY: Math.max(1e-6, Math.hypot(yAxis.x - center.x, yAxis.y - center.y)),
        rotation: Math.atan2(xAxis.y - center.y, xAxis.x - center.x),
      } as Partial<Entity>
    }
    case 'text': {
      // Bake scale into fontSize / arc radius; rotation into entity.rotation or arc startAngle.
      const sx = Math.hypot(m[0], m[1])
      const sy = Math.hypot(m[2], m[3])
      const s =
        sx > 1e-8 && sy > 1e-8 ? Math.sqrt(sx * sy) : Math.max(sx, sy, 1e-8)
      const angle = Math.atan2(m[1], m[0])
      const patch: Partial<Entity> = {
        position: tp(entity.position),
        fontSize: Math.max(1e-3, entity.fontSize * s),
        rotation: (entity.rotation ?? 0) + angle,
      }
      if (entity.path?.kind === 'arc') {
        patch.path = {
          ...entity.path,
          radius: Math.max(1e-3, entity.path.radius * s),
          startAngle: entity.path.startAngle + angle,
        }
        // Arc layout already encodes orientation via startAngle.
        patch.rotation = entity.rotation ?? 0
      }
      return patch
    }
    case 'nurbs':
      return { controlPoints: entity.controlPoints.map(tp) } as Partial<Entity>
    case 'dimension':
      return { start: tp(entity.start), end: tp(entity.end) } as Partial<Entity>
    case 'image': {
      const origin = tp(entity.origin)
      const corner = tp({
        x: entity.origin.x + entity.width,
        y: entity.origin.y + entity.height,
      })
      return {
        origin,
        width: Math.max(1e-6, Math.abs(corner.x - origin.x)),
        height: Math.max(1e-6, Math.abs(corner.y - origin.y)),
      } as Partial<Entity>
    }
    default:
      return null
  }
}

/** localDelta = inv(parentWorld) * worldDelta * parentWorld */
export function worldDeltaToParentLocal(
  entity: Entity,
  worldDelta: Matrix3,
  lookup: (id: EntityId) => Entity | undefined,
): Matrix3 {
  if (!entity.parentId) return worldDelta
  const parent = lookup(entity.parentId as EntityId)
  if (!parent) return worldDelta
  const parentWorld = resolveWorldMatrix(parent, lookup)
  const inv = invert(parentWorld)
  if (!inv) return worldDelta
  return multiply(multiply(inv, worldDelta), parentWorld)
}

export function patchesFromMatrix(
  snapshots: ReadonlyMap<EntityId, Entity>,
  m: Matrix3,
  lookup?: (id: EntityId) => Entity | undefined,
): Map<EntityId, Partial<Entity>> {
  const patches = new Map<EntityId, Partial<Entity>>()
  for (const [id, entity] of snapshots) {
    const local = lookup ? worldDeltaToParentLocal(entity, m, lookup) : m
    const patch = transformEntityPatch(entity, local)
    if (patch) patches.set(id, patch)
  }
  return patches
}

export function cloneEntitySnapshot(entity: Entity): Entity {
  return structuredClone(entity)
}

/** Tiny helper for tests / overlay sizing. */
export function inflateAABB(box: AABB, pad: number): AABB {
  return createAABB(box.minX - pad, box.minY - pad, box.maxX + pad, box.maxY + pad)
}

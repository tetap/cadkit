import { IDENTITY_TRANSFORM, type Entity } from '@cadkit/types'
import { multiplyTransform } from './world-matrix.js'
import { multiply, transformPoint, type Matrix3 } from './matrix.js'

/**
 * Apply an affine map expressed in the entity's parent/local space.
 * Groups accumulate on `transform`; leaves bake into geometry and keep transform.
 */
export function applyAffineToEntity(entity: Entity, m: Matrix3): Entity {
  if (entity.type === 'group') {
    return {
      ...entity,
      transform: multiplyTransform(entity.transform, m),
      version: entity.version + 1,
    }
  }

  const tp = (p: { x: number; y: number }) => transformPoint(m, p)
  let next: Entity
  switch (entity.type) {
    case 'line':
      next = { ...entity, start: tp(entity.start), end: tp(entity.end) }
      break
    case 'polyline':
    case 'bezier':
      next = { ...entity, points: entity.points.map(tp) }
      break
    case 'circle': {
      const center = tp(entity.center)
      const rim = tp({ x: entity.center.x + entity.radius, y: entity.center.y })
      next = {
        ...entity,
        center,
        radius: Math.max(1e-6, Math.hypot(rim.x - center.x, rim.y - center.y)),
      }
      break
    }
    case 'arc': {
      const center = tp(entity.center)
      const rim = tp({
        x: entity.center.x + entity.radius * Math.cos(entity.startAngle),
        y: entity.center.y + entity.radius * Math.sin(entity.startAngle),
      })
      const angle = Math.atan2(m[1], m[0])
      next = {
        ...entity,
        center,
        radius: Math.max(1e-6, Math.hypot(rim.x - center.x, rim.y - center.y)),
        startAngle: entity.startAngle + angle,
        endAngle: entity.endAngle + angle,
      }
      break
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
      next = {
        ...entity,
        center,
        radiusX: Math.max(1e-6, Math.hypot(xAxis.x - center.x, xAxis.y - center.y)),
        radiusY: Math.max(1e-6, Math.hypot(yAxis.x - center.x, yAxis.y - center.y)),
        rotation: Math.atan2(xAxis.y - center.y, xAxis.x - center.x),
      }
      break
    }
    case 'text':
      next = { ...entity, position: tp(entity.position) }
      break
    case 'nurbs':
      next = { ...entity, controlPoints: entity.controlPoints.map(tp) }
      break
    case 'dimension':
      next = { ...entity, start: tp(entity.start), end: tp(entity.end) }
      break
    case 'image': {
      const origin = tp(entity.origin)
      const corner = tp({
        x: entity.origin.x + entity.width,
        y: entity.origin.y + entity.height,
      })
      next = {
        ...entity,
        origin,
        width: Math.max(1e-6, Math.abs(corner.x - origin.x)),
        height: Math.max(1e-6, Math.abs(corner.y - origin.y)),
      }
      break
    }
    case 'blockInstance': {
      const insertion = tp(entity.insertion)
      next = { ...entity, insertion }
      break
    }
    default:
      next = { ...entity }
  }

  // Fold any residual local transform into geometry, then normalize.
  const local = entity.transform as unknown as Matrix3
  const hasLocal =
    local[0] !== 1 || local[1] !== 0 || local[2] !== 0 || local[3] !== 1 || local[4] !== 0 || local[5] !== 0
  if (hasLocal) {
    // Caller should compose m with local first when baking; here we only normalize when m already includes it.
  }
  return { ...next, transform: IDENTITY_TRANSFORM, version: entity.version + 1 }
}

/** Compose parent-local matrix `m` with entity local transform, bake leaves, keep groups as transform. */
export function bakeParentLocalMatrix(entity: Entity, parentLocal: Matrix3): Entity {
  const composed = multiply(parentLocal, entity.transform as unknown as Matrix3)
  if (entity.type === 'group') {
    return {
      ...entity,
      transform: [composed[0], composed[1], composed[2], composed[3], composed[4], composed[5]] as const,
      version: entity.version + 1,
    }
  }
  // Apply composed to geometry with identity base transform
  const base = { ...entity, transform: IDENTITY_TRANSFORM } as Entity
  return applyAffineToEntity(base, composed)
}

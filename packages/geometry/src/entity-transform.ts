import { IDENTITY_TRANSFORM, type Entity, type TextEntity } from '@cadkit/types'
import { multiplyTransform } from './world-matrix.js'
import { decomposeTextLinear, multiply, transformPoint, type Matrix3 } from './matrix.js'

/**
 * Bake an affine map into text fields so the selection AABB tracks the drag.
 *
 * Axis-aligned positive scales map height → `fontSize` and width → `widthFactor`
 * (compensating for fontSize changing advance). Geometric-mean baking made
 * corner/edge handles slip off the pointer for non-uniform scales.
 */
export function bakeTextAffine(
  entity: TextEntity,
  m: Matrix3,
): Pick<TextEntity, 'position' | 'fontSize' | 'widthFactor' | 'rotation' | 'path'> {
  const position = transformPoint(m, entity.position)
  const a = m[0]
  const b = m[1]
  const c = m[2]
  const d = m[3]
  const axisAligned = Math.abs(b) < 1e-8 && Math.abs(c) < 1e-8

  // Upright / arc text + axis-aligned positive scale (selection handles):
  // independent sx/sy so edge/corner handles track the pointer.
  if (axisAligned && a > 0 && d > 0 && Math.abs(entity.rotation ?? 0) < 1e-8) {
    const sx = a
    const sy = Math.max(d, 1e-8)
    if (entity.path?.kind === 'arc') {
      return {
        position,
        fontSize: Math.max(1e-3, entity.fontSize * sy),
        // advance ∝ fontSize, so divide sx by sy to keep arc length *= sx.
        widthFactor: (entity.widthFactor ?? 1) * (sx / sy),
        rotation: 0,
        path: {
          ...entity.path,
          // Layout circle follows horizontal scale of the selection frame.
          radius: Math.max(1e-3, entity.path.radius * sx),
        },
      }
    }
    return {
      position,
      fontSize: Math.max(1e-3, entity.fontSize * sy),
      // advance ∝ fontSize, so divide sx by sy to keep width *= sx.
      widthFactor: (entity.widthFactor ?? 1) * (sx / sy),
      rotation: 0,
      path: entity.path,
    }
  }

  if (entity.path?.kind === 'arc') {
    const { scale: s, rotation: angle, widthSign } = decomposeTextLinear(m)
    return {
      position,
      fontSize: Math.max(1e-3, entity.fontSize * s),
      widthFactor: Math.abs(entity.widthFactor ?? 1),
      rotation: entity.rotation ?? 0,
      path: {
        ...entity.path,
        radius: Math.max(1e-3, entity.path.radius * s),
        startAngle: entity.path.startAngle + angle,
        sweep: entity.path.sweep * widthSign,
      },
    }
  }

  const { scale: s, rotation: angle, widthSign } = decomposeTextLinear(m)
  return {
    position,
    fontSize: Math.max(1e-3, entity.fontSize * s),
    widthFactor: (entity.widthFactor ?? 1) * widthSign,
    rotation: (entity.rotation ?? 0) + angle,
    path: entity.path,
  }
}

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
      next = {
        ...entity,
        points: entity.points.map(tp),
        ...(entity.holes?.length
          ? { holes: entity.holes.map((h) => h.map(tp)) }
          : {}),
      }
      break
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
    case 'text': {
      next = { ...entity, ...bakeTextAffine(entity, m) }
      break
    }
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

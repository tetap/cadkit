import type { AABB, Entity, Vec2 } from '@cadkit/types'
import { aabbFromPoints, createAABB, emptyAABB, expandAABB, isValidAABB } from '@cadkit/types'
import { arcTextLocalBounds } from './arc-text.js'
import { type Matrix3, transformPoint } from './matrix.js'
import { measureTextLine } from './text-metrics.js'

export interface BoundsChange {
  before: AABB
  after: AABB
}

export function entityLocalBounds(entity: Entity): AABB {
  switch (entity.type) {
    case 'line':
      return aabbFromPoints([entity.start, entity.end])
    case 'polyline':
    case 'bezier':
      return aabbFromPoints(entity.points)
    case 'arc':
    case 'circle': {
      const box = createAABB(
        entity.center.x - entity.radius,
        entity.center.y - entity.radius,
        entity.center.x + entity.radius,
        entity.center.y + entity.radius,
      )
      return box
    }
    case 'ellipse': {
      const rx = entity.radiusX
      const ry = entity.radiusY
      return createAABB(entity.center.x - rx, entity.center.y - ry, entity.center.x + rx, entity.center.y + ry)
    }
    case 'text': {
      if (entity.path?.kind === 'arc') {
        return arcTextLocalBounds(
          entity.content,
          entity.fontSize,
          entity.position,
          entity.path,
          entity.widthFactor ?? 1,
          entity.fontFamily,
        )
      }
      return straightTextLocalBounds(entity)
    }
    case 'image':
      return createAABB(
        entity.origin.x,
        entity.origin.y,
        entity.origin.x + entity.width,
        entity.origin.y + entity.height,
      )
    case 'dimension':
      return aabbFromPoints([entity.start, entity.end])
    case 'nurbs':
      return aabbFromPoints(entity.controlPoints)
    case 'path':
    case 'hatch':
    case 'blockDefinition':
    case 'blockInstance':
    case 'group':
      return emptyAABB()
    default:
      return emptyAABB()
  }
}

function straightTextLocalBounds(entity: Extract<Entity, { type: 'text' }>): AABB {
  const fontSize = entity.fontSize
  const fontFamily = entity.fontFamily || 'sans-serif'
  const wf = entity.widthFactor ?? 1
  const align = entity.align ?? 'left'
  const lines = entity.content.split(/\r?\n/u)
  const lineCount = Math.max(1, lines.length)

  if (!entity.content) {
    return createAABB(
      entity.position.x,
      entity.position.y - fontSize,
      entity.position.x,
      entity.position.y,
    )
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let i = 0; i < lineCount; i++) {
    const line = lines[i] ?? ''
    const m = measureTextLine(line, fontSize, fontFamily)
    const advance = m.advance * wf
    const baseline = entity.position.y + i * fontSize

    let lineLeft = entity.position.x
    if (align === 'center') lineLeft = entity.position.x - advance / 2
    else if (align === 'right') lineLeft = entity.position.x - advance

    const left = lineLeft + m.inkLeft * wf
    const right = lineLeft + m.inkRight * wf
    const top = baseline - m.ascent
    const bottom = baseline + m.descent

    minX = Math.min(minX, left, lineLeft)
    maxX = Math.max(maxX, right, lineLeft + advance)
    minY = Math.min(minY, top)
    maxY = Math.max(maxY, bottom)
  }

  if (!Number.isFinite(minX)) {
    return createAABB(
      entity.position.x,
      entity.position.y - fontSize,
      entity.position.x,
      entity.position.y,
    )
  }
  return createAABB(minX, minY, maxX, maxY)
}

export function transformAABB(box: AABB, m: Matrix3): AABB {
  if (!isValidAABB(box)) return emptyAABB()
  const corners: Vec2[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.maxY },
  ]
  const out = emptyAABB()
  for (const c of corners) {
    const p = transformPoint(m, c)
    expandAABB(out, p.x, p.y)
  }
  return out
}

export function entityWorldBounds(entity: Entity, worldMatrix: Matrix3 = entity.transform as unknown as Matrix3): AABB {
  return transformAABB(entityLocalBounds(entity), worldMatrix)
}

export function aggregateBounds(boxes: readonly AABB[]): AABB {
  const out = emptyAABB()
  for (const box of boxes) {
    if (!isValidAABB(box)) continue
    expandAABB(out, box.minX, box.minY)
    expandAABB(out, box.maxX, box.maxY)
  }
  return out
}

import type { AABB, Entity, Vec2 } from '@cadkit/types'
import { aabbFromPoints, createAABB, emptyAABB, expandAABB, isValidAABB } from '@cadkit/types'
import { arcTextLocalBounds } from './arc-text.js'
import { type Matrix3, transformPoint } from './matrix.js'
import { measureTextLine } from './text-metrics.js'
import { textEntityToLocalOutlines } from './text-outlines.js'

export interface BoundsChange {
  before: AABB
  after: AABB
}

export function entityLocalBounds(entity: Entity): AABB {
  switch (entity.type) {
    case 'line':
      return aabbFromPoints([entity.start, entity.end])
    case 'polyline': {
      if (entity.holes?.length) {
        const all = [...entity.points]
        for (const h of entity.holes) all.push(...h)
        return aabbFromPoints(all)
      }
      return aabbFromPoints(entity.points)
    }
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
    case 'text':
      return textInkOrEmBounds(entity)
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

/**
 * Prefer traced glyph ink (matches GPU vector text). Falls back to em-box /
 * arc layout when canvas or fonts are unavailable.
 */
function textInkOrEmBounds(entity: Extract<Entity, { type: 'text' }>): AABB {
  if (entity.content) {
    const outlines = textEntityToLocalOutlines(entity)
    if (outlines.length) {
      const box = emptyAABB()
      for (const c of outlines) {
        for (const p of c.points) expandAABB(box, p.x, p.y)
      }
      if (isValidAABB(box)) return box
    }
  }
  if (entity.path?.kind === 'arc') {
    return arcTextLocalBounds(
      entity.content,
      entity.fontSize,
      entity.position,
      entity.path,
      entity.widthFactor ?? 1,
      entity.fontFamily || 'sans-serif',
    )
  }
  return straightTextEmBounds(entity)
}

/**
 * Em-box AABB for straight text (baseline at position.y). Corners are rotated
 * so rotated text stays inside the selection frame when ink is unavailable.
 */
function straightTextEmBounds(entity: Extract<Entity, { type: 'text' }>): AABB {
  const fontSize = entity.fontSize
  const fontFamily = entity.fontFamily || 'sans-serif'
  const wf = entity.widthFactor ?? 1
  const absWf = Math.abs(wf)
  const align = entity.align ?? 'left'
  const rot = entity.rotation ?? 0
  const lines = entity.content.split(/\r?\n/u)
  const lineCount = Math.max(1, lines.length)

  let localMinX = Infinity
  let localMaxX = -Infinity

  for (let i = 0; i < lineCount; i++) {
    const line = lines[i] ?? ''
    const advance = measureTextLine(line, fontSize, fontFamily).advance * absWf
    let lineLeft = 0
    if (align === 'center') lineLeft = -advance / 2
    else if (align === 'right') lineLeft = -advance
    // Negative widthFactor mirrors about the local Y axis (CSS scaleX).
    const x0 = wf < 0 ? -lineLeft - advance : lineLeft
    const x1 = x0 + advance
    localMinX = Math.min(localMinX, x0, x1)
    localMaxX = Math.max(localMaxX, x0, x1)
  }

  if (!Number.isFinite(localMinX)) {
    localMinX = 0
    localMaxX = 0
  }

  const localMinY = -fontSize
  const localMaxY = (lineCount - 1) * fontSize

  if (Math.abs(rot) < 1e-12 && wf >= 0) {
    return createAABB(
      entity.position.x + localMinX,
      entity.position.y + localMinY,
      entity.position.x + localMaxX,
      entity.position.y + localMaxY,
    )
  }

  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const corners: Vec2[] = [
    { x: localMinX, y: localMinY },
    { x: localMaxX, y: localMinY },
    { x: localMaxX, y: localMaxY },
    { x: localMinX, y: localMaxY },
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of corners) {
    const wx = entity.position.x + p.x * cos - p.y * sin
    const wy = entity.position.y + p.x * sin + p.y * cos
    minX = Math.min(minX, wx)
    minY = Math.min(minY, wy)
    maxX = Math.max(maxX, wx)
    maxY = Math.max(maxY, wy)
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

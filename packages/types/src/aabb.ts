import type { Vec2 } from './coordinates.js'

export interface AABB {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function createAABB(minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity): AABB {
  return { minX, minY, maxX, maxY }
}

export function emptyAABB(): AABB {
  return createAABB()
}

export function aabbFromPoints(points: readonly Vec2[]): AABB {
  const box = emptyAABB()
  for (const p of points) expandAABB(box, p.x, p.y)
  return box
}

export function expandAABB(box: AABB, x: number, y: number): void {
  if (x < box.minX) box.minX = x
  if (y < box.minY) box.minY = y
  if (x > box.maxX) box.maxX = x
  if (y > box.maxY) box.maxY = y
}

export function unionAABB(a: AABB, b: AABB): AABB {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function intersectsAABB(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

export function containsAABB(outer: AABB, inner: AABB): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  )
}

export function aabbArea(box: AABB): number {
  const w = box.maxX - box.minX
  const h = box.maxY - box.minY
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0) return 0
  return w * h
}

export function aabbWidth(box: AABB): number {
  return box.maxX - box.minX
}

export function aabbHeight(box: AABB): number {
  return box.maxY - box.minY
}

export function aabbCenter(box: AABB): Vec2 {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}

export function isValidAABB(box: AABB): boolean {
  return (
    Number.isFinite(box.minX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.maxY) &&
    box.minX <= box.maxX &&
    box.minY <= box.maxY
  )
}

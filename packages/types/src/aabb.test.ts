import { describe, expect, it } from 'vitest'
import {
  aabbArea,
  aabbCenter,
  aabbFromPoints,
  aabbHeight,
  aabbWidth,
  containsAABB,
  createAABB,
  emptyAABB,
  expandAABB,
  intersectsAABB,
  isValidAABB,
  unionAABB,
} from './aabb.js'

describe('aabb', () => {
  it('creates empty sentinel and validates', () => {
    const e = emptyAABB()
    expect(isValidAABB(e)).toBe(false)
    expect(aabbArea(e)).toBe(0)
  })

  it('builds from points and expands', () => {
    const box = aabbFromPoints([
      { x: 1, y: 2 },
      { x: 4, y: 0 },
    ])
    expect(box).toEqual({ minX: 1, minY: 0, maxX: 4, maxY: 2 })
    expandAABB(box, -1, 5)
    expect(box.minX).toBe(-1)
    expect(box.maxY).toBe(5)
  })

  it('union / intersects / contains / metrics', () => {
    const a = createAABB(0, 0, 2, 2)
    const b = createAABB(1, 1, 3, 3)
    expect(intersectsAABB(a, b)).toBe(true)
    expect(containsAABB(a, createAABB(0.5, 0.5, 1.5, 1.5))).toBe(true)
    expect(unionAABB(a, b)).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 3 })
    expect(aabbWidth(a)).toBe(2)
    expect(aabbHeight(a)).toBe(2)
    expect(aabbCenter(a)).toEqual({ x: 1, y: 1 })
    expect(aabbArea(a)).toBe(4)
  })
})

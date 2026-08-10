import { describe, expect, it } from 'vitest'
import { booleanContourGroups, booleanOpsAvailable } from './boolean.js'

const square = (x: number, y: number, s: number) => ({
  closed: true as const,
  points: [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ],
})

function span(contours: { points: { x: number; y: number }[] }[]) {
  const xs = contours.flatMap((c) => c.points.map((p) => p.x))
  const ys = contours.flatMap((c) => c.points.map((p) => p.y))
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

describe('booleanContourGroups', () => {
  it('reports boolean ops available', () => {
    expect(booleanOpsAvailable()).toBe(true)
  })

  it('unions two overlapping squares', () => {
    const a = [square(0, 0, 10)]
    const b = [square(5, 5, 10)]
    const out = booleanContourGroups([a, b], 'union')
    expect(out.length).toBeGreaterThanOrEqual(1)
    const box = span(out)
    expect(box.minX).toBeCloseTo(0, 1)
    expect(box.minY).toBeCloseTo(0, 1)
    expect(box.maxX).toBeCloseTo(15, 1)
    expect(box.maxY).toBeCloseTo(15, 1)
  })

  it('subtracts the second square from the first', () => {
    const a = [square(0, 0, 20)]
    const b = [square(5, 5, 10)]
    const out = booleanContourGroups([a, b], 'subtract')
    expect(out.length).toBeGreaterThanOrEqual(1)
    // Outer extent stays ~20×20; area should be less than full square.
    const box = span(out)
    expect(box.maxX - box.minX).toBeGreaterThan(15)
    expect(box.maxY - box.minY).toBeGreaterThan(15)
  })

  it('intersects two overlapping squares', () => {
    const a = [square(0, 0, 10)]
    const b = [square(5, 0, 10)]
    const out = booleanContourGroups([a, b], 'intersect')
    expect(out.length).toBe(1)
    const box = span(out)
    expect(box.minX).toBeCloseTo(5, 1)
    expect(box.maxX).toBeCloseTo(10, 1)
    expect(box.maxY - box.minY).toBeCloseTo(10, 1)
  })

  it('xor / exclude yields two lobes for partial overlap', () => {
    const a = [square(0, 0, 10)]
    const b = [square(5, 0, 10)]
    const out = booleanContourGroups([a, b], 'exclude')
    expect(out.length).toBeGreaterThanOrEqual(1)
    const box = span(out)
    expect(box.minX).toBeCloseTo(0, 1)
    expect(box.maxX).toBeCloseTo(15, 1)
  })
})

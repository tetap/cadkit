import { describe, expect, it } from 'vitest'
import { offsetContours } from './offset.js'

describe('offsetContours', () => {
  it('inflates a unit square externally', () => {
    const square = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    }
    const out = offsetContours([square], { distance: 2, direction: 'external', join: 'miter' })
    expect(out.length).toBeGreaterThanOrEqual(1)
    const xs = out[0]!.points.map((p) => p.x)
    const ys = out[0]!.points.map((p) => p.y)
    expect(Math.min(...xs)).toBeLessThan(-1.5)
    expect(Math.max(...xs)).toBeGreaterThan(11.5)
    expect(Math.min(...ys)).toBeLessThan(-1.5)
    expect(Math.max(...ys)).toBeGreaterThan(11.5)
  })

  it('deflates a square inwardly', () => {
    const square = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
    }
    const out = offsetContours([square], { distance: 3, direction: 'inner', join: 'round' })
    expect(out.length).toBe(1)
    const xs = out[0]!.points.map((p) => p.x)
    const ys = out[0]!.points.map((p) => p.y)
    expect(Math.min(...xs)).toBeGreaterThan(2)
    expect(Math.max(...xs)).toBeLessThan(18)
    expect(Math.min(...ys)).toBeGreaterThan(2)
    expect(Math.max(...ys)).toBeLessThan(18)
  })
})

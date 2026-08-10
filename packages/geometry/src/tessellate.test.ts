import { describe, expect, it } from 'vitest'
import { lodBin, tessellateArc, tessellateCubicBezier, tessellateCubicChain } from './tessellate.js'

describe('tessellate', () => {
  it('tessellates arc with endpoints', () => {
    const pts = tessellateArc({ x: 0, y: 0 }, 10, 0, Math.PI / 2, 0.5, 1)
    expect(pts.length).toBeGreaterThan(2)
    expect(pts[0]!.x).toBeCloseTo(10)
    expect(pts[0]!.y).toBeCloseTo(0)
    expect(pts.at(-1)!.x).toBeCloseTo(0, 1)
    expect(pts.at(-1)!.y).toBeCloseTo(10, 1)
  })

  it('tessellates cubic bezier with endpoints', () => {
    const loose = tessellateCubicBezier(
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: -20 },
      { x: 30, y: 0 },
      2,
      1,
    )
    const tight = tessellateCubicBezier(
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: -20 },
      { x: 30, y: 0 },
      0.1,
      1,
    )
    expect(loose[0]).toEqual({ x: 0, y: 0 })
    expect(loose.at(-1)).toEqual({ x: 30, y: 0 })
    expect(tight.length).toBeGreaterThanOrEqual(loose.length)
  })

  it('tessellates chained cubics', () => {
    const pts = tessellateCubicChain(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
        { x: 40, y: 10 },
        { x: 50, y: 10 },
        { x: 60, y: 0 },
      ],
      0.5,
      1,
    )
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts.at(-1)).toEqual({ x: 60, y: 0 })
    expect(pts.length).toBeGreaterThan(4)
  })

  it('lodBin hysteresis', () => {
    const a = lodBin(1, null)
    expect(lodBin(1.05, a)).toBe(a)
  })
})

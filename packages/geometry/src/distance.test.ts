import { describe, expect, it } from 'vitest'
import {
  closestPointOnSegment,
  distancePointToCircle,
  distancePointToPoint,
  distancePointToSegment,
  nearlyEqual,
} from './distance.js'

describe('distance', () => {
  it('point-point and nearlyEqual', () => {
    expect(distancePointToPoint({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(nearlyEqual(1, 1 + 1e-10)).toBe(true)
  })

  it('segment distance and closest point', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    expect(distancePointToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3)
    expect(closestPointOnSegment({ x: 5, y: 3 }, a, b)).toEqual({ x: 5, y: 0 })
    expect(distancePointToSegment({ x: -1, y: 0 }, a, b)).toBeCloseTo(1)
    expect(distancePointToSegment({ x: 0, y: 0 }, a, a)).toBe(0)
  })

  it('circle distance', () => {
    expect(distancePointToCircle({ x: 10, y: 0 }, { x: 0, y: 0 }, 5)).toBeCloseTo(5)
  })
})

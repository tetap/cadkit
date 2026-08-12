import { describe, expect, it } from 'vitest'
import {
  bestOrientation,
  chainHatchPaths,
  chainNearbyPaths,
  optimizePathOrder,
  travelLength,
} from './optimize-order.js'

describe('optimizePathOrder', () => {
  it('picks nearer endpoints and reduces empty travel vs document order', () => {
    // Far-then-near in document order; optimizer should cut first the segment
    // near the origin, then jump once to the far cluster.
    const paths = [
      [
        { x: 100, y: 0 },
        { x: 110, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 110, y: 10 },
        { x: 100, y: 10 },
      ],
    ]
    const naive = travelLength(paths, { x: 0, y: 0 })
    const ordered = optimizePathOrder(paths, { start: { x: 0, y: 0 } })
    const opt = travelLength(ordered, { x: 0, y: 0 })
    expect(opt).toBeLessThan(naive)
    // First cut should start near home.
    expect(ordered[0]![0]!.x).toBeLessThan(20)
  })

  it('rotates closed rings to the nearest entry vertex', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]
    const oriented = bestOrientation(square, { x: 10, y: 10 })
    expect(oriented[0]!.x).toBeCloseTo(10)
    expect(oriented[0]!.y).toBeCloseTo(10)
    expect(oriented.at(-1)).toEqual(oriented[0])
  })

  it('chains serpentine hatch rows into fewer paths', () => {
    // Two alternating hatch rows whose ends meet within tolerance.
    const rows = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 10, y: 1 },
        { x: 0, y: 1 },
      ],
      [
        { x: 0, y: 2 },
        { x: 10, y: 2 },
      ],
    ]
    const chained = chainNearbyPaths(rows, 1.1)
    expect(chained.length).toBe(1)
    // Near joins keep bridge vertices → one continuous cut, zero empty travel.
    expect(chained[0]!.length).toBeGreaterThanOrEqual(4)
    expect(travelLength(chained, { x: 0, y: 0 })).toBe(0)
  })

  it('chainHatchPaths keeps scanline order and joins adjacent rows', () => {
    const rows = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 10, y: 1 },
        { x: 0, y: 1 },
      ],
      [
        { x: 0, y: 2 },
        { x: 10, y: 2 },
      ],
      // Gap → new chain (far from previous end)
      [
        { x: 100, y: 0 },
        { x: 110, y: 0 },
      ],
    ]
    const chained = chainHatchPaths(rows, 1.1)
    expect(chained).toHaveLength(2)
    expect(chained[0]![0]).toEqual({ x: 0, y: 0 })
    expect(chained[0]!.at(-1)).toEqual({ x: 10, y: 2 })
    expect(chained[1]![0]).toEqual({ x: 100, y: 0 })
  })

  it('2-opt improves a crossed tour', () => {
    // Four segments at square corners — naive order zig-zags across the diagonal.
    const paths = [
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [
        { x: 10, y: 10 },
        { x: 11, y: 10 },
      ],
      [
        { x: 10, y: 0 },
        { x: 11, y: 0 },
      ],
      [
        { x: 0, y: 10 },
        { x: 1, y: 10 },
      ],
    ]
    const crossedOrder = [paths[0]!, paths[1]!, paths[2]!, paths[3]!]
    const crossedTravel = travelLength(crossedOrder, { x: 0, y: 0 })
    const ordered = optimizePathOrder(paths, { start: { x: 0, y: 0 } })
    expect(travelLength(ordered, { x: 0, y: 0 })).toBeLessThanOrEqual(crossedTravel)
    // Should not jump to the opposite corner first after the origin segment.
    const secondStart = ordered[1]![0]!
    expect(secondStart.x + secondStart.y).toBeLessThan(15)
  })
})

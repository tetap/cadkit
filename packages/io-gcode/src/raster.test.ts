import { describe, expect, it } from 'vitest'
import { rasterToCutPaths, rasterToPowerCuts } from './raster.js'

describe('rasterToCutPaths', () => {
  it('emits serpentine burns for a dark rectangle', () => {
    const cols = 8
    const rows = 4
    const luma = new Uint8Array(cols * rows)
    luma.fill(255)
    // Middle block dark
    for (let r = 1; r < 3; r++) {
      for (let c = 2; c < 6; c++) luma[r * cols + c] = 0
    }
    const paths = rasterToCutPaths({
      origin: { x: 0, y: 0 },
      width: 8,
      height: 4,
      cols,
      rows,
      luma,
    })
    expect(paths.length).toBe(2)
    // Absolute row parity: r=1 (odd) R→L, r=2 (even) L→R
    expect(paths[0]![0]!.x).toBeGreaterThan(paths[0]![1]!.x)
    expect(paths[1]![0]!.x).toBeLessThan(paths[1]![1]!.x)
  })

  it('applies localToWorld', () => {
    const luma = new Uint8Array([0, 0])
    const paths = rasterToCutPaths({
      origin: { x: 0, y: 0 },
      width: 2,
      height: 1,
      cols: 2,
      rows: 1,
      luma,
      localToWorld: (p) => ({ x: p.x + 10, y: p.y + 20 }),
    })
    expect(paths).toHaveLength(1)
    expect(paths[0]![0]!.x).toBe(10)
    expect(paths[0]![0]!.y).toBeCloseTo(20.5, 5)
    expect(paths[0]![1]!.x).toBe(12)
  })
})

describe('rasterToPowerCuts', () => {
  it('maps black→max power and skips white', () => {
    const luma = new Uint8Array([0, 128, 255, 255])
    const cuts = rasterToPowerCuts(
      {
        origin: { x: 0, y: 0 },
        width: 4,
        height: 1,
        cols: 4,
        rows: 1,
        luma,
      },
      { maxPower: 1000, gamma: 1, powerLevels: 256, minPower: 1 },
    )
    expect(cuts.length).toBeGreaterThanOrEqual(2)
    const powers = cuts.map((c) => c.power)
    expect(Math.max(...powers)).toBe(1000)
    expect(powers.every((p) => p > 0 && p <= 1000)).toBe(true)
    // Mid gray should be weaker than black.
    const black = cuts.find((c) => c.points[0]!.x === 0)
    const mid = cuts.find((c) => c.points[0]!.x === 1)
    expect(black?.power).toBe(1000)
    expect(mid?.power).toBeGreaterThan(0)
    expect(mid!.power).toBeLessThan(1000)
  })

  it('merges adjacent equal-power pixels and snakes rows', () => {
    const cols = 4
    const rows = 2
    const luma = new Uint8Array(cols * rows)
    luma.fill(0) // all black → one run per row
    const cuts = rasterToPowerCuts(
      {
        origin: { x: 0, y: 0 },
        width: 4,
        height: 2,
        cols,
        rows,
        luma,
      },
      { maxPower: 500, gamma: 1, powerLevels: 16 },
    )
    expect(cuts).toHaveLength(2)
    // Row 0 L→R, row 1 R→L
    expect(cuts[0]!.points[0]!.x).toBeLessThan(cuts[0]!.points[1]!.x)
    expect(cuts[1]!.points[0]!.x).toBeGreaterThan(cuts[1]!.points[1]!.x)
    expect(cuts[0]!.power).toBe(cuts[1]!.power)
  })
})

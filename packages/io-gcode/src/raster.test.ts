import { describe, expect, it } from 'vitest'
import { rasterToCutPaths, rasterToPowerCuts } from './raster.js'

describe('rasterToCutPaths', () => {
  it('emits serpentine burns for a dark rectangle', () => {
    const cols = 8
    const rows = 4
    const luma = new Uint8Array(cols * rows)
    luma.fill(255)
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
  it('maps black→max power and keeps white as S0 (no travel gap)', () => {
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
      { maxPower: 1000, gamma: 1, powerLevels: 256, minPower: 0 },
    )
    // Full row covered — white is S0, not skipped.
    const span = cuts.reduce((n, c) => n + Math.abs(c.points[1]!.x - c.points[0]!.x), 0)
    expect(span).toBeCloseTo(4, 5)
    expect(cuts.some((c) => c.power === 1000)).toBe(true)
    expect(cuts.some((c) => c.power === 0)).toBe(true)
    const mid = cuts.find(
      (c) => Math.min(c.points[0]!.x, c.points[1]!.x) === 1,
    )
    expect(mid?.power).toBeGreaterThan(400)
    expect(mid?.power).toBeLessThan(600)
  })

  it('only transparent pixels create scan gaps', () => {
    const luma = new Uint8Array([0, 0, 0, 0])
    const alpha = new Uint8Array([255, 255, 0, 255])
    const cuts = rasterToPowerCuts(
      {
        origin: { x: 0, y: 0 },
        width: 4,
        height: 1,
        cols: 4,
        rows: 1,
        luma,
        alpha,
      },
      { maxPower: 500, gamma: 1 },
    )
    // Opaque left pair, gap, opaque right pixel → 2 cuts (not one continuous).
    expect(cuts.length).toBe(2)
    expect(cuts[0]!.points[1]!.x).toBeLessThanOrEqual(2.001)
    expect(cuts[1]!.points[0]!.x).toBeGreaterThanOrEqual(3 - 1e-6)
  })

  it('merges adjacent equal-power pixels and snakes rows', () => {
    const cols = 4
    const rows = 2
    const luma = new Uint8Array(cols * rows)
    luma.fill(0)
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
    expect(cuts[0]!.points[0]!.x).toBeLessThan(cuts[0]!.points[1]!.x)
    expect(cuts[1]!.points[0]!.x).toBeGreaterThan(cuts[1]!.points[1]!.x)
    expect(cuts[0]!.power).toBe(cuts[1]!.power)
  })
})

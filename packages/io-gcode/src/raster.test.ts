import { describe, expect, it } from 'vitest'
import { rasterToCutPaths } from './raster.js'

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
    expect(paths[0]![0]!.x).toBeGreaterThan(10)
    expect(paths[0]![0]!.y).toBeCloseTo(20.5, 5)
  })
})

import { describe, expect, it } from 'vitest'
import { traceBinaryContours } from './text-outlines.js'

describe('traceBinaryContours', () => {
  it('traces a solid rectangle as one outer ring', () => {
    const w = 10
    const h = 8
    const mask = new Uint8Array(w * h)
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 8; x++) mask[y * w + x] = 1
    }
    const rings = traceBinaryContours(mask, w, h)
    expect(rings.length).toBeGreaterThanOrEqual(1)
    expect(rings[0]!.length).toBeGreaterThanOrEqual(8)
  })

  it('traces a ring with a hole as two contours', () => {
    const w = 12
    const h = 12
    const mask = new Uint8Array(w * h)
    for (let y = 1; y < 11; y++) {
      for (let x = 1; x < 11; x++) mask[y * w + x] = 1
    }
    for (let y = 4; y < 8; y++) {
      for (let x = 4; x < 8; x++) mask[y * w + x] = 0
    }
    const rings = traceBinaryContours(mask, w, h)
    expect(rings.length).toBeGreaterThanOrEqual(2)
  })
})

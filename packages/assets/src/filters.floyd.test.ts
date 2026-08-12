import { describe, expect, it } from 'vitest'
import { applyFloydSteinbergRgba, applyThresholdRgba, applyBuiltinFilterCpu } from './filters.js'

describe('floyd / threshold', () => {
  it('threshold cpu single pixel', () => {
    const dark = applyBuiltinFilterCpu([0.2, 0.2, 0.2, 1], {
      id: '1',
      type: 'threshold',
      params: { cutoff: 0.5 },
    })
    expect(dark[0]).toBe(0)
    const lit = applyBuiltinFilterCpu([0.8, 0.8, 0.8, 1], {
      id: '2',
      type: 'threshold',
      params: { cutoff: 0.5 },
    })
    expect(lit[0]).toBe(1)
  })

  it('floydSteinberg quantizes to two levels', () => {
    const w = 4
    const h = 4
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128
      data[i + 1] = 128
      data[i + 2] = 128
      data[i + 3] = 255
    }
    applyFloydSteinbergRgba(data, w, h, { levels: 2 })
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i] === 0 || data[i] === 255).toBe(true)
      expect(data[i]).toBe(data[i + 1])
      expect(data[i]).toBe(data[i + 2])
    }
  })

  it('applyThresholdRgba', () => {
    const data = new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255])
    applyThresholdRgba(data, 2, 1, { cutoff: 0.5 })
    expect(data[0]).toBe(0)
    expect(data[4]).toBe(255)
  })
})

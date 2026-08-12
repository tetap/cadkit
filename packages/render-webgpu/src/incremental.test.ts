import { describe, expect, it } from 'vitest'
import { cssRectToScissor, panStripRects } from './incremental.js'

describe('cssRectToScissor', () => {
  it('converts CSS rect with dpr and clamps', () => {
    expect(cssRectToScissor({ x: 10, y: 20, w: 30, h: 40 }, 2, 200, 200)).toEqual({
      x: 20,
      y: 40,
      w: 60,
      h: 80,
    })
    expect(cssRectToScissor({ x: -10, y: -10, w: 20, h: 20 }, 1, 100, 100)).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    })
    expect(cssRectToScissor({ x: 50, y: 50, w: 0, h: 10 }, 1, 100, 100)).toBeNull()
  })
})

describe('panStripRects', () => {
  it('covers L-shaped uncovered margins', () => {
    expect(panStripRects(100, 80, 12, 0)).toEqual([{ x: 0, y: 0, w: 12, h: 80 }])
    expect(panStripRects(100, 80, -12, 0)).toEqual([{ x: 88, y: 0, w: 12, h: 80 }])
    expect(panStripRects(100, 80, 0, 8)).toEqual([{ x: 0, y: 0, w: 100, h: 8 }])
    const both = panStripRects(100, 80, 10, -6)
    expect(both).toContainEqual({ x: 0, y: 0, w: 10, h: 80 })
    expect(both).toContainEqual({ x: 0, y: 74, w: 100, h: 6 })
  })
})

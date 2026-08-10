import { describe, expect, it } from 'vitest'
import { chooseTextMode, shapeText } from './shaping.js'

describe('shapeText', () => {
  it('shapes latin and cjk advances', () => {
    const shaped = shapeText('A中', 'sans-serif', 10)
    expect(shaped.glyphs).toHaveLength(2)
    expect(shaped.width).toBeGreaterThan(10)
  })

  it('resets glyph x and advances y for multiline text', () => {
    const shaped = shapeText('AB\n中文', 'sans-serif', 10)
    expect(shaped.glyphs).toHaveLength(4)
    expect(shaped.glyphs[2]?.x).toBe(0)
    expect(shaped.glyphs[2]?.y).toBe(10)
    expect(shaped.width).toBe(20)
    expect(shaped.height).toBe(20)
  })

  it('chooses render mode by screen size', () => {
    expect(chooseTextMode(2)).toBe('placeholder')
    expect(chooseTextMode(20)).toBe('msdf')
    expect(chooseTextMode(80)).toBe('outline')
  })
})

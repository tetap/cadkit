import { describe, expect, it } from 'vitest'
import {
  computeTickScale,
  convertLength,
  formatTickLabel,
  niceNumber,
  rasterPixelsToWorld,
  svgUserUnitsToWorld,
} from './units.js'

describe('units', () => {
  it('converts mm ↔ in', () => {
    expect(convertLength(25.4, 'mm', 'in')).toBeCloseTo(1, 6)
    expect(convertLength(1, 'in', 'mm')).toBeCloseTo(25.4, 6)
  })

  it('maps raster pixels at 96 DPI to mm', () => {
    expect(rasterPixelsToWorld(96, 'mm')).toBeCloseTo(25.4, 6)
    expect(rasterPixelsToWorld(192, 'mm')).toBeCloseTo(50.8, 6)
    expect(rasterPixelsToWorld(96, 'px')).toBeCloseTo(96, 6)
  })

  it('maps SVG user units at 72 DPI to mm', () => {
    expect(svgUserUnitsToWorld(72, 'mm')).toBeCloseTo(25.4, 6)
    expect(svgUserUnitsToWorld(36, 'mm')).toBeCloseTo(12.7, 6)
    expect(svgUserUnitsToWorld(72, 'pt')).toBeCloseTo(72, 6)
  })

  it('picks nice steps', () => {
    expect(niceNumber(48)).toBe(50)
    expect(niceNumber(12)).toBe(20)
  })

  it('computes tick scale for zoom', () => {
    const scale = computeTickScale(1, 'mm', 'mm', 80)
    expect(scale.major).toBeGreaterThan(0)
    expect(scale.minor).toBeCloseTo(scale.major / 10)
  })

  it('formats labels', () => {
    expect(formatTickLabel(0, 10)).toBe('0')
    expect(formatTickLabel(100, 50)).toBe('100')
  })
})

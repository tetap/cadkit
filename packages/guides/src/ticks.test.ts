import { describe, expect, it } from 'vitest'
import { Camera2D, computeTickScale } from '@cadkit/geometry'
import { generateGridLines, generateTicks } from './ticks.js'

describe('generateTicks', () => {
  it('emits major labels', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const ticks = generateTicks(cam, 'x', 'mm', 'mm', 800)
    expect(ticks.some((t) => t.kind === 'major' && t.label != null)).toBe(true)
    expect(ticks.some((t) => t.kind === 'minor')).toBe(true)
  })

  it('changes label spacing when display unit changes', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const mm = generateTicks(cam, 'x', 'mm', 'mm', 800).filter((t) => t.kind === 'major')
    const inch = generateTicks(cam, 'x', 'mm', 'in', 800).filter((t) => t.kind === 'major')
    // Both include origin 0; compare major step in display units
    const mmStep = (mm[1]?.value ?? 0) - (mm[0]?.value ?? 0)
    const inStep = (inch[1]?.value ?? 0) - (inch[0]?.value ?? 0)
    expect(mmStep).toBeGreaterThan(0)
    expect(inStep).toBeGreaterThan(0)
    expect(mmStep).not.toBe(inStep)
  })
})

describe('generateGridLines', () => {
  it('includes mid ticks so spacing matches minor step', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const scale = computeTickScale(1, 'mm', 'mm', 80)
    const lines = generateGridLines(cam, 'x', 'mm', 'mm', 800)
    const screens = lines.map((l) => l.screen).sort((a, b) => a - b)
    expect(screens.length).toBeGreaterThan(2)
    let maxGap = 0
    for (let i = 1; i < screens.length; i++) {
      maxGap = Math.max(maxGap, screens[i]! - screens[i - 1]!)
    }
    // Mid lines used to be dropped → gaps of 2×minor; now max gap ≈ minor (zoom=1)
    expect(maxGap).toBeLessThanOrEqual(scale.minor * cam.getState().zoom + 1e-6)
  })
})

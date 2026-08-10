import { describe, expect, it } from 'vitest'
import { arcTextLocalBounds, layoutArcText } from './arc-text.js'

describe('layoutArcText', () => {
  it('places symmetric glyphs along a positive sweep', () => {
    const poses = layoutArcText('OO', 10, { x: 0, y: 0 }, {
      kind: 'arc',
      radius: 100,
      startAngle: -Math.PI / 2,
      sweep: Math.PI,
    })
    expect(poses).toHaveLength(2)
    // Midpoints should sit near the top half of the circle.
    expect(poses[0]!.y).toBeLessThan(0)
    expect(poses[1]!.y).toBeLessThan(0)
    expect(poses[1]!.x).toBeGreaterThan(poses[0]!.x)
  })

  it('reverses travel for negative sweep', () => {
    const ccw = layoutArcText('AB', 10, { x: 0, y: 0 }, {
      kind: 'arc',
      radius: 50,
      startAngle: 0,
      sweep: Math.PI / 2,
    })
    const cw = layoutArcText('AB', 10, { x: 0, y: 0 }, {
      kind: 'arc',
      radius: 50,
      startAngle: 0,
      sweep: -Math.PI / 2,
    })
    expect(ccw[0]!.y).toBeGreaterThan(0)
    expect(cw[0]!.y).toBeLessThan(0)
  })

  it('bounds enclose glyph corners', () => {
    const box = arcTextLocalBounds('Hello', 12, { x: 10, y: 20 }, {
      kind: 'arc',
      radius: 40,
      startAngle: -Math.PI / 2,
      sweep: Math.PI,
    })
    expect(box.maxX - box.minX).toBeGreaterThan(20)
    expect(box.maxY - box.minY).toBeGreaterThan(20)
  })
})

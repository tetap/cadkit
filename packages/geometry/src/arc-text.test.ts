import { describe, expect, it } from 'vitest'
import {
  arcTextLocalBounds,
  layoutArcText,
  placeArcTextCentered,
  textVisualCenter,
} from './arc-text.js'

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

describe('placeArcTextCentered', () => {
  it('puts the string midpoint near the previous visual center', () => {
    const entity = {
      content: 'CADKit',
      position: { x: 100, y: 80 },
      fontSize: 20,
      fontFamily: 'sans-serif',
      align: 'left' as const,
    }
    const before = textVisualCenter(entity)
    const { position, path } = placeArcTextCentered(entity)
    expect(path.kind).toBe('arc')
    expect(path.radius).toBeGreaterThan(entity.fontSize)
    // Circle center sits below the text so the top of the arc is at the old center.
    expect(position.x).toBeCloseTo(before.x, 5)
    expect(position.y).toBeCloseTo(before.y + path.radius, 5)

    // Apex of the arc (angle -π/2) is the previous visual center.
    expect(position.x + path.radius * Math.cos(-Math.PI / 2)).toBeCloseTo(before.x, 5)
    expect(position.y + path.radius * Math.sin(-Math.PI / 2)).toBeCloseTo(before.y, 5)

    const poses = layoutArcText(
      entity.content,
      entity.fontSize,
      position,
      path,
      1,
      entity.fontFamily,
    )
    expect(poses.length).toBeGreaterThan(0)
    // Glyphs should straddle the apex horizontally.
    expect(poses[0]!.x).toBeLessThan(before.x)
    expect(poses[poses.length - 1]!.x).toBeGreaterThan(before.x)
  })
})

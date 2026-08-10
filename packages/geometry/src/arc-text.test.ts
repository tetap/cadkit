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

  it('em-box at the apex sits above the pose (Y-down)', () => {
    const center = { x: 0, y: 0 }
    const path = {
      kind: 'arc' as const,
      radius: 100,
      startAngle: -Math.PI / 2,
      sweep: Math.PI / 8,
    }
    const fontSize = 20
    const poses = layoutArcText('O', fontSize, center, path)
    expect(poses).toHaveLength(1)
    const pose = poses[0]!
    // Mid-character near the top: rotation ≈ 0, pose ≈ (0, -radius).
    expect(Math.abs(pose.rotation)).toBeLessThan(0.1)
    expect(pose.y).toBeCloseTo(-100, 0)

    const box = arcTextLocalBounds('O', fontSize, center, path)
    // Em-box hangs "above" the pose (smaller Y) for near-upright apex glyphs.
    expect(box.maxY).toBeLessThanOrEqual(pose.y + 1)
    expect(box.minY).toBeLessThan(pose.y - fontSize * 0.5)
    expect(box.minY).toBeGreaterThan(pose.y - fontSize * 1.5)
    expect(box.minX).toBeLessThan(pose.x)
    expect(box.maxX).toBeGreaterThan(pose.x)
  })

  it('rotated side glyphs expand the AABB outward from the pose', () => {
    const center = { x: 0, y: 0 }
    const path = {
      kind: 'arc' as const,
      radius: 50,
      startAngle: 0,
      sweep: 0.01,
      baseline: 'outer' as const,
    }
    const fontSize = 10
    const poses = layoutArcText('I', fontSize, center, path)
    const pose = poses[0]!
    const box = arcTextLocalBounds('I', fontSize, center, path)
    // Outer baseline at angle≈0: em-box grows in +X (away from center).
    expect(box.maxX).toBeGreaterThan(pose.x + fontSize * 0.5)
    expect(box.minX).toBeLessThanOrEqual(pose.x + 1e-6)
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

import { describe, expect, it } from 'vitest'
import type { TextWarp } from '@cadkit/types'
import {
  defaultTextWarp,
  isIdentityWarp,
  warpBoxFromPoints,
  warpContours,
  warpPoint,
} from './text-warp.js'

const box = { minX: 0, minY: 0, maxX: 100, maxY: 40 }

describe('text warp', () => {
  it('treats zero bend and perspective as identity', () => {
    expect(isIdentityWarp(undefined)).toBe(true)
    expect(isIdentityWarp({ style: 'arc', bend: 0 })).toBe(true)
    const p = { x: 20, y: 10 }
    expect(warpPoint(p, box, { style: 'wave', bend: 0, distortH: 0, distortV: 0 })).toEqual(p)
  })

  it('arcs the top-center upward (smaller Y) for positive fan bend', () => {
    const top = warpPoint({ x: 50, y: 0 }, box, { style: 'arc', bend: 0.6 })
    const left = warpPoint({ x: 0, y: 20 }, box, { style: 'arc', bend: 0.6 })
    const right = warpPoint({ x: 100, y: 20 }, box, { style: 'arc', bend: 0.6 })
    expect(top.y).toBeLessThan(0)
    expect(left.y).toBeGreaterThan(top.y)
    expect(right.y).toBeGreaterThan(top.y)
  })

  it('crown / flag lifts the middle and keeps the ends', () => {
    const mid = warpPoint({ x: 50, y: 20 }, box, { style: 'flag', bend: 0.8 })
    const end = warpPoint({ x: 0, y: 20 }, box, { style: 'flag', bend: 0.8 })
    expect(mid.y).toBeLessThan(end.y)
    expect(end.y).toBeCloseTo(20, 5)
  })

  it('crown / flag at 50% lifts the midline by a visible fraction of height', () => {
    const mid = warpPoint({ x: 50, y: 20 }, box, { style: 'flag', bend: 0.5 })
    expect(20 - mid.y).toBeGreaterThan(8)
  })

  it('crown / flag grows glyph height in the middle (envelope, not a mere shift)', () => {
    const warp = { style: 'flag' as const, bend: 0.5 }
    const midTop = warpPoint({ x: 50, y: 0 }, box, warp)
    const midBot = warpPoint({ x: 50, y: 40 }, box, warp)
    const endTop = warpPoint({ x: 0, y: 0 }, box, warp)
    const endBot = warpPoint({ x: 0, y: 40 }, box, warp)
    const midH = Math.abs(midBot.y - midTop.y)
    const endH = Math.abs(endBot.y - endTop.y)
    expect(midH).toBeGreaterThan(endH * 1.15)
  })

  it('flag + horizontal perspective makes the right-of-center peak taller', () => {
    const mild = warpPoint({ x: 80, y: 0 }, box, { style: 'flag', bend: 1, distortH: 0 })
    const persp = warpPoint({ x: 80, y: 0 }, box, { style: 'flag', bend: 1, distortH: 1 })
    expect(persp.y).toBeLessThan(mild.y - 8)
  })

  it('flag + H persp keeps the far-right end shorter than the mid-right peak', () => {
    const peak = warpPoint({ x: 70, y: 0 }, box, { style: 'flag', bend: 1, distortH: 1 })
    const tail = warpPoint({ x: 100, y: 0 }, box, { style: 'flag', bend: 1, distortH: 1 })
    expect(peak.y).toBeLessThan(tail.y - 4)
  })

  it('flag + H persp does not crush the left side to a sliver', () => {
    const leftTop = warpPoint({ x: 0, y: 0 }, box, { style: 'flag', bend: 1, distortH: 1 })
    const leftBot = warpPoint({ x: 0, y: 40 }, box, { style: 'flag', bend: 1, distortH: 1 })
    expect(Math.abs(leftBot.y - leftTop.y)).toBeGreaterThan(12)
  })

  it('horizontal perspective stretches the right side', () => {
    const right = warpPoint({ x: 100, y: 0 }, box, {
      style: 'arch',
      bend: 0,
      distortH: 1,
    })
    const left = warpPoint({ x: 0, y: 0 }, box, {
      style: 'arch',
      bend: 0,
      distortH: 1,
    })
    const midY = 20
    expect(Math.abs(right.y - midY)).toBeGreaterThan(Math.abs(left.y - midY))
  })

  it('densifies and warps closed contours', () => {
    const warp: TextWarp = defaultTextWarp('wave')
    warp.bend = 0.7
    const out = warpContours(
      [
        {
          closed: true as const,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 40 },
            { x: 0, y: 40 },
          ],
        },
      ],
      box,
      warp,
    )
    expect(out[0]!.points.length).toBeGreaterThan(4)
    const ys = out[0]!.points.map((p) => p.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(40)
  })

  it('builds a box from points', () => {
    const b = warpBoxFromPoints([
      { x: 3, y: 8 },
      { x: 11, y: 1 },
    ])
    expect(b).toEqual({ minX: 3, minY: 1, maxX: 11, maxY: 8 })
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildHeartPath,
  buildStarPath,
  clampRectCornerRadii,
  rebuildShapePoints,
  rectCornerHandleLocal,
  rectCornerRadiusFromLocal,
  starConstructionRadius,
  starCornerFromHandleX,
  starCornerHandleX,
  starTipsFromDelta,
  starTipsHandleLocal,
  tessellateRoundedRect,
} from './shapes.js'

describe('shapes', () => {
  it('tessellateRoundedRect returns closed-ish ring with radii', () => {
    const pts = tessellateRoundedRect(0, 0, 100, 60, 10)
    expect(pts.length).toBeGreaterThan(8)
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-6)
    expect(Math.max(...xs)).toBeLessThanOrEqual(100 + 1e-6)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e-6)
    expect(Math.max(...ys)).toBeLessThanOrEqual(60 + 1e-6)
  })

  it('buildHeartPath / buildStarPath are closed polylines', () => {
    const heart = buildHeartPath(0, 0, 40, 40)
    expect(heart.length).toBeGreaterThan(20)
    const star = buildStarPath(0, 0, 20, 5)
    expect(star.length).toBe(10)
    const filleted = buildStarPath(0, 0, 20, 5, 0.4, 2)
    expect(filleted.length).toBeGreaterThan(10)
  })

  it('clampRectCornerRadii prevents overflow', () => {
    const [tl, tr] = clampRectCornerRadii(20, 20, 30)
    expect(tl + tr).toBeLessThanOrEqual(20 + 1e-6)
  })

  it('rebuildShapePoints updates star tip count', () => {
    const box = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ]
    const a = rebuildShapePoints(box, { kind: 'star', points: 5 })
    const b = rebuildShapePoints(box, { kind: 'star', points: 8 })
    expect(a.length).toBe(10)
    expect(b.length).toBe(16)
  })

  it('rect corner handle mapping is invertible with visual pad', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 60 }
    const pad = 8
    for (const r of [0, 6, 12, 30]) {
      const p = rectCornerHandleLocal(box, 'tl', r, pad)
      expect(rectCornerRadiusFromLocal(box, 'tl', p, pad)).toBeCloseTo(r, 6)
    }
    const rounded = tessellateRoundedRect(0, 0, 100, 60, 12)
    const again = rebuildShapePoints(rounded, { kind: 'rect', cornerRadii: 12 })
    expect(again.length).toBeGreaterThan(4)
    const xs = again.map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(0, 5)
    expect(Math.max(...xs)).toBeCloseTo(100, 5)
  })

  it('star tip / corner handle mappings are invertible', () => {
    const cy = 50
    const cx = 40
    const outerR = 30
    const pad = 12
    const tip = starTipsHandleLocal(cx, cy, outerR, pad)
    expect(tip.x).toBeCloseTo(cx + outerR + pad, 6)
    expect(tip.y).toBeCloseTo(cy, 6)
    // Handle Y no longer encodes tip count — stays on the midline for any tips.
    for (const tips of [3, 5, 8, 12]) {
      expect(starTipsHandleLocal(cx, cy, outerR, pad).y).toBe(cy)
      expect(starTipsFromDelta(tips, outerR, 0)).toBe(tips)
      const step = Math.max(outerR * 0.15, 1e-3)
      expect(starTipsFromDelta(tips, outerR, -step)).toBe(Math.min(24, tips + 1))
      expect(starTipsFromDelta(tips, outerR, step)).toBe(Math.max(3, tips - 1))
    }
    for (const corner of [0, 2, 5, outerR * 0.35]) {
      const x = starCornerHandleX(cx, outerR, corner)
      expect(starCornerFromHandleX(cx, outerR, x)).toBeCloseTo(corner, 6)
    }
  })

  it('starConstructionRadius survives corner fillet rebuilds', () => {
    const cx = 0
    const cy = 0
    const R = 40
    const tips = 5
    const corner = 6
    const filleted = buildStarPath(cx, cy, R, tips, 0.4, corner)
    const recovered = starConstructionRadius(filleted, cx, cy, tips, corner)
    expect(recovered).toBeCloseTo(R, 1)
    const again = rebuildShapePoints(filleted, { kind: 'star', points: tips, cornerRadii: corner })
    const r2 = starConstructionRadius(again, cx, cy, tips, corner)
    expect(r2).toBeCloseTo(R, 1)
  })
})

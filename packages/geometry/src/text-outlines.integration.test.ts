import { describe, expect, it, afterEach } from 'vitest'
import {
  createEntityId,
  createLayerId,
  IDENTITY_TRANSFORM,
  type TextEntity,
} from '@cadkit/types'
import { entityToOffsetContours, offsetEntity } from './offset.js'
import { clearTextOutlineCache, textEntityToLocalOutlines } from './text-outlines.js'
import { installFakeCanvas } from './fake-canvas.js'
import { layoutArcText } from './arc-text.js'

const layer = createLayerId('0')

function text(partial: Partial<TextEntity> & Pick<TextEntity, 'content' | 'position' | 'fontSize'>): TextEntity {
  return {
    id: createEntityId(),
    type: 'text',
    layerId: layer,
    style: { stroke: '#111', fill: '#111' },
    transform: IDENTITY_TRANSFORM,
    version: 1,
    fontFamily: 'sans-serif',
    ...partial,
  }
}

describe('text outlines integration (fake canvas)', () => {
  let restore: (() => void) | undefined
  afterEach(() => {
    restore?.()
    restore = undefined
    clearTextOutlineCache()
  })

  it('straight text outlines sit on the baseline em-box (Y-down)', () => {
    restore = installFakeCanvas()
    const e = text({
      content: 'Hi',
      position: { x: 100, y: 200 },
      fontSize: 20,
      align: 'left',
    })
    const outlines = textEntityToLocalOutlines(e, { pixelsPerEm: 4 })
    expect(outlines.length).toBeGreaterThanOrEqual(1)
    const xs = outlines.flatMap((c) => c.points.map((p) => p.x))
    const ys = outlines.flatMap((c) => c.points.map((p) => p.y))
    // Em-box: y in [baseline-fontSize, baseline] = [180, 200]
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(180 - 2)
    expect(Math.max(...ys)).toBeLessThanOrEqual(200 + 2)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(100 - 2)
    expect(Math.max(...xs)).toBeGreaterThan(100 + 5)
  })

  it('center-aligned straight text is centered on position.x', () => {
    restore = installFakeCanvas()
    const e = text({
      content: 'ABCD',
      position: { x: 50, y: 80 },
      fontSize: 10,
      align: 'center',
    })
    const outlines = textEntityToLocalOutlines(e, { pixelsPerEm: 6 })
    expect(outlines.length).toBeGreaterThanOrEqual(1)
    const xs = outlines.flatMap((c) => c.points.map((p) => p.x))
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2
    expect(mid).toBeCloseTo(50, 0)
  })

  it('arc text outlines stay near glyph poses (not arc endpoints only)', () => {
    restore = installFakeCanvas()
    const e = text({
      content: 'ABC',
      position: { x: 0, y: 0 },
      fontSize: 12,
      path: {
        kind: 'arc',
        radius: 80,
        startAngle: -Math.PI / 2,
        sweep: Math.PI / 2,
      },
    })
    const poses = layoutArcText(e.content, e.fontSize, e.position, e.path!, 1, e.fontFamily)
    const outlines = textEntityToLocalOutlines(e, { pixelsPerEm: 4 })
    expect(outlines.length).toBeGreaterThanOrEqual(1)

    // Every pose should have some outline point within ~1.5em.
    for (const g of poses) {
      if (!g.char.trim()) continue
      let nearest = Infinity
      for (const c of outlines) {
        for (const p of c.points) {
          nearest = Math.min(nearest, Math.hypot(p.x - g.x, p.y - g.y))
        }
      }
      expect(nearest).toBeLessThan(e.fontSize * 1.6)
    }

    // Must not collapse to a single blob only at the first arc endpoint.
    const all = outlines.flatMap((c) => c.points)
    const span = Math.hypot(
      Math.max(...all.map((p) => p.x)) - Math.min(...all.map((p) => p.x)),
      Math.max(...all.map((p) => p.y)) - Math.min(...all.map((p) => p.y)),
    )
    expect(span).toBeGreaterThan(e.fontSize * 2)
  })

  it('offsetEntity on text yields closed contours near the glyphs', () => {
    restore = installFakeCanvas()
    const e = text({
      content: 'X',
      position: { x: 10, y: 40 },
      fontSize: 16,
    })
    const src = entityToOffsetContours(e)
    expect(src.length).toBeGreaterThanOrEqual(1)
    const out = offsetEntity(e, { distance: 2, direction: 'external', join: 'round' })
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[0]!.closed).toBe(true)
    const ys = out[0]!.points.map((p) => p.y)
    // Offset expands around em-box [24,40]
    expect(Math.min(...ys)).toBeLessThan(24)
    expect(Math.max(...ys)).toBeGreaterThan(40)
  })

  it('caches outlines so a pure translate reuses rings', () => {
    restore = installFakeCanvas()
    const e = text({
      content: 'Hi',
      position: { x: 10, y: 20 },
      fontSize: 16,
    })
    const a = textEntityToLocalOutlines(e, { pixelsPerEm: undefined })
    expect(a.length).toBeGreaterThanOrEqual(1)
    const moved = { ...e, position: { x: 40, y: 55 }, version: e.version + 1 }
    const b = textEntityToLocalOutlines(moved)
    expect(b.length).toBe(a.length)
    const dx = b[0]!.points[0]!.x - a[0]!.points[0]!.x
    const dy = b[0]!.points[0]!.y - a[0]!.points[0]!.y
    expect(dx).toBeCloseTo(30, 5)
    expect(dy).toBeCloseTo(35, 5)
  })

  it('returns [] without canvas (fallback path stays available)', () => {
    const e = text({
      content: 'NoCanvas',
      position: { x: 0, y: 0 },
      fontSize: 12,
    })
    expect(textEntityToLocalOutlines(e)).toEqual([])
    const fallback = entityToOffsetContours(e)
    // AABB fallback
    expect(fallback.length).toBe(1)
    expect(fallback[0]!.closed).toBe(true)
  })
})

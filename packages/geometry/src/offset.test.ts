import { describe, expect, it } from 'vitest'
import { IDENTITY_TRANSFORM, createEntityId, createLayerId } from '@cadkit/types'
import { offsetContours, offsetEntities, offsetEntity } from './offset.js'

const layer = createLayerId('0')

function squareEntity(x: number, y: number, s: number) {
  return {
    id: createEntityId(),
    type: 'polyline' as const,
    layerId: layer,
    style: {},
    transform: IDENTITY_TRANSFORM,
    version: 1,
    closed: true,
    points: [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ],
  }
}

describe('offsetContours', () => {
  it('inflates a unit square externally', () => {
    const square = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    }
    const out = offsetContours([square], { distance: 2, direction: 'external', join: 'miter' })
    expect(out.length).toBeGreaterThanOrEqual(1)
    const xs = out[0]!.points.map((p) => p.x)
    const ys = out[0]!.points.map((p) => p.y)
    expect(Math.min(...xs)).toBeLessThan(-1.5)
    expect(Math.max(...xs)).toBeGreaterThan(11.5)
    expect(Math.min(...ys)).toBeLessThan(-1.5)
    expect(Math.max(...ys)).toBeGreaterThan(11.5)
  })

  it('deflates a square inwardly', () => {
    const square = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
    }
    const out = offsetContours([square], { distance: 3, direction: 'inner', join: 'round' })
    expect(out.length).toBe(1)
    const xs = out[0]!.points.map((p) => p.x)
    const ys = out[0]!.points.map((p) => p.y)
    expect(Math.min(...xs)).toBeGreaterThan(2)
    expect(Math.max(...xs)).toBeLessThan(18)
    expect(Math.min(...ys)).toBeGreaterThan(2)
    expect(Math.max(...ys)).toBeLessThan(18)
  })
})

describe('offsetEntities', () => {
  it('unions overlapping multi-select offsets into one outline', () => {
    const a = squareEntity(0, 0, 20)
    const b = squareEntity(10, 10, 20)
    const opts = { distance: 4, direction: 'external' as const, join: 'round' as const }
    // Per-entity offset (old Editor behavior) leaves multiple loops.
    const separate = [...offsetEntity(a, opts), ...offsetEntity(b, opts)]
    expect(separate.length).toBeGreaterThan(1)

    const out = offsetEntities([a, b], opts, () => undefined)
    expect(out.length).toBe(1)
    expect(out[0]!.closed).toBe(true)
    const xs = out[0]!.points.map((p) => p.x)
    const ys = out[0]!.points.map((p) => p.y)
    expect(Math.min(...xs)).toBeLessThan(-2)
    expect(Math.max(...xs)).toBeGreaterThan(32)
    expect(Math.min(...ys)).toBeLessThan(-2)
    expect(Math.max(...ys)).toBeGreaterThan(32)
  })

  it('keeps outer + hole as one compound contour after offset', () => {
    const outer = squareEntity(0, 0, 40)
    const hole = {
      ...squareEntity(10, 10, 20),
      // CW hole (opposite of CCW outer from squareEntity order).
      points: [
        { x: 10, y: 10 },
        { x: 10, y: 30 },
        { x: 30, y: 30 },
        { x: 30, y: 10 },
      ],
    }
    const opts = { distance: 2, direction: 'external' as const, join: 'round' as const }
    const out = offsetEntities([outer, hole], opts, () => undefined)
    expect(out.length).toBe(1)
    expect(out[0]!.holes?.length).toBeGreaterThanOrEqual(1)
    const holePts = out[0]!.holes![0]!
    const hxs = holePts.map((p) => p.x)
    const hys = holePts.map((p) => p.y)
    // External offset shrinks the hole inward.
    expect(Math.min(...hxs)).toBeGreaterThan(10)
    expect(Math.max(...hxs)).toBeLessThan(30)
    expect(Math.min(...hys)).toBeGreaterThan(10)
    expect(Math.max(...hys)).toBeLessThan(30)
  })
})

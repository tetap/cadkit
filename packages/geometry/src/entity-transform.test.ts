import { describe, expect, it } from 'vitest'
import { IDENTITY_TRANSFORM, createEntityId, createLayerId } from '@cadkit/types'
import { bakeTextAffine } from './entity-transform.js'
import { scale, translate, multiply, transformPoint, type Matrix3 } from './matrix.js'

/** T(c) · S(sx,sy) · T(-c) — same as selection-transform.scaleMatrixAbout. */
function scaleAbout(c: { x: number; y: number }, sx: number, sy: number): Matrix3 {
  return multiply(translate(c.x, c.y), multiply(scale(sx, sy), translate(-c.x, -c.y)))
}

describe('bakeTextAffine', () => {
  it('tracks axis-aligned non-uniform scale for arc text', () => {
    const text = {
      id: createEntityId('t'),
      type: 'text' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'ARC',
      position: { x: 0, y: 0 },
      fontFamily: 'sans-serif',
      fontSize: 10,
      widthFactor: 1,
      path: {
        kind: 'arc' as const,
        radius: 100,
        startAngle: 0,
        sweep: Math.PI,
      },
    }
    // Scale about origin: sx=2, sy=1.5 (no translation in the linear map).
    const m = multiply(translate(0, 0), scale(2, 1.5))
    const baked = bakeTextAffine(text, m)
    expect(baked.fontSize).toBeCloseTo(15)
    expect(baked.widthFactor).toBeCloseTo(2 / 1.5)
    expect(baked.path?.kind).toBe('arc')
    if (baked.path?.kind === 'arc') {
      expect(baked.path.radius).toBeCloseTo(200)
    }
  })

  it('horizontal mirror of upright text flips widthFactor, keeps rotation 0', () => {
    const text = {
      id: createEntityId('t'),
      type: 'text' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'Hi',
      position: { x: 50, y: 40 },
      fontFamily: 'sans-serif',
      fontSize: 20,
      widthFactor: 1,
      rotation: 0,
    }
    const m = scaleAbout({ x: 0, y: 40 }, -1, 1)
    const baked = bakeTextAffine(text, m)
    expect(baked.position).toEqual({ x: -50, y: 40 })
    expect(baked.rotation ?? 0).toBeCloseTo(0)
    expect(baked.widthFactor).toBeCloseTo(-1)
    expect(baked.fontSize).toBeCloseTo(20)
  })

  it('horizontal mirror of rotated text recomposes frame (no runaway rotation)', () => {
    const text = {
      id: createEntityId('t'),
      type: 'text' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'Hi',
      position: { x: 100, y: 50 },
      fontFamily: 'sans-serif',
      fontSize: 20,
      widthFactor: 1,
      rotation: Math.PI / 2,
    }
    const center = { x: 100, y: 50 }
    const m = scaleAbout(center, -1, 1)
    const baked = bakeTextAffine(text, m)
    // Position stays on the mirror plane through the anchor.
    expect(baked.position.x).toBeCloseTo(100)
    expect(baked.position.y).toBeCloseTo(50)
    // World H-flip ∘ R(π/2) ⇒ R(-π/2) with widthFactor -1 — NOT R(π/2) + wf=-1.
    expect(baked.rotation ?? 0).toBeCloseTo(-Math.PI / 2)
    expect(baked.widthFactor).toBeCloseTo(-1)
    expect(baked.fontSize).toBeCloseTo(20)

    // Local +X unit maps to the same world offset before/after bake.
    const before = transformPoint(
      multiply(scale(-1, 1), [0, 1, -1, 0, 0, 0]),
      { x: 1, y: 0 },
    )
    const θ = baked.rotation ?? 0
    const wf = baked.widthFactor ?? 1
    const afterLocal: [number, number, number, number, number, number] = [
      wf * Math.cos(θ),
      wf * Math.sin(θ),
      -Math.sin(θ),
      Math.cos(θ),
      0,
      0,
    ]
    const after = transformPoint(afterLocal, { x: 1, y: 0 })
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })
})

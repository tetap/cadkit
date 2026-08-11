import { describe, expect, it } from 'vitest'
import { IDENTITY_TRANSFORM, createEntityId, createLayerId } from '@cadkit/types'
import { bakeTextAffine } from './entity-transform.js'
import { scale, translate, multiply } from './matrix.js'

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
})

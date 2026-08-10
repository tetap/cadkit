import { describe, expect, it } from 'vitest'
import { collectSnaps, bestSnap } from './snap.js'
import { worldPoint, createEntityId, createLayerId, IDENTITY_TRANSFORM } from '@cadkit/types'

describe('snap', () => {
  it('finds endpoint', () => {
    const entities = [
      {
        id: createEntityId(),
        type: 'line' as const,
        layerId: createLayerId(),
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
      },
    ]
    const hits = collectSnaps(entities, worldPoint(0.1, 0.1), {
      enabled: true,
      pixelTolerance: 8,
      worldPerPixel: 1,
    })
    expect(bestSnap(hits)?.type).toBe('endpoint')
  })
})

import { describe, expect, it } from 'vitest'
import { ChunkStore } from './chunk-store.js'
import { createEntityId, createLayerId, IDENTITY_TRANSFORM } from '@cadkit/types'

describe('ChunkStore', () => {
  it('partitions and queries', () => {
    const entities = Array.from({ length: 10 }, (_, i) => ({
      id: createEntityId(),
      type: 'line' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: i * 1000, y: 0 },
      end: { x: i * 1000 + 1, y: 1 },
    }))
    const chunks = ChunkStore.partition(entities, 500)
    const store = new ChunkStore(64)
    for (const c of chunks) store.put(c)
    expect(store.size()).toBeGreaterThan(0)
    const hits = store.query({ minX: 0, minY: -1, maxX: 1500, maxY: 2 })
    expect(hits.length).toBeGreaterThan(0)
  })
})

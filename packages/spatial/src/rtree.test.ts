import { describe, expect, it } from 'vitest'
import { RTree, SpatialIndex } from './rtree.js'
import { asEntityId } from '@cadkit/types'

describe('RTree', () => {
  it('finds intersecting items', () => {
    const tree = new RTree()
    tree.bulkLoad([
      { id: asEntityId('a'), bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
      { id: asEntityId('b'), bounds: { minX: 100, minY: 100, maxX: 110, maxY: 110 } },
      { id: asEntityId('c'), bounds: { minX: 5, minY: 5, maxX: 15, maxY: 15 } },
    ])
    const hits = tree.search({ minX: 0, minY: 0, maxX: 12, maxY: 12 })
    expect(hits).toContain(asEntityId('a'))
    expect(hits).toContain(asEntityId('c'))
    expect(hits).not.toContain(asEntityId('b'))
  })
})

describe('SpatialIndex', () => {
  it('applies delta over static tree', () => {
    const index = new SpatialIndex()
    index.bulkLoad([{ id: asEntityId('a'), bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }])
    index.upsert({ id: asEntityId('b'), bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 } })
    index.remove(asEntityId('a'))
    const hits = index.search({ minX: 0, minY: 0, maxX: 3, maxY: 3 })
    expect(hits).toEqual([asEntityId('b')])
  })
})

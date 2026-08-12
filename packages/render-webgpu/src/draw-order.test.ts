import { describe, expect, it } from 'vitest'
import type { RenderItem } from '@cadkit/scene'
import { createEntityId } from '@cadkit/types'
import { packDrawOrder } from './draw-order.js'

function item(partial: Partial<RenderItem> & Pick<RenderItem, 'zOrder' | 'kind' | 'coords'>): RenderItem {
  return {
    id: createEntityId('e'),
    styleKey: 'k',
    stroke: '#111827',
    strokeWidth: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    lod: 0,
    pickId: 1,
    ...partial,
  }
}

function closedSquare(zOrder: number, fill: string, stroke: string): RenderItem {
  return item({
    zOrder,
    kind: 'polyline',
    fill,
    stroke,
    coords: new Float64Array([0, 0, 10, 0, 10, 10, 0, 10, 0, 0]),
  })
}

describe('packDrawOrder', () => {
  it('interleaves fill then stroke per entity so front layers stay on top', () => {
    const back = closedSquare(0, '#ff0000', '#000000')
    const front = closedSquare(1_000_000, '#0000ff', '#ffffff')
    const packed = packDrawOrder([back, front])

    expect(packed.ops.map((op) => op.kind)).toEqual(['fill', 'stroke', 'fill', 'stroke'])
    expect(packed.fillVertexCount).toBeGreaterThan(0)
    expect(packed.strokeVertexCount).toBeGreaterThan(0)
  })

  it('packs AA rect instances compactly (32B each)', () => {
    const a = item({
      zOrder: 0,
      kind: 'instance',
      stroke: '#32cd79',
      coords: new Float64Array([0, 0, 8, 8]),
    })
    const b = item({
      zOrder: 1,
      kind: 'instance',
      stroke: '#32cd79',
      coords: new Float64Array([10, 0, 8, 8]),
    })
    const packed = packDrawOrder([a, b])
    expect(packed.instanceCount).toBe(2)
    expect(packed.instanceData.byteLength).toBe(64)
    expect(packed.ops).toEqual([{ kind: 'rectStroke', firstInstance: 0, instanceCount: 2 }])
    expect(packed.strokeVertexCount).toBe(0)
  })

  it('places images between entities by zOrder', () => {
    const back = closedSquare(0, '#ff0000', 'none')
    const image = item({
      zOrder: 500_000,
      kind: 'image',
      stroke: 'none',
      coords: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]),
      assetId: 'a',
    })
    const front = closedSquare(1_000_000, '#0000ff', 'none')
    const packed = packDrawOrder([back, image, front])
    expect(packed.ops.map((op) => op.kind)).toEqual(['fill', 'image', 'fill'])
    expect(packed.ops[1]).toMatchObject({ kind: 'image', itemIndex: 1 })
  })

  it('merges consecutive same-kind ops within a run', () => {
    const a = closedSquare(0, '#ff0000', 'none')
    const b = closedSquare(1, '#00ff00', 'none')
    const packed = packDrawOrder([a, b])
    expect(packed.ops).toHaveLength(1)
    expect(packed.ops[0]!.kind).toBe('fill')
    expect(packed.ops[0]!.kind === 'fill' && packed.ops[0]!.vertexCount).toBe(packed.fillVertexCount)
  })
})

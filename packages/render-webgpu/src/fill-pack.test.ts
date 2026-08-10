import { describe, expect, it } from 'vitest'
import { createEntityId, emptyAABB } from '@cadkit/types'
import type { RenderItem } from '@cadkit/scene'
import { parseColor } from './color.js'
import { isClosedRing, packEntityFillVertices } from './fill-pack.js'

function item(partial: Partial<RenderItem> & Pick<RenderItem, 'kind' | 'coords'>): RenderItem {
  return {
    id: createEntityId('e'),
    zOrder: 0,
    styleKey: '',
    stroke: '#000',
    strokeWidth: 1,
    bounds: emptyAABB(),
    lod: 0,
    pickId: 1,
    ...partial,
  }
}

describe('parseColor', () => {
  it('handles transparent and 8-digit hex', () => {
    expect(parseColor('transparent')[3]).toBe(0)
    expect(parseColor('#32cd7940')[3]).toBeCloseTo(64 / 255)
    expect(parseColor('#ff0000')[0]).toBeCloseTo(1)
  })
})

describe('packEntityFillVertices', () => {
  it('fan-triangulates a closed rectangle', () => {
    const rect = item({
      kind: 'polyline',
      fill: '#ff0000',
      coords: new Float64Array([0, 0, 10, 0, 10, 8, 0, 8, 0, 0]),
    })
    expect(isClosedRing(rect.kind, rect.coords)).toBe(true)
    const packed = packEntityFillVertices([rect])
    // 4 unique verts → 2 triangles → 6 vertices
    expect(packed.vertexCount).toBe(6)
  })

  it('skips transparent fill and open polylines', () => {
    const open = item({
      kind: 'polyline',
      fill: '#00ff00',
      coords: new Float64Array([0, 0, 10, 0, 10, 8]),
    })
    const clear = item({
      kind: 'polyline',
      fill: 'transparent',
      coords: new Float64Array([0, 0, 10, 0, 10, 8, 0, 8, 0, 0]),
    })
    expect(packEntityFillVertices([open, clear]).vertexCount).toBe(0)
  })
})

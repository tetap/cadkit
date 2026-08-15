import { describe, expect, it } from 'vitest'
import { createEntityId, emptyAABB } from '@cadkit/types'
import type { RenderItem } from '@cadkit/scene'
import { parseColor } from './color.js'
import { isClosedRing, packEntityFillVertices } from './fill-pack.js'
import { triangulateRing } from './triangulate.js'

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
  it('earcuts a closed rectangle into 2 triangles', () => {
    const rect = item({
      kind: 'polyline',
      fill: '#ff0000',
      coords: new Float64Array([0, 0, 10, 0, 10, 8, 0, 8, 0, 0]),
    })
    expect(isClosedRing(rect.kind, rect.coords)).toBe(true)
    const packed = packEntityFillVertices([rect])
    // 2 triangles → 6 vertices
    expect(packed.vertexCount).toBe(6)
  })

  it('keeps concave star-like rings inside the outline (no centroid spill)', () => {
    // Arrowhead / concave chevron: centroid fan would cover the notch.
    const ring = item({
      kind: 'polyline',
      fill: '#00aa00',
      coords: new Float64Array([0, 0, 10, 5, 0, 10, 3, 5, 0, 0]),
    })
    const { vertices, indices } = triangulateRing(ring.coords)
    expect(indices.length).toBeGreaterThanOrEqual(3)
    // Every triangle vertex must lie on the ring (earcut only uses ring verts).
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(vertices.length / 2)
    }
  })

  it('honors a hole so the counter stays empty', () => {
    const outer = new Float64Array([0, 0, 100, 0, 100, 100, 0, 100, 0, 0])
    const hole = new Float64Array([20, 20, 80, 20, 80, 80, 20, 80, 20, 20])
    const packed = packEntityFillVertices([
      item({ kind: 'polyline', fill: '#111111', coords: outer, holes: [hole] }),
    ])
    expect(packed.vertexCount).toBeGreaterThan(0)
    // No triangle centroid should land deep inside the hole.
    for (let i = 0; i < packed.vertexCount; i += 3) {
      const ax = packed.vertexData[i * 6]!
      const ay = packed.vertexData[i * 6 + 1]!
      const bx = packed.vertexData[(i + 1) * 6]!
      const by = packed.vertexData[(i + 1) * 6 + 1]!
      const cx = packed.vertexData[(i + 2) * 6]!
      const cy = packed.vertexData[(i + 2) * 6 + 1]!
      const mx = (ax + bx + cx) / 3
      const my = (ay + by + cy) / 3
      const inHole = mx > 25 && mx < 75 && my > 25 && my < 75
      expect(inHole).toBe(false)
    }
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

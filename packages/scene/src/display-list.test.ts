import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { Camera2D } from '@cadkit/geometry'
import {
  DEFAULT_PERFORMANCE_CONFIG,
  IDENTITY_TRANSFORM,
  createEntityId,
} from '@cadkit/types'
import { SceneProjector } from './display-list.js'

function addSquare(doc: CadDocument, x: number, y: number, size = 8) {
  const id = createEntityId('sq')
  return doc.add({
    id,
    type: 'polyline',
    layerId: doc.getDefaultLayerId(),
    style: { stroke: '#32cd79' },
    transform: IDENTITY_TRANSFORM,
    version: 1,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
    closed: true,
  })
}

describe('SceneProjector', () => {
  it('projects closed squares with closing segment', () => {
    const doc = new CadDocument()
    const change = addSquare(doc, 0, 0)
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    scene.applyChange(change)
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(10)
    const { items, stats } = scene.build(cam)
    expect(stats.visibleCount).toBe(1)
    expect(items[0]!.kind).toBe('polyline')
    // 4 corners + close back to start → 5 points → 10 coords
    expect(items[0]!.coords.length).toBe(10)
    expect(scene.getPickId(change.added[0]!)).toBeGreaterThan(0)
  })

  it('skips invisible entities and supports query', () => {
    const doc = new CadDocument()
    const id = createEntityId('line')
    const change = doc.add({
      id,
      type: 'line',
      layerId: doc.getDefaultLayerId(),
      style: { stroke: '#fff', visible: false },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    scene.applyChange(change)
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    expect(scene.build(cam).items).toHaveLength(0)
    expect(scene.query({ minX: -1, minY: -1, maxX: 20, maxY: 20 })).toContain(id)
  })
})

import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { Camera2D, clearTextOutlineCache } from '@cadkit/geometry'
import {
  DEFAULT_PERFORMANCE_CONFIG,
  IDENTITY_TRANSFORM,
  createEntityId,
} from '@cadkit/types'
import { SceneProjector } from './display-list.js'
// Test-only stub (not part of @cadkit/geometry public exports).
import { installFakeCanvas } from '../../geometry/src/fake-canvas.js'

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
    // Axis-aligned closed squares project as compact GPU instances.
    expect(items[0]!.kind).toBe('instance')
    expect(items[0]!.coords.length).toBe(4)
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

  it('reorders zOrder when entity stack changes within a layer', () => {
    const doc = new CadDocument()
    const layer = doc.getDefaultLayerId()
    const backId = createEntityId('back')
    const frontId = createEntityId('front')
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    scene.applyChange(
      doc.add({
        id: backId,
        type: 'polyline',
        layerId: layer,
        style: { stroke: '#111', fill: '#aaa' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        closed: true,
      }),
    )
    scene.applyChange(
      doc.add({
        id: frontId,
        type: 'polyline',
        layerId: layer,
        style: { stroke: '#111', fill: '#f00' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        points: [
          { x: 5, y: 5 },
          { x: 25, y: 5 },
          { x: 25, y: 25 },
          { x: 5, y: 25 },
        ],
        closed: true,
      }),
    )
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(10)

    let built = scene.build(cam)
    expect(built.items.find((i) => i.id === frontId)!.zOrder).toBeGreaterThan(
      built.items.find((i) => i.id === backId)!.zOrder,
    )

    doc.sendToBack([frontId])
    scene.notifyStackChanged()
    built = scene.build(cam)
    expect(built.items.find((i) => i.id === backId)!.zOrder).toBeGreaterThan(
      built.items.find((i) => i.id === frontId)!.zOrder,
    )
  })

  it('reorders zOrder when layer stack changes (panel top = front)', () => {
    const doc = new CadDocument()
    const backLayer = doc.getDefaultLayerId()
    const frontLayer = doc.addLayer({ name: 'Front', color: '#ef4444' })
    // addLayer prepends → frontLayer is index 0 (front), backLayer index 1.
    const backId = createEntityId('back')
    const frontId = createEntityId('front')
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    scene.applyChange(
      doc.add({
        id: backId,
        type: 'polyline',
        layerId: backLayer,
        style: { stroke: '#111', fill: '#aaa' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        closed: true,
      }),
    )
    scene.applyChange(
      doc.add({
        id: frontId,
        type: 'polyline',
        layerId: frontLayer.id,
        style: { stroke: '#111', fill: '#f00' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        points: [
          { x: 5, y: 5 },
          { x: 25, y: 5 },
          { x: 25, y: 25 },
          { x: 5, y: 25 },
        ],
        closed: true,
      }),
    )
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(10)

    let built = scene.build(cam)
    const frontItem = built.items.find((i) => i.id === frontId)!
    const backItem = built.items.find((i) => i.id === backId)!
    expect(frontItem.zOrder).toBeGreaterThan(backItem.zOrder)
    expect(scene.getStackOrder(frontId)).toBe(frontItem.zOrder)

    // Move former back layer to panel top (front).
    doc.reorderLayers([backLayer, frontLayer.id])
    scene.notifyLayersChanged()
    built = scene.build(cam)
    const afterBack = built.items.find((i) => i.id === backId)!
    const afterFront = built.items.find((i) => i.id === frontId)!
    expect(afterBack.zOrder).toBeGreaterThan(afterFront.zOrder)
    expect(built.items.indexOf(afterFront)).toBeLessThan(built.items.indexOf(afterBack))
  })

  it('projects text as closed vector outline polylines', () => {
    let restore: (() => void) | undefined
    try {
      restore = installFakeCanvas()
      clearTextOutlineCache()
      const doc = new CadDocument()
      const id = createEntityId('text')
      const change = doc.add({
        id,
        type: 'text',
        layerId: doc.getDefaultLayerId(),
        style: { stroke: '#111827', strokeWidth: 1 },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        content: 'A',
        position: { x: 0, y: 0 },
        fontFamily: 'sans-serif',
        fontSize: 20,
      })
      const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
      scene.applyChange(change)
      const cam = new Camera2D()
      cam.setViewport(800, 600)
      cam.setZoom(10)
      const items = scene.build(cam).items.filter((i) => i.id === id)
      expect(items.length).toBeGreaterThanOrEqual(1)
      for (const item of items) {
        expect(item.kind).toBe('polyline')
        expect(item.coords.length).toBeGreaterThanOrEqual(6)
        // Closed ring: last ≈ first
        const n = item.coords.length
        expect(item.coords[0]).toBeCloseTo(item.coords[n - 2]!, 6)
        expect(item.coords[1]).toBeCloseTo(item.coords[n - 1]!, 6)
      }
    } finally {
      restore?.()
      clearTextOutlineCache()
    }
  })

  it('layer engraver mode filters stroke vs fill in the display list', () => {
    const doc = new CadDocument()
    const layer = doc.addLayer({ name: 'Fill', color: '#ef4444' })
    doc.updateLayer(layer.id, {
      gcode: { mode: 'fill', lineSpacing: 0.1, fillStyle: 'bidirectional', power: 500, speed: 1000, passes: 1 },
    })
    const id = createEntityId('poly')
    const change = doc.add({
      id,
      type: 'polyline',
      layerId: layer.id,
      style: { stroke: '#111827', fill: '#2563eb', strokeWidth: 2 },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      closed: true,
    })
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    scene.applyChange(change)
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(10)

    let item = scene.build(cam).items[0]!
    expect(item.fill).toBe('#2563eb')
    // Fill mode keeps stroke so open paths / outlines stay visible.
    expect(item.stroke).toBe('#111827')

    doc.updateLayer(layer.id, {
      gcode: { mode: 'line', lineSpacing: 0.1, fillStyle: 'bidirectional', power: 500, speed: 1000, passes: 1 },
    })
    scene.notifyLayersChanged()
    item = scene.build(cam).items[0]!
    expect(item.stroke).toBe('#111827')
    expect(item.fill).toBeUndefined()
  })
})

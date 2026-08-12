import { describe, expect, it } from 'vitest'
import {
  CadDocument,
  isImageLayer,
  layerAcceptsEntity,
  resolveLayerAwarePaint,
  resolveLayerGcode,
} from './document.js'

describe('CadDocument layers', () => {
  it('creates layers with distinct palette colors', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const a = doc.addLayer({ name: 'A' })
    const b = doc.addLayer({ name: 'B' })
    expect(a.color).toBeTruthy()
    expect(b.color).toBeTruthy()
    expect(a.color).not.toBe(b.color)
  })

  it('moves entities when removing a layer', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const extra = doc.addLayer({ name: 'Extra', color: '#ef4444' })
    const line = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 1 })
    line.layerId = extra.id
    doc.add(line)
    expect(doc.removeLayer(extra.id)).toBe(true)
    expect(doc.getEntity(line.id)?.layerId).toBe(doc.getDefaultLayerId())
  })

  it('isolates image layers from vector entities', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const imageLayer = doc.addLayer({ name: 'Image' })
    doc.updateLayer(imageLayer.id, {
      gcode: { ...resolveLayerGcode(imageLayer), mode: 'image' },
    })
    const vector = doc.getLayer(doc.getDefaultLayerId())!
    expect(isImageLayer(doc.getLayer(imageLayer.id))).toBe(true)
    expect(layerAcceptsEntity(doc.getLayer(imageLayer.id), { type: 'image' })).toBe(true)
    expect(layerAcceptsEntity(doc.getLayer(imageLayer.id), { type: 'line' })).toBe(false)
    expect(layerAcceptsEntity(vector, { type: 'image' })).toBe(false)
    expect(layerAcceptsEntity(vector, { type: 'polyline' })).toBe(true)
  })

  it('stores GRBL gcode params on the layer', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const layer = doc.addLayer({ name: 'Cut' })
    expect(resolveLayerGcode(layer).mode).toBe('line')
    doc.updateLayer(layer.id, {
      gcode: {
        mode: 'fill',
        lineSpacing: 0.2,
        fillStyle: 'crossHatch',
        fillAngle: 45,
        power: 800,
        speed: 2000,
        passes: 2,
      },
    })
    const next = doc.getLayer(layer.id)!
    expect(next.gcode?.mode).toBe('fill')
    expect(next.gcode?.fillStyle).toBe('crossHatch')
    expect(resolveLayerGcode(next).lineSpacing).toBeCloseTo(0.2)
    expect(resolveLayerGcode(next).fillAngle).toBeCloseTo(45)
    const restored = CadDocument.fromJSON(doc.toJSON()).getLayer(layer.id)!
    expect(restored.gcode?.power).toBe(800)
    // Unknown / legacy fill styles collapse to bidirectional.
    expect(
      resolveLayerGcode({
        ...next,
        gcode: { ...resolveLayerGcode(next), fillStyle: 'offset' as never },
      }).fillStyle,
    ).toBe('bidirectional')
  })

  it('resolveLayerAwarePaint: line drops fill, fill drops stroke', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const layer = doc.addLayer({ name: 'Paint', color: '#ef4444' })
    const linePaint = resolveLayerAwarePaint(layer, {
      stroke: '#111827',
      fill: '#2563eb',
      strokeWidth: 2,
    })
    expect(linePaint.stroke).toBe('#111827')
    expect(linePaint.fill).toBeUndefined()
    expect(linePaint.strokeWidth).toBe(2)

    doc.updateLayer(layer.id, { gcode: { ...resolveLayerGcode(layer), mode: 'fill' } })
    const fillLayer = doc.getLayer(layer.id)!
    const fillPaint = resolveLayerAwarePaint(fillLayer, {
      stroke: '#111827',
      fill: '#2563eb',
      strokeWidth: 2,
    })
    expect(fillPaint.stroke).toBe('none')
    expect(fillPaint.fill).toBe('#2563eb')

    const fillFromStroke = resolveLayerAwarePaint(fillLayer, {
      stroke: '#111827',
      fill: 'none',
    })
    expect(fillFromStroke.stroke).toBe('none')
    expect(fillFromStroke.fill).toBe('#111827')
  })

  it('reorders layers and preserves order in JSON', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const base = doc.getDefaultLayerId()
    const a = doc.addLayer({ name: 'A' })
    const b = doc.addLayer({ name: 'B' })
    // New layers are prepended (front of stack).
    expect(doc.getLayers().map((l) => l.id)).toEqual([b.id, a.id, base])
    doc.reorderLayers([base, b.id, a.id])
    expect(doc.getLayers().map((l) => l.id)).toEqual([base, b.id, a.id])
    expect(doc.getLayerIndex(base)).toBe(0)
    expect(doc.getLayerIndex(a.id)).toBe(2)

    const json = doc.toJSON()
    expect(json.layers.map((l) => l.id)).toEqual([base, b.id, a.id])
    const restored = CadDocument.fromJSON(json)
    expect(restored.getLayers().map((l) => l.id)).toEqual([base, b.id, a.id])
  })
})

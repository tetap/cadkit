import { describe, expect, it } from 'vitest'
import { CadDocument, resolveLayerGcode } from './document.js'

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

  it('stores GRBL gcode params on the layer', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const layer = doc.addLayer({ name: 'Cut' })
    expect(resolveLayerGcode(layer).mode).toBe('line')
    doc.updateLayer(layer.id, {
      gcode: { mode: 'fill', lineSpacing: 0.2, fillStyle: 'crossHatch', power: 800, speed: 2000, passes: 2 },
    })
    const next = doc.getLayer(layer.id)!
    expect(next.gcode?.mode).toBe('fill')
    expect(next.gcode?.fillStyle).toBe('crossHatch')
    expect(resolveLayerGcode(next).lineSpacing).toBeCloseTo(0.2)
    const restored = CadDocument.fromJSON(doc.toJSON()).getLayer(layer.id)!
    expect(restored.gcode?.power).toBe(800)
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

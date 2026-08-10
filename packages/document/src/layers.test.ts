import { describe, expect, it } from 'vitest'
import { CadDocument } from './document.js'

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
})

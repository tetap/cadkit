import { describe, expect, it } from 'vitest'
import { CadDocument } from './document.js'

describe('CadDocument', () => {
  it('adds line and tracks bounds', () => {
    const doc = new CadDocument()
    const line = doc.createLine({ x: 0, y: 0 }, { x: 10, y: 5 })
    doc.add(line)
    expect(doc.count()).toBe(1)
    const bounds = doc.getBounds(line.id)!
    expect(bounds.minX).toBe(0)
    expect(bounds.maxX).toBe(10)
    expect(bounds.maxY).toBe(5)
  })

  it('serializes and restores', () => {
    const doc = new CadDocument({ unit: 'mm' })
    doc.add(doc.createLine({ x: 1, y: 2 }, { x: 3, y: 4 }))
    const json = doc.toJSON()
    const restored = CadDocument.fromJSON(json)
    expect(restored.count()).toBe(1)
    expect(restored.getConfig().unit).toBe('mm')
  })

  it('updates bump version', () => {
    const doc = new CadDocument()
    const line = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 1 })
    doc.add(line)
    const v0 = doc.getVersion()
    doc.update(line.id, { end: { x: 2, y: 2 } } as never)
    expect(doc.getVersion()).toBeGreaterThan(v0)
  })
})

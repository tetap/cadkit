import { describe, expect, it } from 'vitest'
import { IDENTITY_TRANSFORM, createEntityId } from '@cadkit/types'
import { CadDocument } from './document.js'

function addLine(doc: CadDocument, layerId?: string) {
  const line = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 1 })
  if (layerId) line.layerId = layerId as never
  doc.add(line)
  return line.id
}

describe('CadDocument entityOrder', () => {
  it('prepends new entities to the front of their layer', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const layer = doc.getDefaultLayerId()
    const a = addLine(doc)
    const b = addLine(doc)
    const c = addLine(doc)
    expect(doc.getEntityOrder(layer)).toEqual([c, b, a])
  })

  it('supports bring/send stack ops and JSON round-trip', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const layer = doc.getDefaultLayerId()
    const a = addLine(doc)
    const b = addLine(doc)
    const c = addLine(doc)
    // order front→back: c, b, a
    expect(doc.bringForward([a])).toBe(true)
    expect(doc.getEntityOrder(layer)).toEqual([c, a, b])
    expect(doc.sendBackward([c])).toBe(true)
    expect(doc.getEntityOrder(layer)).toEqual([a, c, b])
    expect(doc.bringToFront([b])).toBe(true)
    expect(doc.getEntityOrder(layer)).toEqual([b, a, c])
    expect(doc.sendToBack([b])).toBe(true)
    expect(doc.getEntityOrder(layer)).toEqual([a, c, b])

    const json = doc.toJSON()
    expect(json.entityOrder?.[layer]).toEqual([a, c, b])
    const restored = CadDocument.fromJSON(json)
    expect(restored.getEntityOrder(layer)).toEqual([a, c, b])
  })

  it('moves block as a unit for multi-select', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const layer = doc.getDefaultLayerId()
    const a = addLine(doc)
    const b = addLine(doc)
    const c = addLine(doc)
    // c, b, a — move {b,a} forward one → b, a, c
    expect(doc.bringForward([b, a])).toBe(true)
    expect(doc.getEntityOrder(layer)).toEqual([b, a, c])
  })

  it('moves entity order when layerId changes', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const base = doc.getDefaultLayerId()
    const other = doc.addLayer({ name: 'Other' })
    const id = addLine(doc)
    expect(doc.getEntityOrder(base)).toContain(id)
    doc.update(id, { layerId: other.id } as never)
    expect(doc.getEntityOrder(base)).not.toContain(id)
    expect(doc.getEntityOrder(other.id)[0]).toBe(id)
  })

  it('rebuilds order from entities array when entityOrder missing', () => {
    const doc = new CadDocument({ unit: 'mm' })
    const layer = doc.getDefaultLayerId()
    const a = createEntityId('a')
    const b = createEntityId('b')
    const json = {
      schemaVersion: 1,
      unit: 'mm' as const,
      tolerance: 1e-6,
      layers: doc.getLayers(),
      entities: [
        {
          id: a,
          type: 'line' as const,
          layerId: layer,
          style: {},
          transform: IDENTITY_TRANSFORM,
          version: 1,
          start: { x: 0, y: 0 },
          end: { x: 1, y: 0 },
        },
        {
          id: b,
          type: 'line' as const,
          layerId: layer,
          style: {},
          transform: IDENTITY_TRANSFORM,
          version: 1,
          start: { x: 0, y: 1 },
          end: { x: 1, y: 1 },
        },
      ],
    }
    const restored = CadDocument.fromJSON(json)
    expect(restored.getEntityOrder(layer)).toEqual([a, b])
  })
})

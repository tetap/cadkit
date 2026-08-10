import { describe, expect, it } from 'vitest'
import { IDENTITY_TRANSFORM, createEntityId, createGroupId } from '@cadkit/types'
import { CadDocument } from './document.js'

describe('CadDocument extras', () => {
  it('addMany / remove / group', () => {
    const doc = new CadDocument()
    const a = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 0 })
    const b = doc.createLine({ x: 0, y: 1 }, { x: 1, y: 1 })
    const change = doc.addMany([a, b])
    expect(change.added).toHaveLength(2)
    expect(doc.count()).toBe(2)

    const gid = createGroupId()
    const groupChange = doc.group([a.id, b.id], {
      id: gid as unknown as ReturnType<typeof createEntityId>,
      type: 'group',
      groupId: gid,
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      children: [a.id, b.id],
    })
    expect(groupChange.added.length + groupChange.updated.length).toBeGreaterThan(0)

    doc.remove(a.id)
    expect(doc.getEntity(a.id)).toBeUndefined()
  })

  it('clearEntities wipes all entities in one shot', () => {
    const doc = new CadDocument()
    doc.addMany([
      doc.createLine({ x: 0, y: 0 }, { x: 1, y: 0 }),
      doc.createLine({ x: 0, y: 1 }, { x: 1, y: 1 }),
    ])
    expect(doc.count()).toBe(2)
    doc.clearEntities()
    expect(doc.count()).toBe(0)
    expect(doc.getEntityIds()).toEqual([])
  })
})

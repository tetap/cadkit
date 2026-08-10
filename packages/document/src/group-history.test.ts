import { describe, expect, it } from 'vitest'
import { IDENTITY_TRANSFORM, createEntityId, createGroupId } from '@cadkit/types'
import { entityWorldBounds, resolveWorldMatrix, translate } from '@cadkit/geometry'
import { CadDocument } from './document.js'

function line(doc: CadDocument, x0: number, y0: number, x1: number, y1: number) {
  const e = doc.createLine({ x: x0, y: y0 }, { x: x1, y: y1 })
  doc.add(e)
  return e
}

describe('CadDocument group/ungroup/remove invariants', () => {
  it('removeSubtree detaches from parent children list', () => {
    const doc = new CadDocument()
    const a = line(doc, 0, 0, 10, 0)
    const b = line(doc, 0, 5, 10, 5)
    const gid = createGroupId()
    doc.group([a.id, b.id], {
      id: gid as unknown as ReturnType<typeof createEntityId>,
      type: 'group',
      groupId: gid,
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      children: [a.id, b.id],
    })
    doc.removeSubtree(a.id)
    const g = doc.getEntity(gid as unknown as ReturnType<typeof createEntityId>)
    expect(g?.type === 'group' && g.children).toEqual([b.id])
    expect(doc.getEntity(a.id)).toBeUndefined()
  })

  it('ungroup bakes group translation into leaf geometry', () => {
    const doc = new CadDocument()
    const a = line(doc, 0, 0, 10, 0)
    const gid = createGroupId()
    const groupId = gid as unknown as ReturnType<typeof createEntityId>
    doc.group([a.id], {
      id: groupId,
      type: 'group',
      groupId: gid,
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: translate(100, 50) as unknown as typeof IDENTITY_TRANSFORM,
      version: 1,
      children: [a.id],
    })
    const before = entityWorldBounds(
      doc.getEntity(a.id)!,
      resolveWorldMatrix(doc.getEntity(a.id)!, (id) => doc.getEntity(id)),
    )
    doc.ungroup(groupId)
    const afterEnt = doc.getEntity(a.id)!
    expect(afterEnt.parentId).toBeUndefined()
    expect(afterEnt.type === 'line' && afterEnt.start.x).toBeCloseTo(100)
    expect(afterEnt.type === 'line' && afterEnt.start.y).toBeCloseTo(50)
    const after = entityWorldBounds(
      afterEnt,
      resolveWorldMatrix(afterEnt, (id) => doc.getEntity(id)),
    )
    expect(after.minX).toBeCloseTo(before.minX)
    expect(after.minY).toBeCloseTo(before.minY)
    expect(after.maxX).toBeCloseTo(before.maxX)
  })

  it('nested group world translate stays stable via parent-local transform', () => {
    const doc = new CadDocument()
    const a = line(doc, 0, 0, 10, 0)
    const innerId = createGroupId()
    const outerId = createGroupId()
    doc.group([a.id], {
      id: innerId as unknown as ReturnType<typeof createEntityId>,
      type: 'group',
      groupId: innerId,
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      children: [a.id],
    })
    doc.group([innerId as unknown as ReturnType<typeof createEntityId>], {
      id: outerId as unknown as ReturnType<typeof createEntityId>,
      type: 'group',
      groupId: outerId,
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: translate(20, 0) as unknown as typeof IDENTITY_TRANSFORM,
      version: 1,
      children: [innerId as unknown as ReturnType<typeof createEntityId>],
    })
    const inner = doc.getEntity(innerId as unknown as ReturnType<typeof createEntityId>)!
    const worldBefore = entityWorldBounds(
      doc.getEntity(a.id)!,
      resolveWorldMatrix(doc.getEntity(a.id)!, (id) => doc.getEntity(id)),
    )
    // Move inner by world +10 → parent-local should account for outer translate (still +10 here)
    doc.update(inner.id, {
      transform: translate(10, 0) as unknown as typeof IDENTITY_TRANSFORM,
    } as never)
    const worldAfter = entityWorldBounds(
      doc.getEntity(a.id)!,
      resolveWorldMatrix(doc.getEntity(a.id)!, (id) => doc.getEntity(id)),
    )
    expect(worldAfter.minX - worldBefore.minX).toBeCloseTo(10)
  })

  it('addMany bumps version once', () => {
    const doc = new CadDocument()
    const a = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 0 })
    const b = doc.createLine({ x: 0, y: 1 }, { x: 1, y: 1 })
    const v0 = doc.getVersion()
    doc.addMany([a, b])
    expect(doc.getVersion()).toBe(v0 + 1)
    expect(doc.count()).toBe(2)
  })
})

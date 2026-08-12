import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { IDENTITY_TRANSFORM, createEntityId, createGroupId, type EntityId } from '@cadkit/types'
import {
  AddEntityCommand,
  GroupCommand,
  HistoryStack,
  MutateEntitiesCommand,
  RemoveEntityCommand,
  ReorderEntitiesCommand,
  UngroupCommand,
  UpdateEntityCommand,
} from './history.js'

describe('HistoryStack', () => {
  it('undoes add', () => {
    const doc = new CadDocument()
    const history = new HistoryStack(doc)
    const line = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 1 })
    history.execute(new AddEntityCommand(line))
    expect(doc.count()).toBe(1)
    history.undo()
    expect(doc.count()).toBe(0)
    history.redo()
    expect(doc.count()).toBe(1)
  })

  it('coalesces updates', () => {
    const doc = new CadDocument()
    const history = new HistoryStack(doc)
    const line = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 1 })
    history.execute(new AddEntityCommand(line))
    history.execute(new UpdateEntityCommand(line.id, { end: { x: 2, y: 2 } } as never, 'drag'))
    history.execute(new UpdateEntityCommand(line.id, { end: { x: 3, y: 3 } } as never, 'drag'))
    history.undo()
    const entity = doc.getEntity(line.id)
    expect(entity && entity.type === 'line' && entity.end.x).toBe(1)
  })

  it('coalesces multi-entity mutate as one undo', () => {
    const doc = new CadDocument()
    const history = new HistoryStack(doc)
    const a = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 0 })
    const b = doc.createLine({ x: 0, y: 2 }, { x: 1, y: 2 })
    history.execute(new AddEntityCommand(a))
    history.execute(new AddEntityCommand(b))

    const p1 = new Map<EntityId, Partial<typeof a>>([
      [a.id, { start: { x: 5, y: 0 }, end: { x: 6, y: 0 } } as never],
      [b.id, { start: { x: 5, y: 2 }, end: { x: 6, y: 2 } } as never],
    ])
    history.execute(new MutateEntitiesCommand(p1, 'drag-session'))
    const p2 = new Map<EntityId, Partial<typeof a>>([
      [a.id, { start: { x: 8, y: 0 }, end: { x: 9, y: 0 } } as never],
      [b.id, { start: { x: 8, y: 2 }, end: { x: 9, y: 2 } } as never],
    ])
    history.execute(new MutateEntitiesCommand(p2, 'drag-session'))

    const la = doc.getEntity(a.id)
    expect(la && la.type === 'line' && la.start.x).toBe(8)
    history.undo()
    const restored = doc.getEntity(a.id)
    expect(restored && restored.type === 'line' && restored.start.x).toBe(0)
  })

  it('group/ungroup undo-redo restores subtree and world geometry', () => {
    const doc = new CadDocument()
    const history = new HistoryStack(doc)
    const a = doc.createLine({ x: 0, y: 0 }, { x: 10, y: 0 })
    const b = doc.createLine({ x: 0, y: 5 }, { x: 10, y: 5 })
    history.execute(new AddEntityCommand(a))
    history.execute(new AddEntityCommand(b))
    const gid = createGroupId()
    const group = {
      id: gid as unknown as EntityId,
      type: 'group' as const,
      groupId: gid,
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      children: [a.id, b.id],
    }
    history.execute(new GroupCommand([a.id, b.id], group))
    expect(doc.getEntity(a.id)?.parentId).toBe(group.id)

    history.execute(new UngroupCommand(group.id))
    expect(doc.getEntity(group.id)).toBeUndefined()
    expect(doc.getEntity(a.id)?.parentId).toBeUndefined()

    history.undo() // redo group via undo ungroup
    expect(doc.getEntity(group.id)?.type).toBe('group')
    expect(doc.getEntity(a.id)?.parentId).toBe(group.id)

    history.undo() // undo group
    expect(doc.getEntity(group.id)).toBeUndefined()
    expect(doc.count()).toBe(2)
  })

  it('removeSubtree undo restores group children', () => {
    const doc = new CadDocument()
    const history = new HistoryStack(doc)
    const a = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 0 })
    const b = doc.createLine({ x: 0, y: 1 }, { x: 1, y: 1 })
    history.execute(new AddEntityCommand(a))
    history.execute(new AddEntityCommand(b))
    const gid = createGroupId()
    const group = {
      id: gid as unknown as EntityId,
      type: 'group' as const,
      groupId: gid,
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      children: [a.id, b.id],
    }
    history.execute(new GroupCommand([a.id, b.id], group))
    history.execute(new RemoveEntityCommand(group.id))
    expect(doc.count()).toBe(0)
    history.undo()
    expect(doc.count()).toBe(3)
    expect(doc.getEntity(a.id)?.parentId).toBe(group.id)
    expect(createEntityId).toBeTruthy()
  })

  it('undoes entity stack reorder', () => {
    const doc = new CadDocument()
    const history = new HistoryStack(doc)
    const a = doc.createLine({ x: 0, y: 0 }, { x: 1, y: 0 })
    const b = doc.createLine({ x: 0, y: 1 }, { x: 1, y: 1 })
    history.execute(new AddEntityCommand(a))
    history.execute(new AddEntityCommand(b))
    const layer = doc.getDefaultLayerId()
    expect(doc.getEntityOrder(layer)[0]).toBe(b.id)
    history.execute(new ReorderEntitiesCommand('back', [b.id]))
    expect(doc.getEntityOrder(layer)).toEqual([a.id, b.id])
    history.undo()
    expect(doc.getEntityOrder(layer)[0]).toBe(b.id)
    history.redo()
    expect(doc.getEntityOrder(layer)).toEqual([a.id, b.id])
  })
})


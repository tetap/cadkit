import { describe, expect, it } from 'vitest'
import { translate } from '@cadkit/geometry'
import {
  IDENTITY_TRANSFORM,
  createEntityId,
  createGroupId,
  createLayerId,
  type Entity,
  type GroupEntity,
} from '@cadkit/types'
import { handleEditPatch, translateEntityPatch } from './entity-edit.js'

const layer = createLayerId()

describe('entity-edit', () => {
  it('translates line and polyline', () => {
    const line = {
      id: createEntityId(),
      type: 'line' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    }
    const patch = translateEntityPatch(line, 2, 3)
    expect(patch).toEqual({ start: { x: 2, y: 3 }, end: { x: 12, y: 3 } })
  })

  it('edits circle radius handle', () => {
    const circle = {
      id: createEntityId('c'),
      type: 'circle' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      center: { x: 0, y: 0 },
      radius: 5,
    }
    const patch = handleEditPatch(
      circle,
      {
        id: `${circle.id}:radius`,
        entityId: circle.id,
        kind: 'radius',
        world: { x: 5, y: 0, __space: 'world' },
        cursor: 'ew-resize',
      },
      { x: 10, y: 0 },
    )
    expect(patch).toEqual({ radius: 10 })
  })

  it('writes nested line endpoints in parent-local space', () => {
    const groupId = createGroupId()
    const groupEntityId = groupId as unknown as Entity['id']
    const childId = createEntityId('child')
    const group: GroupEntity = {
      id: groupEntityId,
      type: 'group',
      groupId,
      layerId: layer,
      style: {},
      transform: translate(100, 0) as unknown as typeof IDENTITY_TRANSFORM,
      version: 1,
      children: [childId],
    }
    const child: Entity = {
      id: childId,
      type: 'line',
      layerId: layer,
      parentId: groupEntityId,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    }
    const lookup = (id: Entity['id']) => (id === group.id ? group : id === child.id ? child : undefined)
    const patch = handleEditPatch(
      child,
      {
        id: `${child.id}:end`,
        entityId: child.id,
        kind: 'endpoint',
        world: { x: 110, y: 0, __space: 'world' },
        cursor: 'move',
      },
      { x: 130, y: 20 },
      lookup,
    )
    expect(patch).toEqual({ end: { x: 30, y: 20 } })
  })
})

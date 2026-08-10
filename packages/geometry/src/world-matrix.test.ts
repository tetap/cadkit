import { describe, expect, it } from 'vitest'
import {
  IDENTITY_TRANSFORM,
  createEntityId,
  createGroupId,
  type Entity,
  type GroupEntity,
} from '@cadkit/types'
import { multiply, rotate, resolveWorldMatrix, transformPoint } from './index.js'

describe('resolveWorldMatrix', () => {
  it('composes parent group transform', () => {
    const childId = createEntityId('line')
    const groupId = createGroupId()
    const groupEntityId = groupId as unknown as Entity['id']
    const rot = rotate(Math.PI / 2)
    const group: GroupEntity = {
      id: groupEntityId,
      type: 'group',
      groupId,
      layerId: '0' as Entity['layerId'],
      style: {},
      transform: [rot[0], rot[1], rot[2], rot[3], rot[4], rot[5]],
      version: 1,
      children: [childId],
    }
    const child: Entity = {
      id: childId,
      type: 'line',
      layerId: group.layerId,
      parentId: groupEntityId,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 10, y: 0 },
      end: { x: 20, y: 0 },
    }
    const map = new Map<string, Entity>([
      [child.id, child],
      [group.id, group],
    ])
    const m = resolveWorldMatrix(child, (id) => map.get(id))
    const p = transformPoint(m, child.start)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(10)
    expect(multiply(rot, IDENTITY_TRANSFORM as unknown as typeof rot)).toEqual(m)
  })
})

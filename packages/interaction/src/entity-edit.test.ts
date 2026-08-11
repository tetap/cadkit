import { describe, expect, it } from 'vitest'
import { arcTextStringMidpoint, translate } from '@cadkit/geometry'
import {
  IDENTITY_TRANSFORM,
  createEntityId,
  createGroupId,
  createLayerId,
  type Entity,
  type GroupEntity,
} from '@cadkit/types'
import {
  handleEditPatch,
  removePolylineVertices,
  translateEntityPatch,
} from './entity-edit.js'

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

  it('edits arc-text radius while keeping the string midpoint fixed', () => {
    const text = {
      id: createEntityId('t'),
      type: 'text' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'HELLO',
      position: { x: 0, y: 80 },
      fontFamily: 'sans-serif',
      fontSize: 14,
      path: {
        kind: 'arc' as const,
        radius: 80,
        startAngle: -Math.PI / 2,
        sweep: Math.PI,
      },
    }
    const before = arcTextStringMidpoint(text)!
    const startWorld = { x: before.x, y: before.y }
    const patch = handleEditPatch(
      text,
      {
        id: `${text.id}:arc-radius`,
        entityId: text.id,
        kind: 'radius',
        world: { x: startWorld.x, y: startWorld.y, __space: 'world' },
        cursor: 'ew-resize',
        appearance: 'arc-radius',
      },
      // Drag farther from the circle center (radius grows 1:1).
      { x: 0, y: -40 },
      undefined,
      {
        startWorld,
        startCenter: { ...text.position },
        startRadius: text.path.radius,
        sensitivity: 1,
      },
    )
    expect(patch).toBeTruthy()
    const path = (patch as { path: typeof text.path }).path
    const position = (patch as { position: { x: number; y: number } }).position
    expect(path.kind).toBe('arc')
    expect(path.radius).toBeGreaterThan(text.path.radius)
    const after = arcTextStringMidpoint({
      ...text,
      position,
      path,
    })!
    expect(after.x).toBeCloseTo(before.x, 1)
    expect(after.y).toBeCloseTo(before.y, 1)
  })

  it('moves arc-text circle center', () => {
    const text = {
      id: createEntityId('t'),
      type: 'text' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'Hi',
      position: { x: 10, y: 20 },
      fontFamily: 'sans-serif',
      fontSize: 12,
      path: {
        kind: 'arc' as const,
        radius: 50,
        startAngle: -Math.PI / 2,
        sweep: Math.PI,
      },
    }
    const patch = handleEditPatch(
      text,
      {
        id: `${text.id}:arc-center`,
        entityId: text.id,
        kind: 'center',
        world: { x: 10, y: 20, __space: 'world' },
        cursor: 'move',
        appearance: 'arc-center',
      },
      { x: 40, y: 60 },
    )
    expect(patch).toEqual({ position: { x: 40, y: 60 } })
  })

  it('slides arc-text around a fixed circle center', () => {
    const text = {
      id: createEntityId('t'),
      type: 'text' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'Hi',
      position: { x: 0, y: 0 },
      fontFamily: 'sans-serif',
      fontSize: 12,
      path: {
        kind: 'arc' as const,
        radius: 60,
        startAngle: -Math.PI / 2,
        sweep: Math.PI,
      },
    }
    const patch = handleEditPatch(
      text,
      {
        id: `${text.id}:arc-angle`,
        entityId: text.id,
        kind: 'angle',
        world: { x: 0, y: -60, __space: 'world' },
        cursor: 'grab',
        appearance: 'arc-angle',
      },
      { x: 60, y: 0 },
    )
    expect(patch).toBeTruthy()
    const path = (patch as { path: typeof text.path }).path
    expect((patch as { position?: unknown }).position).toBeUndefined()
    const mid = arcTextStringMidpoint({ ...text, path })!
    expect(mid.x).toBeCloseTo(60, 2)
    expect(mid.y).toBeCloseTo(0, 2)
  })

  it('dampens arc-text radius drag by sensitivity', () => {
    const text = {
      id: createEntityId('t'),
      type: 'text' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'Hi',
      position: { x: 0, y: 0 },
      fontFamily: 'sans-serif',
      fontSize: 12,
      path: {
        kind: 'arc' as const,
        radius: 100,
        startAngle: -Math.PI / 2,
        sweep: Math.PI,
      },
    }
    const startWorld = { x: 100, y: 0 }
    const patch = handleEditPatch(
      text,
      {
        id: `${text.id}:arc-radius`,
        entityId: text.id,
        kind: 'radius',
        world: { x: 100, y: 0, __space: 'world' },
        cursor: 'ew-resize',
        appearance: 'arc-radius',
      },
      { x: 140, y: 0 },
      undefined,
      { startWorld, startCenter: { x: 0, y: 0 }, startRadius: 100, sensitivity: 0.35 },
    )
    const path = (patch as { path: { radius: number } }).path
    // Delta distance = 40 → applied = 40 * 0.35 = 14.
    expect(path.radius).toBeCloseTo(114, 5)
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

  it('removes polyline vertices and drops the path when too few remain', () => {
    const poly = {
      id: createEntityId('poly'),
      type: 'polyline' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    }
    expect(removePolylineVertices(poly, [1])).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    })
    expect(removePolylineVertices(poly, [0, 1])).toBe('remove')
  })

  it('edits and removes hole vertices on compound polylines', () => {
    const poly = {
      id: createEntityId('donut'),
      type: 'polyline' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ],
      holes: [
        [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 30 },
          { x: 10, y: 30 },
        ],
      ],
    }
    const moved = handleEditPatch(
      poly,
      {
        id: `${poly.id}:h0:1`,
        entityId: poly.id,
        kind: 'endpoint',
        world: { x: 30, y: 10, __space: 'world' },
        cursor: 'move',
      },
      { x: 28, y: 12 },
    )
    expect(moved).toEqual({
      holes: [
        [
          { x: 10, y: 10 },
          { x: 28, y: 12 },
          { x: 30, y: 30 },
          { x: 10, y: 30 },
        ],
      ],
    })

    const afterDelete = removePolylineVertices(poly, [
      { holeIndex: 0, pointIndex: 0 },
      { holeIndex: 0, pointIndex: 1 },
    ])
    expect(afterDelete).toEqual({
      points: poly.points,
      holes: [],
    })
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

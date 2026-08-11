import { describe, expect, it } from 'vitest'
import { Camera2D, translate } from '@cadkit/geometry'
import {
  IDENTITY_TRANSFORM,
  createEntityId,
  createGroupId,
  createLayerId,
  screenPoint,
  type Entity,
  type GroupEntity,
} from '@cadkit/types'
import { buildsHandlesForEntity, hitTestHandle } from './handles.js'

describe('handles', () => {
  it('builds line and circle handles and hit-tests', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const line = {
      id: createEntityId('line'),
      type: 'line' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    }
    const handles = buildsHandlesForEntity(line, cam)
    expect(handles).toHaveLength(2)
    const hit = hitTestHandle(handles, screenPoint(0, 0), cam, 8)
    expect(hit?.kind).toBe('endpoint')

    const circle = {
      id: createEntityId('c'),
      type: 'circle' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      center: { x: 50, y: 50 },
      radius: 10,
    }
    expect(buildsHandlesForEntity(circle, cam)).toHaveLength(2)
  })

  it('builds arc-text center and radius handles at the string midpoint', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const text = {
      id: createEntityId('t'),
      type: 'text' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'HELLO',
      position: { x: 0, y: 100 },
      fontFamily: 'sans-serif',
      fontSize: 16,
      path: {
        kind: 'arc' as const,
        radius: 100,
        startAngle: -Math.PI / 2 - 0.2,
        sweep: Math.PI,
      },
    }
    const handles = buildsHandlesForEntity(text, cam)
    expect(handles).toHaveLength(3)
    expect(handles.map((h) => h.appearance)).toEqual([
      'arc-center',
      'arc-angle',
      'arc-radius',
    ])
    expect(handles[0]!.arcGuide).toBeTruthy()
    expect(handles[0]!.world.x).toBeCloseTo(0)
    expect(handles[0]!.world.y).toBeCloseTo(100)
    // Angle handle sits near the string midpoint (top of the arc).
    expect(handles[1]!.world.y).toBeLessThan(handles[0]!.world.y)
    // Radius handle sits past the text AABB right edge (clears scale handle).
    expect(handles[2]!.world.x).toBeGreaterThan(0)
  })

  it('projects nested child handles through the group world matrix', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const layer = createLayerId()
    const groupId = createGroupId()
    const groupEntityId = groupId as unknown as Entity['id']
    const childId = createEntityId('child')
    const group: GroupEntity = {
      id: groupEntityId,
      type: 'group',
      groupId,
      layerId: layer,
      style: {},
      // Translate group by (+200, +50)
      transform: translate(200, 50) as unknown as typeof IDENTITY_TRANSFORM,
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
      start: { x: 10, y: 20 },
      end: { x: 40, y: 20 },
    }
    const lookup = (id: Entity['id']) => (id === group.id ? group : id === child.id ? child : undefined)
    const handles = buildsHandlesForEntity(child, cam, lookup)
    expect(handles).toHaveLength(2)
    expect(handles[0]!.world.x).toBeCloseTo(210)
    expect(handles[0]!.world.y).toBeCloseTo(70)
    expect(handles[1]!.world.x).toBeCloseTo(240)
    expect(handles[1]!.world.y).toBeCloseTo(70)
  })
})

import { describe, expect, it } from 'vitest'
import {
  Camera2D,
  buildStarPath,
  starCenter,
  starCornerHandleX,
  starTipsHandleLocal,
  translate,
} from '@cadkit/geometry'
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
    // Full circle: center + radius + Arc opener.
    const circleHandles = buildsHandlesForEntity(circle, cam)
    expect(circleHandles.map((h) => h.id.replace(`${circle.id}:`, ''))).toEqual([
      'center',
      'radius',
      'arc-open',
    ])
    expect(circleHandles.find((h) => h.id.endsWith(':arc-open'))?.label).toBe('Arc')
  })

  it('builds arc Start / Sweep / center handles with labels', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const arc = {
      id: createEntityId('arc'),
      type: 'arc' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      center: { x: 0, y: 0 },
      radius: 50,
      startAngle: 0,
      endAngle: Math.PI / 2,
    }
    const handles = buildsHandlesForEntity(arc, cam)
    expect(handles.map((h) => h.id.split(':').pop())).toEqual(['center', 'arc-start', 'arc-sweep'])
    expect(handles.find((h) => h.id.endsWith(':arc-start'))?.label).toMatch(/^Start /)
    expect(handles.find((h) => h.id.endsWith(':arc-sweep'))?.label).toMatch(/^Sweep /)
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

  it('places rect corner handles along the radius diagonal', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const rect = {
      id: createEntityId('rect'),
      type: 'polyline' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
        { x: 0, y: 60 },
      ],
      closed: true,
      shape: { kind: 'rect' as const, cornerRadii: 15 },
    }
    const handles = buildsHandlesForEntity(rect, cam)
    const tl = handles.find((h) => h.id.endsWith(':corner:tl'))
    expect(tl).toBeTruthy()
    const pad = 10 // zoom = 1
    expect(tl!.world.x).toBeCloseTo((15 + pad) * Math.SQRT1_2, 5)
    expect(tl!.world.y).toBeCloseTo((15 + pad) * Math.SQRT1_2, 5)
  })

  it('places star tip / corner handles on the invertible mapping', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const cx = 50
    const cy = 60
    const outerR = 30
    const tips = 8
    const corner = 4
    const star = {
      id: createEntityId('star'),
      type: 'polyline' as const,
      layerId: createLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: buildStarPath(cx, cy, outerR, tips, 0.4, corner),
      closed: true,
      shape: { kind: 'star' as const, points: tips, cornerRadii: corner },
    }
    const handles = buildsHandlesForEntity(star, cam)
    const tip = handles.find((h) => h.appearance === 'star-tips')
    const rad = handles.find((h) => h.id.endsWith(':star-corner'))
    expect(tip).toBeTruthy()
    expect(rad).toBeTruthy()
    const { cy: cY } = starCenter(star.points)
    const expectedTip = starTipsHandleLocal(cx, cY, outerR, 12)
    expect(tip!.world.x).toBeCloseTo(expectedTip.x, 4)
    expect(tip!.world.y).toBeCloseTo(expectedTip.y, 4)
    expect(rad!.world.x).toBeCloseTo(starCornerHandleX(cx, outerR, corner), 4)
    expect(rad!.world.y).toBeCloseTo(cY, 4)
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

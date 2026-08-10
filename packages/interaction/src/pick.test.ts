import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { Camera2D } from '@cadkit/geometry'
import { SceneProjector } from '@cadkit/scene'
import {
  DEFAULT_PERFORMANCE_CONFIG,
  IDENTITY_TRANSFORM,
  createEntityId,
  createGroupId,
  createLayerId,
  screenPoint,
  worldPoint,
} from '@cadkit/types'
import { distanceToEntity, pickEntity } from './pick.js'

const layer = createLayerId()

describe('distanceToEntity', () => {
  it('hits line / polyline / circle', () => {
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
    expect(distanceToEntity(line, worldPoint(5, 1))).toBeCloseTo(1)

    const poly = {
      id: createEntityId(),
      type: 'polyline' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 8 },
        { x: 0, y: 8 },
      ],
      closed: true,
    }
    expect(distanceToEntity(poly, worldPoint(4, -0.5))).toBeCloseTo(0.5)

    const circle = {
      id: createEntityId(),
      type: 'circle' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      center: { x: 0, y: 0 },
      radius: 5,
    }
    expect(distanceToEntity(circle, worldPoint(5, 0))).toBeCloseTo(0)
  })
})

describe('pickEntity', () => {
  it('selects when the click is inside the AABB (not only on the stroke)', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)

    const id = createEntityId('rect')
    scene.applyChange(
      doc.add({
        id,
        type: 'polyline',
        layerId: doc.getDefaultLayerId(),
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
      }),
    )

    // Interior of the rectangle — far from any edge.
    const hit = pickEntity({ doc, camera, scene, pixelTolerance: 6 }, worldPoint(50, 30), screenPoint(50, 30))
    expect(hit).toBe(id)
  })

  it('picks the topmost (later) entity when AABBs overlap', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)

    const bottom = createEntityId('bottom')
    const top = createEntityId('top')
    scene.applyChange(
      doc.add({
        id: bottom,
        type: 'polyline',
        layerId: doc.getDefaultLayerId(),
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        points: [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
          { x: 80, y: 80 },
          { x: 0, y: 80 },
        ],
        closed: true,
      }),
    )
    scene.applyChange(
      doc.add({
        id: top,
        type: 'polyline',
        layerId: doc.getDefaultLayerId(),
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        points: [
          { x: 20, y: 20 },
          { x: 100, y: 20 },
          { x: 100, y: 100 },
          { x: 20, y: 100 },
        ],
        closed: true,
      }),
    )

    expect(scene.getPickId(top)!).toBeGreaterThan(scene.getPickId(bottom)!)
    const hit = pickEntity({ doc, camera, scene }, worldPoint(40, 40), screenPoint(40, 40))
    expect(hit).toBe(top)
  })

  it('picks a group via its aggregated AABB (empty space between children)', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)

    const a = createEntityId('a')
    const b = createEntityId('b')
    scene.applyChange(
      doc.add({
        id: a,
        type: 'polyline',
        layerId: doc.getDefaultLayerId(),
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        closed: true,
      }),
    )
    scene.applyChange(
      doc.add({
        id: b,
        type: 'polyline',
        layerId: doc.getDefaultLayerId(),
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        points: [
          { x: 80, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 20 },
          { x: 80, y: 20 },
        ],
        closed: true,
      }),
    )

    const gid = createGroupId()
    const groupId = gid as unknown as ReturnType<typeof createEntityId>
    scene.applyChange(
      doc.group([a, b], {
        id: groupId,
        type: 'group',
        groupId: gid,
        layerId: doc.getDefaultLayerId(),
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        children: [a, b],
      }),
    )

    // Midpoint between the two children — inside group AABB, outside both leaves.
    const hit = pickEntity({ doc, camera, scene }, worldPoint(50, 10), screenPoint(50, 10))
    expect(hit).toBe(groupId)

    // On a child leaf — prefer the leaf (object-mode will promote to group root).
    const onLeaf = pickEntity({ doc, camera, scene }, worldPoint(10, 10), screenPoint(10, 10))
    expect(onLeaf).toBe(a)
  })
})

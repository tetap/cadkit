import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { Camera2D } from '@cadkit/geometry'
import { SceneProjector } from '@cadkit/scene'
import {
  DEFAULT_PERFORMANCE_CONFIG,
  IDENTITY_TRANSFORM,
  createEntityId,
  createGroupId,
  screenPoint,
  worldPoint,
  type Entity,
  type EntityId,
  type GroupEntity,
} from '@cadkit/types'
import { SelectionSet } from './selection.js'
import { ToolManager } from './tools.js'
import { rotateMatrixAbout, patchesFromMatrix, aabbCenter } from './selection-transform.js'
import { cloneEntitySnapshot } from './selection-transform.js'

describe('group transform matrix', () => {
  it('rotates via group.transform without baking children geometry', () => {
    const doc = new CadDocument()
    const a = createEntityId('line')
    const b = createEntityId('line')
    doc.add({
      id: a,
      type: 'line',
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    doc.add({
      id: b,
      type: 'line',
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 10 },
      end: { x: 10, y: 10 },
    })
    const gid = createGroupId()
    const group: GroupEntity = {
      id: gid as unknown as EntityId,
      type: 'group',
      groupId: gid,
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      children: [a, b],
    }
    doc.group([a, b], group)

    const snap = cloneEntitySnapshot(doc.getEntity(group.id)!)
    const bounds = doc.getBounds(group.id)!
    const c = aabbCenter(bounds)
    const patches = patchesFromMatrix(
      new Map([[group.id, snap]]),
      rotateMatrixAbout(c, Math.PI / 2),
    )
    doc.update(group.id, patches.get(group.id)!)

    const childA = doc.getEntity(a)
    expect(childA?.type).toBe('line')
    if (childA?.type === 'line') {
      expect(childA.start.x).toBe(0)
      expect(childA.start.y).toBe(0)
      expect(childA.end.x).toBe(10)
      expect(childA.end.y).toBe(0)
    }
    const g = doc.getEntity(group.id)
    expect(g?.type).toBe('group')
    if (g?.type === 'group') {
      expect(g.transform[0]).not.toBe(1)
      expect(Math.abs(g.transform[0])).toBeCloseTo(0, 5)
      expect(Math.abs(g.transform[1])).toBeCloseTo(1, 5)
    }
  })

  it('select + rotate handle updates group matrix in tools', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const a = createEntityId('line')
    scene.applyChange(
      doc.add({
        id: a,
        type: 'line',
        layerId: doc.getDefaultLayerId(),
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        start: { x: 100, y: 100 },
        end: { x: 140, y: 100 },
      }),
    )
    const b = createEntityId('line')
    scene.applyChange(
      doc.add({
        id: b,
        type: 'line',
        layerId: doc.getDefaultLayerId(),
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        start: { x: 100, y: 120 },
        end: { x: 140, y: 120 },
      }),
    )
    const gid = createGroupId()
    const group: GroupEntity = {
      id: gid as unknown as EntityId,
      type: 'group',
      groupId: gid,
      layerId: doc.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      children: [a, b],
    }
    scene.applyChange(doc.group([a, b], group))
    selection.set([group.id])

    const tools = new ToolManager({
      doc,
      camera,
      scene,
      selection,
      snap: { enabled: false, pixelTolerance: 8, worldPerPixel: 1, angleStepDeg: 0 },
      ortho: false,
      applyPatches: (patches) => {
        for (const [id, patch] of patches) {
          const c = doc.update(id, patch)
          if (c) scene.applyChange(c)
        }
      },
    })

    const frame = tools.getSelectionFrameAABB()!
    const cx = (frame.minX + frame.maxX) / 2
    const top = frame.minY
    // Grab rotate handle roughly above top-center
    const rotWorld = worldPoint(cx, top - 28)
    const rotScreen = camera.worldToScreen(rotWorld)
    tools.pointerDown(rotScreen, rotWorld, 0)
    // Drag to 90° from start angle
    const endWorld = worldPoint(cx + 50, top + 50)
    tools.pointerMove(camera.worldToScreen(endWorld), endWorld)
    tools.pointerUp(camera.worldToScreen(endWorld), endWorld, 0)

    const child = doc.getEntity(a)
    if (child?.type === 'line') {
      expect(child.start.x).toBe(100)
      expect(child.end.x).toBe(140)
    }
    const g = doc.getEntity(group.id) as GroupEntity
    expect(g.transform).not.toEqual(IDENTITY_TRANSFORM)
  })
})

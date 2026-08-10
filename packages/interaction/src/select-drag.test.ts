import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { Camera2D } from '@cadkit/geometry'
import { SceneProjector } from '@cadkit/scene'
import {
  DEFAULT_PERFORMANCE_CONFIG,
  IDENTITY_TRANSFORM,
  createEntityId,
  screenPoint,
  worldPoint,
  type Entity,
  type EntityId,
} from '@cadkit/types'
import { SelectionSet } from './selection.js'
import { ToolManager } from './tools.js'

describe('SelectTool drag', () => {
  it('drags a line with applyPatches', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const patchesLog: Array<Map<EntityId, Partial<Entity>>> = []

    const id = createEntityId('line')
    const change = doc.add({
      id,
      type: 'line',
      layerId: doc.getDefaultLayerId(),
      style: { stroke: '#0f0' },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 100, y: 100 },
      end: { x: 140, y: 100 },
    })
    scene.applyChange(change)

    const tools = new ToolManager({
      doc,
      camera,
      scene,
      selection,
      snap: { enabled: false, pixelTolerance: 8, worldPerPixel: 1, gridSize: 10 },
      ortho: false,
      applyPatches: (patches) => {
        patchesLog.push(patches)
        for (const [eid, patch] of patches) doc.update(eid, patch)
        scene.rebuildIndex()
      },
    })

    tools.activate('select')
    tools.pointerDown(screenPoint(120, 100), worldPoint(120, 100), 0)
    expect(selection.has(id)).toBe(true)
    tools.pointerMove(screenPoint(130, 110), worldPoint(130, 110))
    tools.pointerUp(screenPoint(130, 110), worldPoint(130, 110), 0)

    expect(patchesLog.length).toBeGreaterThan(0)
    const line = doc.getEntity(id)
    expect(line?.type).toBe('line')
    if (line?.type === 'line') {
      expect(line.start.x).toBeCloseTo(110)
      expect(line.start.y).toBeCloseTo(110)
    }
  })

  it('deletes selection on Delete key', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    const selection = new SelectionSet()
    const id = createEntityId('line')
    scene.applyChange(
      doc.add({
        id,
        type: 'line',
        layerId: doc.getDefaultLayerId(),
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
      }),
    )
    selection.set([id])
    const tools = new ToolManager({
      doc,
      camera,
      scene,
      selection,
      snap: { enabled: false, pixelTolerance: 8, worldPerPixel: 1, gridSize: 10 },
      ortho: false,
      removeEntities: (ids) => {
        for (const eid of ids) doc.remove(eid)
        selection.clear()
      },
    })
    tools.keyDown('Delete')
    expect(doc.getEntity(id)).toBeUndefined()
    expect(selection.size).toBe(0)
  })

  it('uses transform handles in object mode and vector handles after double-click', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const id = createEntityId('line')
    scene.applyChange(
      doc.add({
        id,
        type: 'line',
        layerId: doc.getDefaultLayerId(),
        style: { stroke: '#0f0' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        start: { x: 100, y: 100 },
        end: { x: 140, y: 100 },
      }),
    )
    const tools = new ToolManager({
      doc,
      camera,
      scene,
      selection,
      snap: { enabled: false, pixelTolerance: 8, worldPerPixel: 1, gridSize: 10 },
      ortho: false,
    })

    tools.pointerDown(screenPoint(120, 100), worldPoint(120, 100), 0)
    tools.pointerUp(screenPoint(120, 100), worldPoint(120, 100), 0)
    expect(tools.getSelectMode()).toBe('object')
    expect(tools.getSelectionFrameAABB()).not.toBeNull()
    const objectHandles = tools.getSelectionHandles()
    expect(objectHandles.some((h) => h.kind === 'scale')).toBe(true)
    expect(objectHandles.some((h) => h.kind === 'rotate')).toBe(true)
    expect(objectHandles.some((h) => h.kind === 'endpoint')).toBe(false)

    tools.doubleClick(screenPoint(120, 100), worldPoint(120, 100))
    expect(tools.getSelectMode()).toBe('edit')
    expect(tools.getSelectionFrameAABB()).toBeNull()
    const editHandles = tools.getSelectionHandles()
    expect(editHandles.some((h) => h.kind === 'endpoint')).toBe(true)

    tools.keyDown('Escape')
    expect(tools.getSelectMode()).toBe('object')
    expect(selection.has(id)).toBe(true)
  })

  it('opens in-place editing when double-clicking anywhere inside text bounds', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const id = createEntityId('text')
    scene.applyChange(
      doc.add({
        id,
        type: 'text',
        layerId: doc.getDefaultLayerId(),
        style: { fill: '#111827' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        content: '中文',
        position: { x: 100, y: 100 },
        fontFamily: 'sans-serif',
        fontSize: 20,
      }),
    )

    let commitEdit: ((text: string) => void) | null = null
    let initial = ''
    const tools = new ToolManager({
      doc,
      camera,
      scene,
      selection,
      snap: { enabled: false, pixelTolerance: 8, worldPerPixel: 1, gridSize: 10 },
      ortho: false,
      beginTextEdit: (opts) => {
        initial = opts.initial
        commitEdit = opts.onCommit
      },
      applyPatches: (patches) => {
        for (const [eid, patch] of patches) scene.applyChange(doc.update(eid, patch))
      },
    })

    // Away from the insertion anchor, but still inside the text AABB.
    tools.doubleClick(screenPoint(130, 90), worldPoint(130, 90))
    expect(initial).toBe('中文')
    expect(selection.has(id)).toBe(true)
    expect(commitEdit).not.toBeNull()
    commitEdit?.('画布内编辑')
    expect(doc.getEntity(id)?.type).toBe('text')
    expect((doc.getEntity(id) as Extract<Entity, { type: 'text' }>).content).toBe('画布内编辑')
  })

  it('exposes marquee AABB while box-selecting empty space', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const tools = new ToolManager({
      doc,
      camera,
      scene,
      selection,
      snap: { enabled: false, pixelTolerance: 8, worldPerPixel: 1, gridSize: 10 },
      ortho: false,
    })

    expect(tools.getMarqueeAABB()).toBeNull()
    tools.pointerDown(screenPoint(10, 10), worldPoint(10, 10), 0)
    tools.pointerMove(screenPoint(50, 40), worldPoint(50, 40))
    const box = tools.getMarqueeAABB()
    expect(box).not.toBeNull()
    expect(box!.minX).toBeCloseTo(10)
    expect(box!.minY).toBeCloseTo(10)
    expect(box!.maxX).toBeCloseTo(50)
    expect(box!.maxY).toBeCloseTo(40)

    tools.pointerUp(screenPoint(50, 40), worldPoint(50, 40), 0)
    expect(tools.getMarqueeAABB()).toBeNull()
  })
})

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

  it('shows rect corner-radius handles in object mode', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const id = createEntityId('rect')
    scene.applyChange(
      doc.add({
        id,
        type: 'polyline',
        layerId: doc.getDefaultLayerId(),
        style: { stroke: '#0f0' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
          { x: 80, y: 50 },
          { x: 0, y: 50 },
        ],
        shape: { kind: 'rect', cornerRadii: 0 },
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
    tools.pointerDown(screenPoint(40, 25), worldPoint(40, 25), 0)
    tools.pointerUp(screenPoint(40, 25), worldPoint(40, 25), 0)
    const handles = tools.getSelectionHandles()
    expect(handles.filter((h) => h.appearance === 'corner-radius')).toHaveLength(4)
    expect(handles.some((h) => h.id.endsWith(':corner:tl'))).toBe(true)
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

  it('selects polyline vertices in edit mode and deletes them', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const id = createEntityId('poly')
    scene.applyChange(
      doc.add({
        id,
        type: 'polyline',
        layerId: doc.getDefaultLayerId(),
        style: { stroke: '#0f0' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        closed: true,
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 100 },
          { x: 140, y: 140 },
          { x: 100, y: 140 },
        ],
      }),
    )
    const tools = new ToolManager({
      doc,
      camera,
      scene,
      selection,
      snap: { enabled: false, pixelTolerance: 8, worldPerPixel: 1, gridSize: 10 },
      ortho: false,
      applyPatches: (patches) => {
        for (const [eid, patch] of patches) scene.applyChange(doc.update(eid, patch))
      },
      removeEntities: (ids) => {
        for (const eid of ids) doc.remove(eid)
        selection.clear()
      },
    })

    tools.doubleClick(screenPoint(120, 100), worldPoint(120, 100))
    expect(tools.getSelectMode()).toBe('edit')

    tools.pointerDown(screenPoint(140, 100), worldPoint(140, 100), 0)
    tools.pointerUp(screenPoint(140, 100), worldPoint(140, 100), 0)
    expect(tools.getSelectedVertices()).toEqual([{ holeIndex: null, pointIndex: 1 }])
    expect(tools.getSelectionHandles().some((h) => h.selected)).toBe(true)

    tools.keyDown('Delete')
    const poly = doc.getEntity(id)
    expect(poly?.type).toBe('polyline')
    if (poly?.type === 'polyline') {
      expect(poly.points).toHaveLength(3)
      expect(poly.points.some((p) => p.x === 140 && p.y === 100)).toBe(false)
    }
    expect(tools.getSelectedVertices()).toEqual([])
    expect(tools.getSelectMode()).toBe('edit')
  })

  it('does not delete the whole path on Delete without a vertex selection', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const id = createEntityId('poly')
    scene.applyChange(
      doc.add({
        id,
        type: 'polyline',
        layerId: doc.getDefaultLayerId(),
        style: { stroke: '#0f0' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        closed: true,
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 100 },
          { x: 140, y: 140 },
          { x: 100, y: 140 },
        ],
      }),
    )
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

    tools.doubleClick(screenPoint(120, 100), worldPoint(120, 100))
    expect(tools.getSelectMode()).toBe('edit')
    tools.keyDown('Delete')
    expect(doc.getEntity(id)).toBeTruthy()
    expect(tools.getSelectMode()).toBe('edit')
  })

  it('shift-click toggles vertex selection without dragging', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const id = createEntityId('poly')
    scene.applyChange(
      doc.add({
        id,
        type: 'polyline',
        layerId: doc.getDefaultLayerId(),
        style: { stroke: '#0f0' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        closed: true,
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 100 },
          { x: 140, y: 140 },
          { x: 100, y: 140 },
        ],
      }),
    )
    const patchesLog: Array<Map<EntityId, Partial<Entity>>> = []
    const tools = new ToolManager({
      doc,
      camera,
      scene,
      selection,
      snap: { enabled: false, pixelTolerance: 8, worldPerPixel: 1, gridSize: 10 },
      ortho: false,
      applyPatches: (patches) => {
        patchesLog.push(patches)
        for (const [eid, patch] of patches) scene.applyChange(doc.update(eid, patch))
      },
    })

    tools.doubleClick(screenPoint(120, 100), worldPoint(120, 100))
    tools.pointerDown(screenPoint(140, 100), worldPoint(140, 100), 0)
    tools.pointerUp(screenPoint(140, 100), worldPoint(140, 100), 0)
    expect(tools.getSelectedVertices()).toEqual([{ holeIndex: null, pointIndex: 1 }])

    tools.setModifierKeys({ shiftKey: true })
    tools.pointerDown(screenPoint(140, 100), worldPoint(140, 100), 0)
    tools.pointerMove(screenPoint(150, 110), worldPoint(150, 110))
    tools.pointerUp(screenPoint(150, 110), worldPoint(150, 110), 0)
    tools.setModifierKeys({ shiftKey: false })

    expect(tools.getSelectedVertices()).toEqual([])
    expect(patchesLog.length).toBe(0)
    const poly = doc.getEntity(id)
    expect(poly?.type).toBe('polyline')
    if (poly?.type === 'polyline') {
      expect(poly.points[1]).toEqual({ x: 140, y: 100 })
    }
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

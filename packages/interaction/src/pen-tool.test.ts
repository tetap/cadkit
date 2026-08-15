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
} from '@cadkit/types'
import { anchorsToCubicPoints, cubicPointsToAnchors, createBuiltinTools } from './shape-tools.js'
import { SelectionSet } from './selection.js'
import { ToolManager } from './tools.js'

describe('PenTool', () => {
  it('builds corner anchors like a polyline and commits a cubic bezier', () => {
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
      addEntity: (entity) => {
        scene.applyChange(doc.add(entity))
      },
    })
    tools.registerBuiltinShapes(createBuiltinTools())
    tools.activate('pen')

    // Three corner clicks (no drag) → open path.
    tools.pointerDown(screenPoint(10, 10), worldPoint(10, 10), 0)
    tools.pointerUp(screenPoint(10, 10), worldPoint(10, 10), 0)
    tools.pointerDown(screenPoint(80, 10), worldPoint(80, 10), 0)
    tools.pointerUp(screenPoint(80, 10), worldPoint(80, 10), 0)
    tools.pointerDown(screenPoint(80, 60), worldPoint(80, 60), 0)
    tools.pointerUp(screenPoint(80, 60), worldPoint(80, 60), 0)
    tools.keyDown('Enter')

    expect(doc.count()).toBe(1)
    const path = doc.getEntities()[0]
    expect(path?.type).toBe('bezier')
    if (path?.type === 'bezier') {
      // 3 anchors → 2 segments → 7 packed points (3*2+1)
      expect(path.points.length).toBe(7)
      expect(path.points[0]).toEqual({ x: 10, y: 10 })
      expect(path.points[path.points.length - 1]).toEqual({ x: 80, y: 60 })
      expect(path.closed).toBe(false)
    }
  })

  it('click-drag creates smooth handles', () => {
    const packed = anchorsToCubicPoints(
      [
        {
          point: worldPoint(0, 0),
          handleIn: null,
          handleOut: worldPoint(20, 0),
        },
        {
          point: worldPoint(100, 0),
          handleIn: worldPoint(80, 0),
          handleOut: null,
        },
      ],
      false,
    )
    expect(packed).toHaveLength(4)
    expect(packed[1]).toEqual(worldPoint(20, 0))
    expect(packed[2]).toEqual(worldPoint(80, 0))
  })

  it('round-trips corner anchors through cubic packing', () => {
    const anchors = [
      { point: worldPoint(0, 0), handleIn: null, handleOut: null },
      { point: worldPoint(40, 0), handleIn: null, handleOut: null },
      { point: worldPoint(40, 30), handleIn: null, handleOut: null },
    ]
    const packed = anchorsToCubicPoints(anchors, false)
    const back = cubicPointsToAnchors(packed, false)
    expect(back).toHaveLength(3)
    expect(back[0]!.point).toEqual(worldPoint(0, 0))
    expect(back[2]!.point).toEqual(worldPoint(40, 30))
    expect(back.every((a) => a.handleIn == null && a.handleOut == null)).toBe(true)
  })

  it('resumes an open path when clicking its endpoint', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const id = createEntityId('bezier')
    scene.applyChange(
      doc.add({
        id,
        type: 'bezier',
        layerId: doc.getDefaultLayerId(),
        style: { stroke: '#111' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 30, y: 0 },
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
        for (const [eid, patch] of patches) {
          const change = doc.update(eid, patch)
          if (change) scene.applyChange(change)
        }
      },
    })
    tools.registerBuiltinShapes(createBuiltinTools())
    tools.activate('pen')

    tools.pointerDown(screenPoint(30, 0), worldPoint(30, 0), 0)
    tools.pointerUp(screenPoint(30, 0), worldPoint(30, 0), 0)
    tools.pointerDown(screenPoint(60, 20), worldPoint(60, 20), 0)
    tools.pointerUp(screenPoint(60, 20), worldPoint(60, 20), 0)
    tools.keyDown('Enter')

    const path = doc.getEntity(id)
    expect(path?.type).toBe('bezier')
    if (path?.type === 'bezier') {
      expect(path.points[0]).toEqual({ x: 0, y: 0 })
      expect(path.points[path.points.length - 1]).toEqual({ x: 60, y: 20 })
      expect(doc.count()).toBe(1)
    }
  })

  it('double-click on an existing open path continues it instead of finishing empty', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const selection = new SelectionSet()
    const id = createEntityId('bezier')
    scene.applyChange(
      doc.add({
        id,
        type: 'bezier',
        layerId: doc.getDefaultLayerId(),
        style: { stroke: '#111' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        closed: false,
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 30, y: 10 },
          { x: 40, y: 10 },
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
        for (const [eid, patch] of patches) {
          const change = doc.update(eid, patch)
          if (change) scene.applyChange(change)
        }
      },
    })
    tools.registerBuiltinShapes(createBuiltinTools())
    tools.activate('pen')

    tools.pointerDown(screenPoint(25, 10), worldPoint(25, 10), 0)
    tools.pointerUp(screenPoint(25, 10), worldPoint(25, 10), 0)
    tools.doubleClick(screenPoint(25, 10), worldPoint(25, 10))
    tools.pointerDown(screenPoint(80, 40), worldPoint(80, 40), 0)
    tools.pointerUp(screenPoint(80, 40), worldPoint(80, 40), 0)
    tools.keyDown('Enter')

    expect(doc.count()).toBe(1)
    const path = doc.getEntity(id)
    expect(path?.type).toBe('bezier')
    if (path?.type === 'bezier') {
      expect(path.points[path.points.length - 1]).toEqual({ x: 80, y: 40 })
    }
  })
})

describe('BrushTool', () => {
  it('commits a freehand polyline stroke', () => {
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
      addEntity: (entity) => {
        scene.applyChange(doc.add(entity))
      },
    })
    tools.registerBuiltinShapes(createBuiltinTools())
    tools.activate('brush')

    tools.pointerDown(screenPoint(10, 10), worldPoint(10, 10), 0)
    tools.pointerMove(screenPoint(40, 30), worldPoint(40, 30))
    tools.pointerUp(screenPoint(40, 30), worldPoint(40, 30), 0)
    expect(doc.count()).toBe(1)
    const stroke = doc.getEntities()[0]
    expect(stroke?.type).toBe('polyline')
    if (stroke?.type === 'polyline') expect(stroke.points.length).toBeGreaterThanOrEqual(2)
  })
})

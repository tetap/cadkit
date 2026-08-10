import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { Camera2D } from '@cadkit/geometry'
import { SceneProjector } from '@cadkit/scene'
import { DEFAULT_PERFORMANCE_CONFIG, screenPoint, worldPoint } from '@cadkit/types'
import { anchorsToCubicPoints, createBuiltinTools } from './shape-tools.js'
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

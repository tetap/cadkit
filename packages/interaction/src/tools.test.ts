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
import { SelectionSet } from './selection.js'
import { ToolManager } from './tools.js'

describe('ToolManager', () => {
  it('activates tools, pans, and creates lines', () => {
    const doc = new CadDocument()
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    const selection = new SelectionSet()
    const created: string[] = []
    const tools = new ToolManager({
      doc,
      camera,
      scene,
      selection,
      snap: { enabled: false, pixelTolerance: 8, worldPerPixel: 1, gridSize: 10 },
      ortho: false,
      onEntityCreated: (id) => created.push(id),
    })

    expect(tools.getActive()).toBe('select')
    tools.activate('pan')
    expect(tools.getActive()).toBe('pan')
    expect(tools.getEffectiveTool()).toBe('pan')
    const x0 = camera.getState().x
    tools.pointerDown(screenPoint(10, 10), worldPoint(10, 10), 0)
    tools.pointerMove(screenPoint(30, 10), worldPoint(30, 10))
    expect(camera.getState().x).not.toBe(x0)
    tools.pointerUp(screenPoint(30, 10), worldPoint(30, 10), 0)

    // Space temporarily pans without changing sticky tool
    tools.activate('select')
    tools.setModifierKeys({ spaceKey: true })
    expect(tools.getActive()).toBe('select')
    expect(tools.getEffectiveTool()).toBe('pan')
    tools.setModifierKeys({ spaceKey: false })
    expect(tools.getEffectiveTool()).toBe('select')

    tools.activate('line')
    tools.pointerDown(screenPoint(0, 0), worldPoint(0, 0), 0)
    tools.pointerDown(screenPoint(20, 0), worldPoint(20, 0), 0)
    expect(created.length).toBe(1)
    expect(doc.count()).toBe(1)

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
    tools.activate('select')
    tools.pointerDown(screenPoint(120, 100), worldPoint(120, 100), 0)
    expect(selection.has(id)).toBe(true)

    expect(() => tools.activate('not-a-tool' as never)).toThrow()
  })
})

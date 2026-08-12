import { describe, expect, it } from 'vitest'
import { DEFAULT_PERFORMANCE_CONFIG, worldPoint } from '@cadkit/types'
import { CadDocument } from '@cadkit/document'
import { Camera2D } from '@cadkit/geometry'
import { SceneProjector } from './display-list.js'

describe('SceneProjector geom cache', () => {
  it('reuses projected geometry across pan-only builds', () => {
    const doc = new CadDocument()
    const line = doc.createLine({ x: 0, y: 0 }, { x: 100, y: 0 })
    const change = doc.add(line)
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    scene.applyChange(change)
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    cam.setCenter(worldPoint(50, 0))

    const a = scene.build(cam)
    expect(a.mode).toBe('full')
    expect(a.skipGeometryUpload).toBe(false)
    expect(a.items.length).toBe(1)
    expect(a.stats.cacheMisses).toBe(1)

    cam.setCenter(worldPoint(55, 0))
    const b = scene.build(cam)
    expect(b.mode).toBe('pan-reuse')
    expect(b.skipGeometryUpload).toBe(true)
    expect(b.items).toBe(a.items)

    // Small zoom within same lodBin + overscan → skip geometry upload.
    cam.setZoom(1.05)
    const z = scene.build(cam)
    expect(z.skipGeometryUpload).toBe(true)
    expect(z.items).toBe(a.items)

    const upd = doc.update(line.id, { end: { x: 120, y: 0 } } as never)!
    scene.applyChange(upd)
    const c = scene.build(cam)
    expect(c.skipGeometryUpload).toBe(false)
    expect(c.stats.cacheMisses).toBe(1)
  })

  it('consumeDirtyMeta returns entity bounds then clears', () => {
    const doc = new CadDocument()
    const line = doc.createLine({ x: 0, y: 0 }, { x: 100, y: 0 })
    const change = doc.add(line)
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    // Drop constructor rebuild fullscreen so entity dirty rects are visible.
    scene.consumeDirtyMeta()
    scene.applyChange(change)
    const meta = scene.consumeDirtyMeta()
    expect(meta.rects.length).toBeGreaterThan(0)
    expect(scene.consumeDirtyMeta().rects).toEqual([])

    scene.rebuildIndex()
    expect(scene.consumeDirtyMeta().fullscreen).toBe(true)
  })

  it('large selection does not exempt density LOD', () => {
    const doc = new CadDocument()
    const layer = doc.getDefaultLayerId()
    const ids: string[] = []
    for (let i = 0; i < 200; i++) {
      const line = doc.createLine({ x: i * 0.01, y: 0 }, { x: i * 0.01 + 0.02, y: 0.02 })
      line.layerId = layer
      doc.add(line)
      ids.push(line.id)
    }
    const scene = new SceneProjector(doc, {
      ...DEFAULT_PERFORMANCE_CONFIG,
      maxVisible: 50,
      selectionLodExemptMax: 64,
    })
    scene.rebuildIndex()
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    cam.setCenter(worldPoint(1, 0))
    const all = new Set(ids as never[])
    const built = scene.build(cam, all)
    expect(built.stats.visibleCount).toBeLessThanOrEqual(50)
  })
})

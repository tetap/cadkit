import { describe, expect, it } from 'vitest'
import { Camera2D } from './camera.js'

describe('Camera2D', () => {
  it('pans in screen space and clamps zoom', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(2)
    const before = cam.getState()
    cam.pan(100, 50)
    const after = cam.getState()
    expect(after.x).toBeLessThan(before.x)
    cam.setZoomRange(0.5, 4)
    cam.setZoom(100)
    expect(cam.getState().zoom).toBe(4)
    cam.setZoom(0.01)
    expect(cam.getState().zoom).toBe(0.5)
  })

  it('fitBounds and visible world bounds', () => {
    const cam = new Camera2D()
    cam.setViewport(400, 300)
    cam.fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 50 })
    const view = cam.getVisibleWorldBounds()
    expect(view.minX).toBeLessThanOrEqual(0)
    expect(view.maxX).toBeGreaterThanOrEqual(100)
    const v0 = cam.getVersion()
    cam.setCenter({ x: 10, y: 10 })
    expect(cam.getVersion()).toBeGreaterThan(v0)
  })

  it('fitBounds of 100×100 page on 800×450 viewport zooms well above 1', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 450)
    cam.fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 40)
    expect(cam.getState().zoom).toBeGreaterThan(3)
    const view = cam.getVisibleWorldBounds()
    expect(view.maxX - view.minX).toBeLessThan(250)
    expect(view.maxY - view.minY).toBeLessThan(200)
  })

  it('screen↔world roundtrip stays under the same canvas pixel', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(2)
    cam.pan(40, -20)
    const screen = { x: 123.5, y: 456.25, __space: 'screen' as const }
    const world = cam.screenToWorld(screen)
    const back = cam.worldToScreen(world)
    expect(back.x).toBeCloseTo(screen.x, 6)
    expect(back.y).toBeCloseTo(screen.y, 6)
  })
})

import { describe, expect, it } from 'vitest'
import {
  IDENTITY,
  decomposeTextLinear,
  invert,
  multiply,
  transformPoint,
  rotate,
  translate,
  scale,
} from './matrix.js'
import { Camera2D } from './camera.js'
import { screenPoint, worldPoint } from '@cadkit/types'

describe('matrix', () => {
  it('inverts translate+scale', () => {
    const m = multiply(translate(10, 20), scale(2, 3))
    const inv = invert(m)
    expect(inv).not.toBeNull()
    const p = transformPoint(m, { x: 1, y: 1 })
    const back = transformPoint(inv!, p)
    expect(back.x).toBeCloseTo(1)
    expect(back.y).toBeCloseTo(1)
  })

  it('compose rotate around origin', () => {
    const m = rotate(Math.PI / 2)
    const p = transformPoint(m, { x: 1, y: 0 })
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(1)
  })

  it('identity is neutral', () => {
    const p = transformPoint(IDENTITY, { x: 5, y: 7 })
    expect(p).toEqual({ x: 5, y: 7 })
  })

  it('decomposeTextLinear maps horizontal flip to widthSign, not π rotation', () => {
    const d = decomposeTextLinear(scale(-2, 2))
    expect(d.scale).toBeCloseTo(2)
    expect(d.rotation).toBeCloseTo(0)
    expect(d.widthSign).toBe(-1)
  })

  it('decomposeTextLinear maps vertical flip to π + widthSign', () => {
    const d = decomposeTextLinear(scale(2, -2))
    expect(d.scale).toBeCloseTo(2)
    expect(Math.abs(d.rotation)).toBeCloseTo(Math.PI)
    expect(d.widthSign).toBe(-1)
  })

  it('decomposeTextLinear maps both-axis flip to π only', () => {
    const d = decomposeTextLinear(scale(-2, -2))
    expect(d.scale).toBeCloseTo(2)
    expect(Math.abs(d.rotation)).toBeCloseTo(Math.PI)
    expect(d.widthSign).toBe(1)
  })
})

describe('Camera2D', () => {
  it('round-trips world/screen', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(2)
    const w = worldPoint(100, 50)
    const s = cam.worldToScreen(w)
    const back = cam.screenToWorld(s)
    expect(back.x).toBeCloseTo(w.x, 6)
    expect(back.y).toBeCloseTo(w.y, 6)
  })

  it('zoomAt keeps screen point stable in world', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    const anchor = screenPoint(400, 300)
    const before = cam.screenToWorld(anchor)
    cam.zoomAt(anchor, 2)
    const after = cam.screenToWorld(anchor)
    expect(after.x).toBeCloseTo(before.x, 5)
    expect(after.y).toBeCloseTo(before.y, 5)
  })

  it('setTopLeft places viewport origin in world', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(2)
    cam.setTopLeft(worldPoint(100, 50))
    const view = cam.getVisibleWorldBounds()
    expect(view.minX).toBeCloseTo(100, 5)
    expect(view.minY).toBeCloseTo(50, 5)
    expect(view.maxX).toBeCloseTo(100 + 800 / 2, 5)
    expect(view.maxY).toBeCloseTo(50 + 600 / 2, 5)
  })
})

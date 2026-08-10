// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { Camera2D } from '@cadkit/geometry'
import { createAABB } from '@cadkit/types'
import { HandleOverlay, rotationRadToCssDegrees } from './handle-overlay.js'
import { buildTransformHandles } from './selection-transform.js'

describe('HandleOverlay rotation', () => {
  it('uses the same positive rotation direction as world-to-screen', () => {
    expect(rotationRadToCssDegrees(Math.PI / 2)).toBeCloseTo(90)

    const host = document.createElement('div')
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const box = createAABB(0, 0, 100, 50)
    const handles = buildTransformHandles(box, camera, Math.PI / 2)
    const overlay = new HandleOverlay(host)

    overlay.update(handles, camera, { left: 0, top: 0 }, box, Math.PI / 2)

    const frame = host.querySelector<HTMLElement>('.cadkit-selection-frame')
    expect(frame?.style.transform).toBe('rotate(90deg)')
  })

  it('shows a hover frame for the pick preview', () => {
    const host = document.createElement('div')
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)
    const overlay = new HandleOverlay(host)
    overlay.updateHover(createAABB(10, 20, 60, 50), camera, { left: 0, top: 0 })
    const hover = host.querySelector<HTMLElement>('.cadkit-hover-frame')
    expect(hover?.style.display).toBe('block')
    expect(Number.parseFloat(hover?.style.width ?? '0')).toBeCloseTo(50)
    overlay.updateHover(null, camera, { left: 0, top: 0 })
    expect(hover?.style.display).toBe('none')
    overlay.dispose()
  })
})

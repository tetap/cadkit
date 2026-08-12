import { describe, expect, it, vi } from 'vitest'
import { Camera2D } from '@cadkit/geometry'
import { worldPoint } from '@cadkit/types'
import { ScrollbarOverlay } from './scrollbars.js'

describe('ScrollbarOverlay', () => {
  it('shows thumbs when content exceeds the viewport', () => {
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'relative', width: '400px', height: '300px' })
    document.body.appendChild(host)
    Object.defineProperty(host, 'clientWidth', { value: 400 })
    Object.defineProperty(host, 'clientHeight', { value: 300 })

    const onNavigate = vi.fn()
    const bars = new ScrollbarOverlay(host, { onNavigate })
    bars.setCanvasBox({ left: 0, top: 0, right: 0, bottom: 0 })
    bars.setContentBounds({ minX: 0, minY: 0, maxX: 4000, maxY: 3000 })

    const cam = new Camera2D()
    cam.setViewport(400, 300)
    cam.setZoom(1)
    cam.setTopLeft(worldPoint(0, 0))
    bars.update(cam)

    const h = host.querySelector('.cadkit-scrollbars > div:first-child') as HTMLDivElement
    const v = host.querySelector('.cadkit-scrollbars > div:last-child') as HTMLDivElement
    expect(h.style.display).toBe('block')
    expect(v.style.display).toBe('block')

    bars.setContentBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    bars.update(cam)
    expect(h.style.display).toBe('none')
    expect(v.style.display).toBe('none')

    bars.dispose()
    host.remove()
  })
})

// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { Camera2D } from '@cadkit/geometry'
import { createEntityId, IDENTITY_TRANSFORM } from '@cadkit/types'
import { TextOverlay } from './text-overlay.js'

describe('TextOverlay', () => {
  it('aligns to the measured canvas bounds', () => {
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'relative', width: '800px', height: '600px' })
    document.body.appendChild(host)

    const overlay = new TextOverlay(host)
    overlay.setCanvasBounds(24, 24)

    // Must keep a real inset; assigning inset:'' after left/top used to collapse the layer.
    expect(overlay.root.style.inset.startsWith('24px')).toBe(true)

    const camera = new Camera2D()
    camera.setViewport(776, 576)
    camera.setZoom(2)

    overlay.update(
      [
        {
          id: createEntityId('text'),
          type: 'text',
          layerId: createEntityId('layer'),
          style: { fill: '#111827' },
          transform: IDENTITY_TRANSFORM,
          version: 1,
          content: 'Hello',
          position: { x: 10, y: 20 },
          fontFamily: 'sans-serif',
          fontSize: 12,
        },
      ],
      camera,
    )

    const label = overlay.root.querySelector('div')
    expect(label?.textContent).toBe('Hello')
    expect(label?.style.display).toBe('block')
    expect(Number.parseFloat(label?.style.fontSize ?? '0')).toBeGreaterThan(0)

    overlay.dispose()
    host.remove()
  })

  it('renders one glyph node per character for arc text', () => {
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'relative', width: '800px', height: '600px' })
    document.body.appendChild(host)

    const overlay = new TextOverlay(host)
    overlay.setCanvasBounds(0, 0)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)

    const id = createEntityId('arc-text')
    overlay.update(
      [
        {
          id,
          type: 'text',
          layerId: createEntityId('layer'),
          style: { fill: '#111827' },
          transform: IDENTITY_TRANSFORM,
          version: 1,
          content: 'ABC',
          position: { x: 0, y: 0 },
          fontFamily: 'sans-serif',
          fontSize: 14,
          path: { kind: 'arc', radius: 50, startAngle: -Math.PI / 2, sweep: Math.PI },
        },
      ],
      camera,
    )

    expect(overlay.countGlyphNodes(id)).toBe(3)
    expect(overlay.root.querySelector('svg path')).toBeTruthy()

    overlay.dispose()
    host.remove()
  })

  it('shows draft text and blinking caret while editing', () => {
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'relative', width: '800px', height: '600px' })
    document.body.appendChild(host)

    const overlay = new TextOverlay(host)
    overlay.setCanvasBounds(0, 0)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)

    const id = createEntityId('text')
    overlay.setDraft({
      entityId: id,
      content: 'Hi',
      caret: 2,
      world: { x: 10, y: 20 },
      fontSize: 12,
      fontFamily: 'sans-serif',
      color: '#111827',
    })
    overlay.update(
      [
        {
          id,
          type: 'text',
          layerId: createEntityId('layer'),
          style: { fill: '#111827' },
          transform: IDENTITY_TRANSFORM,
          version: 1,
          content: 'Old',
          position: { x: 10, y: 20 },
          fontFamily: 'sans-serif',
          fontSize: 12,
        },
      ],
      camera,
    )

    const draft = [...overlay.root.children].find((n) => (n as HTMLElement).textContent === 'Hi')
    expect(draft).toBeTruthy()
    expect((draft as HTMLElement).style.display).toBe('block')
    const caret = overlay.root.querySelector('.cadkit-text-caret') as HTMLElement | null
    expect(caret?.style.display).toBe('block')
    expect(Number.parseFloat(caret?.style.height ?? '0')).toBeGreaterThan(0)
    const tip = overlay.getCaretScreen(camera)
    expect(tip).toBeTruthy()
    expect(tip!.x).toBeGreaterThan(10)

    overlay.dispose()
    host.remove()
  })
})

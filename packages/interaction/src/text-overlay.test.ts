// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { Camera2D, layoutArcText } from '@cadkit/geometry'
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

    // Committed text is GPU vector — overlay must not create DOM labels.
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
    expect(overlay.root.querySelector('div')).toBeNull()

    overlay.dispose()
    host.remove()
  })

  it('renders draft arc glyphs (committed arc text is GPU outlines)', () => {
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'relative', width: '800px', height: '600px' })
    document.body.appendChild(host)

    const overlay = new TextOverlay(host)
    overlay.setCanvasBounds(0, 0)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)

    overlay.setDraft({
      entityId: null,
      content: 'ABC',
      caret: 3,
      world: { x: 0, y: 0 },
      fontSize: 14,
      fontFamily: 'sans-serif',
      color: '#111827',
      path: { kind: 'arc', radius: 50, startAngle: -Math.PI / 2, sweep: Math.PI },
    })
    overlay.update([], camera)

    // Invisible glyph spans remain for arc caret metrics. SVG outlines appear
    // when canvas/font tracing is available (browser); may be empty in happy-dom.
    expect(overlay.root.querySelectorAll('[data-cadkit-glyph]').length).toBe(3)
    const glyph = overlay.root.querySelector('[data-cadkit-glyph="1"]') as HTMLElement | null
    expect(glyph?.style.transformOrigin).toBe('0 0')
    expect(Number.parseFloat(glyph?.style.width || '0')).toBeGreaterThan(0)
    expect(Number.parseFloat(glyph?.style.height || '0')).toBe(14)

    overlay.dispose()
    host.remove()
  })

  it('hit-tests arc draft against glyph bounds, not the circle center', () => {
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'relative', width: '800px', height: '600px' })
    document.body.appendChild(host)

    const overlay = new TextOverlay(host)
    overlay.setCanvasBounds(0, 0)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)

    const id = createEntityId('arc-text')
    // Text sits near the top of the circle (y ≈ -radius); center is (0,0).
    overlay.setDraft({
      entityId: id,
      content: 'ABC',
      caret: 1,
      world: { x: 0, y: 0 },
      fontSize: 14,
      fontFamily: 'sans-serif',
      color: '#111827',
      path: { kind: 'arc', radius: 80, startAngle: -Math.PI / 2, sweep: Math.PI },
    })
    overlay.update([], camera)

    const tip = overlay.getCaretScreen(camera)!
    // Click near a laid-out glyph must stay in edit (not treat as outside).
    expect(
      overlay.hitTestDraft(
        { x: tip.x, y: tip.y + tip.fontSizePx / 2, __space: 'screen' },
        camera,
      ),
    ).toBe(true)
    // Circle center is empty — must not count as a text hit.
    const center = camera.worldToScreen({ x: 0, y: 0, __space: 'world' })
    expect(
      overlay.hitTestDraft({ x: center.x, y: center.y, __space: 'screen' }, camera),
    ).toBe(false)

    overlay.dispose()
    host.remove()
  })

  it('places arc caret tip along the glyph upright axis', () => {
    const host = document.createElement('div')
    Object.assign(host.style, { position: 'relative', width: '800px', height: '600px' })
    document.body.appendChild(host)

    const overlay = new TextOverlay(host)
    overlay.setCanvasBounds(0, 0)
    const camera = new Camera2D()
    camera.setViewport(800, 600)
    camera.setZoom(1)

    const path = { kind: 'arc' as const, radius: 60, startAngle: -0.2, sweep: Math.PI / 2 }
    const fontSize = 20
    overlay.setDraft({
      entityId: createEntityId('arc-text'),
      content: 'AB',
      caret: 1,
      world: { x: 0, y: 0 },
      fontSize,
      fontFamily: 'sans-serif',
      color: '#111827',
      path,
    })
    overlay.update([], camera)

    const tip = overlay.getCaretScreen(camera)!
    const g = layoutArcText('AB', fontSize, { x: 0, y: 0 }, path)[0]!
    const along = g.advance / 2
    const base = camera.worldToScreen({
      x: g.x + Math.cos(g.rotation) * along,
      y: g.y + Math.sin(g.rotation) * along,
      __space: 'world',
    })
    expect(tip.rotation).toBeCloseTo(g.rotation, 5)
    expect(tip.x).toBeCloseTo(base.x + fontSize * Math.sin(g.rotation), 4)
    expect(tip.y).toBeCloseTo(base.y - fontSize * Math.cos(g.rotation), 4)
    // Must differ from the old upright-only tip (screen.y - fontSize).
    expect(Math.abs(tip.y - (base.y - fontSize))).toBeGreaterThan(0.5)

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

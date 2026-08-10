import { describe, expect, it, vi } from 'vitest'
import { Camera2D } from '@cadkit/geometry'
import { LIGHT_RULER_THEME, RulerOverlay } from './rulers.js'

describe('RulerOverlay', () => {
  it('mounts, updates units, toggles visibility, disposes', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    Object.assign(host.style, { position: 'relative', width: '800px', height: '600px' })
    const rulers = new RulerOverlay(host, {
      worldUnit: 'mm',
      displayUnit: 'mm',
      theme: LIGHT_RULER_THEME,
    })
    expect(host.contains(rulers.root)).toBe(true)
    rulers.resize(800, 600, 1)
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    rulers.update(cam)
    rulers.setUnits('mm', 'in')
    expect(rulers.root.textContent).toContain('in')
    rulers.setSelectionBounds({ minX: 10, minY: 20, maxX: 110, maxY: 80 })
    rulers.update(cam)
    rulers.setSelectionBounds(null)
    rulers.update(cam)
    rulers.setVisible(false)
    expect(rulers.root.style.display).toBe('none')
    rulers.dispose()
    expect(host.contains(rulers.root)).toBe(false)
    host.remove()
  })

  it('paints selection band on both horizontal and vertical rulers', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const rulers = new RulerOverlay(host, {
      worldUnit: 'mm',
      displayUnit: 'mm',
      size: 24,
      theme: LIGHT_RULER_THEME,
    })
    rulers.resize(800, 600, 1)
    const cam = new Camera2D()
    // Camera matches canvas (host minus gutters), same as Editor.layoutChrome.
    cam.setViewport(776, 576)
    cam.setZoom(1)

    const hCanvas = rulers.root.querySelectorAll('canvas')[0] as HTMLCanvasElement
    const vCanvas = rulers.root.querySelectorAll('canvas')[1] as HTMLCanvasElement
    const hFill = vi.fn()
    const vFill = vi.fn()
    const stubCtx = (fillRect: ReturnType<typeof vi.fn>) =>
      ({
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        fillRect,
        fillText: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        fillStyle: '',
        strokeStyle: '',
        font: '',
        textBaseline: 'top',
        lineWidth: 1,
      }) as unknown as CanvasRenderingContext2D
    vi.spyOn(hCanvas, 'getContext').mockReturnValue(stubCtx(hFill))
    vi.spyOn(vCanvas, 'getContext').mockReturnValue(stubCtx(vFill))

    rulers.setSelectionBounds({ minX: 10, minY: 20, maxX: 110, maxY: 80 })
    rulers.update(cam)

    // Background clear + selection band (and possibly more). Selection band for X:
    // fillRect(10, 0, 100, 24). For Y: fillRect(0, 20, 24, 60).
    expect(hFill.mock.calls.some((c) => c[0] === 10 && c[1] === 0 && c[2] === 100 && c[3] === 24)).toBe(
      true,
    )
    expect(vFill.mock.calls.some((c) => c[0] === 0 && c[1] === 20 && c[2] === 24 && c[3] === 60)).toBe(
      true,
    )

    rulers.dispose()
    host.remove()
  })
})

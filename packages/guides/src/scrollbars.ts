import type { Camera2D } from '@cadkit/geometry'
import type { AABB } from '@cadkit/types'
import { isValidAABB } from '@cadkit/types'

const THICKNESS = 10
const MIN_THUMB = 28
const MARGIN = 2

export interface ScrollbarOverlayOptions {
  /** Jump viewport so visible top-left becomes (minX, minY) in world space. */
  onNavigate: (minX: number, minY: number) => void
  theme?: 'light' | 'dark'
}

/**
 * Thin overlay scrollbars for the canvas: thumb size/position reflect
 * content bounds vs the current camera viewport.
 */
export class ScrollbarOverlay {
  readonly root: HTMLDivElement
  private readonly hTrack: HTMLDivElement
  private readonly hThumb: HTMLDivElement
  private readonly vTrack: HTMLDivElement
  private readonly vThumb: HTMLDivElement
  private content: AABB | null = null
  private drag: {
    axis: 'h' | 'v'
    startClient: number
    startThumb: number
    trackLen: number
    thumbLen: number
    scrollable: number
    contentMin: number
    viewSize: number
  } | null = null
  private readonly onNavigate: ScrollbarOverlayOptions['onNavigate']
  private trackBg: string
  private thumbBg: string
  private thumbHover: string

  constructor(host: HTMLElement, options: ScrollbarOverlayOptions) {
    this.onNavigate = options.onNavigate
    const dark = options.theme === 'dark'
    this.trackBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'
    this.thumbBg = dark ? 'rgba(255,255,255,0.28)' : 'rgba(15,23,42,0.28)'
    this.thumbHover = dark ? 'rgba(255,255,255,0.42)' : 'rgba(15,23,42,0.42)'

    this.root = document.createElement('div')
    this.root.className = 'cadkit-scrollbars'
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '5',
    } as Partial<CSSStyleDeclaration>)

    this.hTrack = document.createElement('div')
    this.hThumb = document.createElement('div')
    this.vTrack = document.createElement('div')
    this.vThumb = document.createElement('div')
    this.styleTrack(this.hTrack, 'h')
    this.styleTrack(this.vTrack, 'v')
    this.styleThumb(this.hThumb)
    this.styleThumb(this.vThumb)
    this.hTrack.appendChild(this.hThumb)
    this.vTrack.appendChild(this.vThumb)
    this.root.appendChild(this.hTrack)
    this.root.appendChild(this.vTrack)
    host.appendChild(this.root)

    this.bindTrack(this.hTrack, this.hThumb, 'h')
    this.bindTrack(this.vTrack, this.vThumb, 'v')
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
  }

  setTheme(theme: 'light' | 'dark'): void {
    const dark = theme === 'dark'
    this.trackBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'
    this.thumbBg = dark ? 'rgba(255,255,255,0.28)' : 'rgba(15,23,42,0.28)'
    this.thumbHover = dark ? 'rgba(255,255,255,0.42)' : 'rgba(15,23,42,0.42)'
    this.hTrack.style.background = this.trackBg
    this.vTrack.style.background = this.trackBg
    this.hThumb.style.background = this.thumbBg
    this.vThumb.style.background = this.thumbBg
  }

  setCanvasBox(box: { left: number; top: number; right: number; bottom: number }): void {
    Object.assign(this.root.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      right: `${box.right}px`,
      bottom: `${box.bottom}px`,
      inset: 'auto',
    } as Partial<CSSStyleDeclaration>)
  }

  setContentBounds(bounds: AABB | null): void {
    this.content = bounds && isValidAABB(bounds) ? bounds : null
  }

  update(camera: Camera2D): void {
    const content = this.content
    if (!content) {
      this.hTrack.style.display = 'none'
      this.vTrack.style.display = 'none'
      return
    }

    const view = camera.getVisibleWorldBounds()
    const contentW = content.maxX - content.minX
    const contentH = content.maxY - content.minY
    const viewW = Math.max(1e-9, view.maxX - view.minX)
    const viewH = Math.max(1e-9, view.maxY - view.minY)

    const needH = contentW > viewW * 1.001
    const needV = contentH > viewH * 1.001
    this.hTrack.style.display = needH ? 'block' : 'none'
    this.vTrack.style.display = needV ? 'block' : 'none'
    if (!needH && !needV) return

    const trackW = Math.max(0, this.root.clientWidth - (needV ? THICKNESS + MARGIN : 0) - MARGIN * 2)
    const trackH = Math.max(0, this.root.clientHeight - (needH ? THICKNESS + MARGIN : 0) - MARGIN * 2)

    if (needH) {
      const scrollable = contentW - viewW
      const thumbLen = Math.max(MIN_THUMB, trackW * (viewW / contentW))
      const maxThumb = Math.max(0, trackW - thumbLen)
      const t = scrollable > 0 ? (view.minX - content.minX) / scrollable : 0
      const thumbPos = clamp(t, 0, 1) * maxThumb
      this.hThumb.style.width = `${thumbLen}px`
      this.hThumb.style.height = `${THICKNESS - 2}px`
      this.hThumb.style.transform = `translate(${thumbPos}px, 0)`
      this.hThumb.dataset.pos = String(thumbPos)
      this.hTrack.dataset.scrollable = String(scrollable)
      this.hTrack.dataset.contentMin = String(content.minX)
      this.hTrack.dataset.viewSize = String(viewW)
      this.hTrack.dataset.trackLen = String(trackW)
      this.hTrack.dataset.thumbLen = String(thumbLen)
      this.hTrack.dataset.other = String(view.minY)
    }

    if (needV) {
      const scrollable = contentH - viewH
      const thumbLen = Math.max(MIN_THUMB, trackH * (viewH / contentH))
      const maxThumb = Math.max(0, trackH - thumbLen)
      const t = scrollable > 0 ? (view.minY - content.minY) / scrollable : 0
      const thumbPos = clamp(t, 0, 1) * maxThumb
      this.vThumb.style.height = `${thumbLen}px`
      this.vThumb.style.width = `${THICKNESS - 2}px`
      this.vThumb.style.transform = `translate(0, ${thumbPos}px)`
      this.vThumb.dataset.pos = String(thumbPos)
      this.vTrack.dataset.scrollable = String(scrollable)
      this.vTrack.dataset.contentMin = String(content.minY)
      this.vTrack.dataset.viewSize = String(viewH)
      this.vTrack.dataset.trackLen = String(trackH)
      this.vTrack.dataset.thumbLen = String(thumbLen)
      this.vTrack.dataset.other = String(view.minX)
    }
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.root.remove()
  }

  private styleTrack(el: HTMLDivElement, axis: 'h' | 'v'): void {
    Object.assign(el.style, {
      position: 'absolute',
      pointerEvents: 'auto',
      background: this.trackBg,
      borderRadius: '999px',
      display: 'none',
      ...(axis === 'h'
        ? {
            left: `${MARGIN}px`,
            right: `${THICKNESS + MARGIN}px`,
            bottom: `${MARGIN}px`,
            height: `${THICKNESS}px`,
          }
        : {
            top: `${MARGIN}px`,
            bottom: `${THICKNESS + MARGIN}px`,
            right: `${MARGIN}px`,
            width: `${THICKNESS}px`,
          }),
    } as Partial<CSSStyleDeclaration>)
  }

  private styleThumb(el: HTMLDivElement): void {
    Object.assign(el.style, {
      position: 'absolute',
      left: '1px',
      top: '1px',
      borderRadius: '999px',
      background: this.thumbBg,
      cursor: 'grab',
      touchAction: 'none',
    } as Partial<CSSStyleDeclaration>)
    el.addEventListener('pointerenter', () => {
      el.style.background = this.thumbHover
    })
    el.addEventListener('pointerleave', () => {
      if (!this.drag) el.style.background = this.thumbBg
    })
  }

  private bindTrack(track: HTMLDivElement, thumb: HTMLDivElement, axis: 'h' | 'v'): void {
    thumb.addEventListener('pointerdown', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      thumb.setPointerCapture?.(ev.pointerId)
      const trackLen = Number(track.dataset.trackLen ?? 0)
      const thumbLen = Number(track.dataset.thumbLen ?? 0)
      const scrollable = Number(track.dataset.scrollable ?? 0)
      const contentMin = Number(track.dataset.contentMin ?? 0)
      const viewSize = Number(track.dataset.viewSize ?? 0)
      const startThumb = Number(thumb.dataset.pos ?? 0)
      this.drag = {
        axis,
        startClient: axis === 'h' ? ev.clientX : ev.clientY,
        startThumb: Number.isFinite(startThumb) ? startThumb : 0,
        trackLen,
        thumbLen,
        scrollable,
        contentMin,
        viewSize,
      }
      thumb.style.cursor = 'grabbing'
    })

    track.addEventListener('pointerdown', (ev) => {
      if (ev.target === thumb) return
      ev.preventDefault()
      ev.stopPropagation()
      const rect = track.getBoundingClientRect()
      const trackLen = Number(track.dataset.trackLen ?? 0)
      const thumbLen = Number(track.dataset.thumbLen ?? 0)
      const scrollable = Number(track.dataset.scrollable ?? 0)
      const contentMin = Number(track.dataset.contentMin ?? 0)
      const viewSize = Number(track.dataset.viewSize ?? 0)
      const other = Number(track.dataset.other ?? 0)
      if (trackLen <= thumbLen || scrollable <= 0) return
      const click = axis === 'h' ? ev.clientX - rect.left : ev.clientY - rect.top
      const maxThumb = trackLen - thumbLen
      const thumbPos = clamp(click - thumbLen / 2, 0, maxThumb)
      const t = thumbPos / maxThumb
      const min = contentMin + t * scrollable
      if (axis === 'h') this.onNavigate(min, other)
      else this.onNavigate(other, min)
    })
  }

  private readonly onPointerMove = (ev: PointerEvent) => {
    if (!this.drag) return
    const { axis, startClient, startThumb, trackLen, thumbLen, scrollable, contentMin } = this.drag
    const other = Number((axis === 'h' ? this.hTrack : this.vTrack).dataset.other ?? 0)
    const maxThumb = Math.max(0, trackLen - thumbLen)
    if (maxThumb <= 0 || scrollable <= 0) return
    const delta = (axis === 'h' ? ev.clientX : ev.clientY) - startClient
    const thumbPos = clamp(startThumb + delta, 0, maxThumb)
    const t = thumbPos / maxThumb
    const min = contentMin + t * scrollable
    if (axis === 'h') {
      this.hThumb.style.transform = `translate(${thumbPos}px, 0)`
      this.hThumb.dataset.pos = String(thumbPos)
      this.onNavigate(min, other)
    } else {
      this.vThumb.style.transform = `translate(0, ${thumbPos}px)`
      this.vThumb.dataset.pos = String(thumbPos)
      this.onNavigate(other, min)
    }
  }

  private readonly onPointerUp = () => {
    if (!this.drag) return
    const thumb = this.drag.axis === 'h' ? this.hThumb : this.vThumb
    thumb.style.cursor = 'grab'
    thumb.style.background = this.thumbBg
    this.drag = null
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

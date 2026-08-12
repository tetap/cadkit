import type { Camera2D } from '@cadkit/geometry'
import { worldPoint, type AABB } from '@cadkit/types'
import type { ControlHandle } from './handles.js'
import type { AlignGuide } from './align-snap.js'

/** Lightweight DOM overlay for selection frame, handles, and box-select marquee. */
export class HandleOverlay {
  readonly root: HTMLDivElement
  private readonly hoverEl: HTMLDivElement
  private readonly frameEl: HTMLDivElement
  private readonly rotateStemEl: HTMLDivElement
  private readonly handlesLayer: HTMLDivElement
  private readonly marqueeEl: HTMLDivElement
  private readonly guidesLayer: HTMLDivElement
  private readonly arcGuideEl: HTMLDivElement
  private readonly handlePool: HTMLDivElement[] = []
  private readonly handleLabelPool: HTMLDivElement[] = []
  private readonly guidePool: HTMLDivElement[] = []
  private readonly labelPool: HTMLDivElement[] = []
  private activeHandles = 0
  private activeHandleLabels = 0
  private activeGuides = 0
  private activeLabels = 0

  constructor(host: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'cadkit-handles'
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '3',
      overflow: 'hidden',
    } as Partial<CSSStyleDeclaration>)

    this.hoverEl = document.createElement('div')
    this.hoverEl.className = 'cadkit-hover-frame'
    Object.assign(this.hoverEl.style, {
      position: 'absolute',
      display: 'none',
      boxSizing: 'border-box',
      border: '1px solid rgba(37, 99, 235, 0.65)',
      background: 'rgba(37, 99, 235, 0.06)',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)

    this.marqueeEl = document.createElement('div')
    this.marqueeEl.className = 'cadkit-marquee'
    Object.assign(this.marqueeEl.style, {
      position: 'absolute',
      display: 'none',
      boxSizing: 'border-box',
      border: '1px solid #2563eb',
      background: 'rgba(37, 99, 235, 0.12)',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)

    this.frameEl = document.createElement('div')
    this.frameEl.className = 'cadkit-selection-frame'
    Object.assign(this.frameEl.style, {
      position: 'absolute',
      display: 'none',
      boxSizing: 'border-box',
      border: '1px solid #2563eb',
      background: 'transparent',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)

    this.rotateStemEl = document.createElement('div')
    this.rotateStemEl.className = 'cadkit-rotate-stem'
    Object.assign(this.rotateStemEl.style, {
      position: 'absolute',
      display: 'none',
      width: '1px',
      background: '#2563eb',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)

    this.handlesLayer = document.createElement('div')
    Object.assign(this.handlesLayer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)

    this.guidesLayer = document.createElement('div')
    this.guidesLayer.className = 'cadkit-align-guides'
    Object.assign(this.guidesLayer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)

    this.arcGuideEl = document.createElement('div')
    this.arcGuideEl.className = 'cadkit-arc-guide'
    Object.assign(this.arcGuideEl.style, {
      position: 'absolute',
      display: 'none',
      boxSizing: 'border-box',
      border: '1.5px solid rgba(239, 68, 68, 0.55)',
      borderRadius: '50%',
      background: 'transparent',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)

    this.root.append(
      this.hoverEl,
      this.marqueeEl,
      this.guidesLayer,
      this.arcGuideEl,
      this.frameEl,
      this.rotateStemEl,
      this.handlesLayer,
    )
    host.appendChild(this.root)
  }

  update(
    handles: ControlHandle[],
    camera: Camera2D,
    canvasOffset: { left: number; top: number },
    selectionFrame: AABB | null = null,
    /** Live OBB rotation in world radians. */
    frameRotation = 0,
  ): void {
    this.updateSelectionFrame(selectionFrame, handles, camera, canvasOffset, frameRotation)
    this.updateArcGuide(handles, camera, canvasOffset)
    let i = 0
    let li = 0
    for (const h of handles) {
      const el = this.acquireHandle(i++)
      const s = camera.worldToScreen(h.world)
      const isRotate = h.kind === 'rotate'
      const isScale = h.kind === 'scale'
      const appearance = h.appearance ?? 'default'
      const size =
        appearance === 'arc-radius' || appearance === 'arc-angle'
          ? 18
          : appearance === 'arc-center'
            ? 14
            : appearance === 'shape-param'
              ? 10
              : isRotate
                ? 9
                : isScale
                  ? 8
                  : h.kind === 'radius'
                    ? 8
                    : 7
      el.style.display = 'grid'
      el.style.placeItems = 'center'
      el.style.left = `${canvasOffset.left + s.x - size / 2}px`
      el.style.top = `${canvasOffset.top + s.y - size / 2}px`
      el.style.width = `${size}px`
      el.style.height = `${size}px`
      el.style.boxSizing = 'border-box'
      el.style.pointerEvents = 'none'
      el.style.position = 'absolute'
      el.style.boxShadow = 'none'
      el.style.fontSize = '10px'
      el.style.lineHeight = '1'
      el.style.color = '#2563eb'
      el.style.fontWeight = '500'
      if (appearance === 'arc-radius') {
        el.style.border = '1.5px solid #2563eb'
        el.style.background = '#fff'
        el.style.borderRadius = '50%'
        el.textContent = '⌒'
        el.style.fontSize = '12px'
      } else if (appearance === 'arc-angle') {
        el.style.border = '1.5px solid #2563eb'
        el.style.background = '#fff'
        el.style.borderRadius = '50%'
        el.textContent = '↻'
        el.style.fontSize = '13px'
      } else if (appearance === 'arc-center') {
        el.style.border = '1.5px solid #2563eb'
        el.style.background = '#fff'
        el.style.borderRadius = '50%'
        el.textContent = '＋'
        el.style.fontSize = '12px'
        el.style.color = '#2563eb'
      } else if (appearance === 'shape-param') {
        el.style.border = '1.5px solid #2563eb'
        el.style.background = '#fff'
        el.style.borderRadius = '50%'
        el.textContent = h.kind === 'center' ? '＋' : ''
        el.style.fontSize = '11px'
      } else if (appearance === 'corner-radius') {
        el.style.border = '1.5px solid #94a3b8'
        el.style.background = '#fff'
        el.style.borderRadius = '50%'
        el.textContent = ''
      } else if (appearance === 'star-tips') {
        el.style.border = '1.5px solid #2563eb'
        el.style.background = '#fff'
        el.style.borderRadius = '50%'
        el.textContent = '✦'
        el.style.fontSize = '11px'
      } else {
        el.textContent = ''
        el.style.border = '1.5px solid #2563eb'
        const selected = !!h.selected
        el.style.background = isRotate || selected ? '#2563eb' : '#fff'
        el.style.borderRadius = isRotate || h.kind === 'center' || selected ? '50%' : '1px'
        if (selected) {
          el.style.boxShadow = '0 0 0 2px rgba(37, 99, 235, 0.25)'
        }
      }
      if (h.label) {
        const badge = this.acquireHandleLabel(li++)
        badge.style.display = 'block'
        badge.textContent = h.label
        badge.style.left = `${canvasOffset.left + s.x + size / 2 + 6}px`
        badge.style.top = `${canvasOffset.top + s.y - 10}px`
      }
    }
    for (let j = i; j < this.activeHandles; j++) {
      this.handlePool[j]!.style.display = 'none'
    }
    for (let j = li; j < this.activeHandleLabels; j++) {
      this.handleLabelPool[j]!.style.display = 'none'
    }
    this.activeHandles = Math.max(this.activeHandles, i)
    this.activeHandleLabels = Math.max(this.activeHandleLabels, li)
  }

  private updateArcGuide(
    handles: ControlHandle[],
    camera: Camera2D,
    canvasOffset: { left: number; top: number },
  ): void {
    const guide = handles.find((h) => h.arcGuide)?.arcGuide
    if (!guide) {
      this.arcGuideEl.style.display = 'none'
      return
    }
    const c = camera.worldToScreen(guide.center)
    const r = camera.worldToScreen(guide.rim)
    const screenR = Math.hypot(r.x - c.x, r.y - c.y)
    if (!(screenR > 2)) {
      this.arcGuideEl.style.display = 'none'
      return
    }
    Object.assign(this.arcGuideEl.style, {
      display: 'block',
      left: `${canvasOffset.left + c.x - screenR}px`,
      top: `${canvasOffset.top + c.y - screenR}px`,
      width: `${screenR * 2}px`,
      height: `${screenR * 2}px`,
    } as Partial<CSSStyleDeclaration>)
  }

  private acquireHandle(index: number): HTMLDivElement {
    let el = this.handlePool[index]
    if (!el) {
      el = document.createElement('div')
      this.handlePool[index] = el
      this.handlesLayer.appendChild(el)
    }
    return el
  }

  private updateSelectionFrame(
    frame: AABB | null,
    handles: ControlHandle[],
    camera: Camera2D,
    canvasOffset: { left: number; top: number },
    rotationRad: number,
  ): void {
    if (!frame) {
      this.frameEl.style.display = 'none'
      this.rotateStemEl.style.display = 'none'
      return
    }
    const a = camera.worldToScreen(worldPoint(frame.minX, frame.minY))
    const b = camera.worldToScreen(worldPoint(frame.maxX, frame.maxY))
    const left = Math.min(a.x, b.x)
    const top = Math.min(a.y, b.y)
    const width = Math.max(1, Math.abs(b.x - a.x))
    const height = Math.max(1, Math.abs(b.y - a.y))
    // Camera Y grows downward — CSS rotate uses the same signed world angle.
    const cssDeg = rotationRadToCssDegrees(rotationRad)
    Object.assign(this.frameEl.style, {
      display: 'block',
      left: `${canvasOffset.left + left}px`,
      top: `${canvasOffset.top + top}px`,
      width: `${width}px`,
      height: `${height}px`,
      transformOrigin: '50% 50%',
      transform: Math.abs(rotationRad) > 1e-12 ? `rotate(${cssDeg}deg)` : 'none',
    } as Partial<CSSStyleDeclaration>)

    const rotate = handles.find((h) => h.kind === 'rotate')
    const nHandle = handles.find((h) => h.kind === 'scale' && h.scaleCorner === 'n')
    if (rotate && nHandle) {
      const topMid = camera.worldToScreen(nHandle.world)
      const r = camera.worldToScreen(rotate.world)
      const x0 = canvasOffset.left + topMid.x
      const y0 = canvasOffset.top + topMid.y
      const x1 = canvasOffset.left + r.x
      const y1 = canvasOffset.top + r.y
      const len = Math.hypot(x1 - x0, y1 - y0)
      const angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI
      Object.assign(this.rotateStemEl.style, {
        display: 'block',
        left: `${x0}px`,
        top: `${y0}px`,
        width: `${len}px`,
        height: '1px',
        transformOrigin: '0 50%',
        transform: `rotate(${angle}deg)`,
      } as Partial<CSSStyleDeclaration>)
    } else {
      this.rotateStemEl.style.display = 'none'
    }
  }

  /** Pre-selection hover outline (hidden when null or overlapping selection). */
  updateHover(
    worldBox: AABB | null,
    camera: Camera2D,
    canvasOffset: { left: number; top: number },
  ): void {
    if (!worldBox) {
      this.hoverEl.style.display = 'none'
      return
    }
    const a = camera.worldToScreen(worldPoint(worldBox.minX, worldBox.minY))
    const b = camera.worldToScreen(worldPoint(worldBox.maxX, worldBox.maxY))
    const left = Math.min(a.x, b.x)
    const top = Math.min(a.y, b.y)
    const width = Math.max(1, Math.abs(b.x - a.x))
    const height = Math.max(1, Math.abs(b.y - a.y))
    Object.assign(this.hoverEl.style, {
      display: 'block',
      left: `${canvasOffset.left + left}px`,
      top: `${canvasOffset.top + top}px`,
      width: `${width}px`,
      height: `${height}px`,
    } as Partial<CSSStyleDeclaration>)
  }

  /** World-space AABB for active box select; null hides the marquee. */
  updateMarquee(
    worldBox: AABB | null,
    camera: Camera2D,
    canvasOffset: { left: number; top: number },
  ): void {
    if (!worldBox) {
      this.marqueeEl.style.display = 'none'
      return
    }
    const a = camera.worldToScreen(worldPoint(worldBox.minX, worldBox.minY))
    const b = camera.worldToScreen(worldPoint(worldBox.maxX, worldBox.maxY))
    const left = Math.min(a.x, b.x)
    const top = Math.min(a.y, b.y)
    const width = Math.abs(b.x - a.x)
    const height = Math.abs(b.y - a.y)
    if (width < 0.5 && height < 0.5) {
      this.marqueeEl.style.display = 'none'
      return
    }
    Object.assign(this.marqueeEl.style, {
      display: 'block',
      left: `${canvasOffset.left + left}px`,
      top: `${canvasOffset.top + top}px`,
      width: `${Math.max(width, 1)}px`,
      height: `${Math.max(height, 1)}px`,
    } as Partial<CSSStyleDeclaration>)
  }

  /** Draw Figma-like alignment guides + optional distance labels. */
  updateAlignGuides(
    guides: AlignGuide[],
    camera: Camera2D,
    canvasOffset: { left: number; top: number },
  ): void {
    let gi = 0
    let li = 0
    const zoom = Math.max(camera.getState().zoom, 1e-9)
    for (const g of guides) {
      const line = this.acquireGuide(gi++)
      line.style.display = 'block'
      line.style.position = 'absolute'
      line.style.background = '#f43f5e'
      if (g.axis === 'x') {
        const x = camera.worldToScreen(worldPoint(g.position, 0)).x
        const y0 = camera.worldToScreen(worldPoint(0, g.spanMin)).y
        const y1 = camera.worldToScreen(worldPoint(0, g.spanMax)).y
        line.style.left = `${canvasOffset.left + x}px`
        line.style.top = `${canvasOffset.top + Math.min(y0, y1)}px`
        line.style.width = '1px'
        line.style.height = `${Math.max(1, Math.abs(y1 - y0))}px`
      } else {
        const y = camera.worldToScreen(worldPoint(0, g.position)).y
        const x0 = camera.worldToScreen(worldPoint(g.spanMin, 0)).x
        const x1 = camera.worldToScreen(worldPoint(g.spanMax, 0)).x
        line.style.left = `${canvasOffset.left + Math.min(x0, x1)}px`
        line.style.top = `${canvasOffset.top + y}px`
        line.style.width = `${Math.max(1, Math.abs(x1 - x0))}px`
        line.style.height = '1px'
      }

      if (g.distance != null && g.distance > 0 && g.labelAt) {
        const s = camera.worldToScreen(g.labelAt)
        const label = this.acquireLabel(li++)
        label.style.display = 'block'
        label.style.position = 'absolute'
        label.style.left = `${canvasOffset.left + s.x}px`
        label.style.top = `${canvasOffset.top + s.y}px`
        label.style.transform = 'translate(-50%, -50%)'
        label.style.padding = '1px 4px'
        label.style.fontSize = '11px'
        label.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace'
        label.style.color = '#fff'
        label.style.background = '#f43f5e'
        label.style.borderRadius = '2px'
        label.style.whiteSpace = 'nowrap'
        label.textContent = formatGuideDistance(g.distance, zoom)
      }
    }
    for (let j = gi; j < this.activeGuides; j++) this.guidePool[j]!.style.display = 'none'
    for (let j = li; j < this.activeLabels; j++) this.labelPool[j]!.style.display = 'none'
    this.activeGuides = Math.max(this.activeGuides, gi)
    this.activeLabels = Math.max(this.activeLabels, li)
  }

  private acquireGuide(index: number): HTMLDivElement {
    let el = this.guidePool[index]
    if (!el) {
      el = document.createElement('div')
      this.guidePool[index] = el
      this.guidesLayer.appendChild(el)
    }
    return el
  }

  private acquireLabel(index: number): HTMLDivElement {
    let el = this.labelPool[index]
    if (!el) {
      el = document.createElement('div')
      this.labelPool[index] = el
      this.guidesLayer.appendChild(el)
    }
    return el
  }

  private acquireHandleLabel(index: number): HTMLDivElement {
    let el = this.handleLabelPool[index]
    if (!el) {
      el = document.createElement('div')
      Object.assign(el.style, {
        position: 'absolute',
        display: 'none',
        pointerEvents: 'none',
        padding: '2px 6px',
        borderRadius: '4px',
        background: '#2563eb',
        color: '#fff',
        fontSize: '11px',
        fontWeight: '600',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        lineHeight: '1.2',
        whiteSpace: 'nowrap',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.25)',
      } as Partial<CSSStyleDeclaration>)
      this.handleLabelPool[index] = el
      this.handlesLayer.appendChild(el)
    }
    return el
  }

  clear(): void {
    for (const el of this.handlePool) el.style.display = 'none'
    for (const el of this.handleLabelPool) el.style.display = 'none'
    for (const el of this.guidePool) el.style.display = 'none'
    for (const el of this.labelPool) el.style.display = 'none'
    this.hoverEl.style.display = 'none'
    this.marqueeEl.style.display = 'none'
    this.frameEl.style.display = 'none'
    this.frameEl.style.transform = 'none'
    this.rotateStemEl.style.display = 'none'
    this.arcGuideEl.style.display = 'none'
  }

  dispose(): void {
    this.root.remove()
  }
}

function formatGuideDistance(world: number, _zoom: number): string {
  const v = Math.abs(world)
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

export function rotationRadToCssDegrees(rotationRad: number): number {
  return (rotationRad * 180) / Math.PI
}

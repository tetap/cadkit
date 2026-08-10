import type { Camera2D, LengthUnit } from '@cadkit/geometry'
import { UNIT_LABEL } from '@cadkit/geometry'
import type { AABB } from '@cadkit/types'
import { generateTicks } from './ticks.js'

export interface RulerTheme {
  background: string
  border: string
  tick: string
  label: string
  corner: string
  /** Selection span fill on rulers */
  selectionFill: string
  /** Selection span edge markers */
  selectionEdge: string
}

export const LIGHT_RULER_THEME: RulerTheme = {
  background: '#f0f0f0',
  border: '#d0d0d0',
  tick: '#8a8a8a',
  label: '#5c5c5c',
  corner: '#e8e8e8',
  selectionFill: 'rgba(37, 99, 235, 0.22)',
  selectionEdge: '#2563eb',
}

export const DARK_RULER_THEME: RulerTheme = {
  background: '#1e2430',
  border: '#2b3b4d',
  tick: '#6f8194',
  label: '#9fb3c8',
  corner: '#171c26',
  selectionFill: 'rgba(96, 165, 250, 0.28)',
  selectionEdge: '#60a5fa',
}

export interface RulerOverlayOptions {
  size?: number
  worldUnit: LengthUnit
  displayUnit: LengthUnit
  theme?: RulerTheme
  visible?: boolean
}

/**
 * DOM-based Figma-style rulers. Crisp text at any zoom; synced from Camera2D.
 */
export class RulerOverlay {
  readonly root: HTMLDivElement
  private readonly corner: HTMLDivElement
  private readonly horizontal: HTMLCanvasElement
  private readonly vertical: HTMLCanvasElement
  private readonly unitBadge: HTMLDivElement
  private size: number
  private worldUnit: LengthUnit
  private displayUnit: LengthUnit
  private theme: RulerTheme
  private visible: boolean
  private width = 0
  private height = 0
  private dpr = 1
  /** World-space selection AABB projected onto rulers; null clears highlight. */
  private selectionBounds: AABB | null = null

  constructor(host: HTMLElement, options: RulerOverlayOptions) {
    this.size = options.size ?? 24
    this.worldUnit = options.worldUnit
    this.displayUnit = options.displayUnit
    this.theme = options.theme ?? LIGHT_RULER_THEME
    this.visible = options.visible ?? true

    this.root = document.createElement('div')
    this.root.className = 'cadkit-rulers'
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2',
      display: this.visible ? 'block' : 'none',
    } as Partial<CSSStyleDeclaration>)

    this.corner = document.createElement('div')
    this.unitBadge = document.createElement('div')
    this.unitBadge.textContent = UNIT_LABEL[this.displayUnit]
    Object.assign(this.unitBadge.style, {
      font: '10px ui-sans-serif, system-ui, sans-serif',
      color: this.theme.label,
      textAlign: 'center',
      lineHeight: `${this.size}px`,
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>)
    this.corner.appendChild(this.unitBadge)
    Object.assign(this.corner.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${this.size}px`,
      height: `${this.size}px`,
      background: this.theme.corner,
      borderRight: `1px solid ${this.theme.border}`,
      borderBottom: `1px solid ${this.theme.border}`,
      boxSizing: 'border-box',
      zIndex: '3',
    } as Partial<CSSStyleDeclaration>)

    this.horizontal = document.createElement('canvas')
    this.vertical = document.createElement('canvas')
    Object.assign(this.horizontal.style, {
      position: 'absolute',
      left: `${this.size}px`,
      top: '0',
      height: `${this.size}px`,
      right: '0',
      width: 'auto',
      background: this.theme.background,
      borderBottom: `1px solid ${this.theme.border}`,
      boxSizing: 'border-box',
    } as Partial<CSSStyleDeclaration>)
    Object.assign(this.vertical.style, {
      position: 'absolute',
      left: '0',
      top: `${this.size}px`,
      width: `${this.size}px`,
      bottom: '0',
      height: 'auto',
      background: this.theme.background,
      borderRight: `1px solid ${this.theme.border}`,
      boxSizing: 'border-box',
    } as Partial<CSSStyleDeclaration>)

    this.root.append(this.corner, this.horizontal, this.vertical)
    host.appendChild(this.root)
  }

  getSize(): number {
    return this.size
  }

  setUnits(worldUnit: LengthUnit, displayUnit: LengthUnit): void {
    this.worldUnit = worldUnit
    this.displayUnit = displayUnit
    this.unitBadge.textContent = UNIT_LABEL[displayUnit]
  }

  setTheme(theme: RulerTheme): void {
    this.theme = theme
    this.corner.style.background = theme.corner
    this.corner.style.borderRight = `1px solid ${theme.border}`
    this.corner.style.borderBottom = `1px solid ${theme.border}`
    this.unitBadge.style.color = theme.label
    this.horizontal.style.background = theme.background
    this.horizontal.style.borderBottom = `1px solid ${theme.border}`
    this.vertical.style.background = theme.background
    this.vertical.style.borderRight = `1px solid ${theme.border}`
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.root.style.display = visible ? 'block' : 'none'
  }

  /** Highlight the selected element's world AABB on both rulers. */
  setSelectionBounds(bounds: AABB | null): void {
    this.selectionBounds = bounds
  }

  resize(viewportWidth: number, viewportHeight: number, dpr: number): void {
    this.width = viewportWidth
    this.height = viewportHeight
    this.dpr = dpr
    const hW = Math.max(1, viewportWidth - this.size)
    const vH = Math.max(1, viewportHeight - this.size)
    this.horizontal.width = Math.floor(hW * dpr)
    this.horizontal.height = Math.floor(this.size * dpr)
    this.horizontal.style.width = `${hW}px`
    this.vertical.width = Math.floor(this.size * dpr)
    this.vertical.height = Math.floor(vH * dpr)
    this.vertical.style.height = `${vH}px`
  }

  update(camera: Camera2D): void {
    if (!this.visible) return
    this.drawHorizontal(camera)
    this.drawVertical(camera)
  }

  dispose(): void {
    this.root.remove()
  }

  private drawHorizontal(camera: Camera2D): void {
    const ctx = this.horizontal.getContext('2d')
    if (!ctx) return
    const w = this.horizontal.width / this.dpr
    const h = this.size
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = this.theme.background
    ctx.fillRect(0, 0, w, h)

    this.paintSelectionBand(ctx, camera, 'x', /* along */ w, /* cross */ h)

    // Offset camera for ruler content area (viewport starts after ruler gutter)
    const ticks = generateTicks(camera, 'x', this.worldUnit, this.displayUnit, w)
    ctx.strokeStyle = this.theme.tick
    ctx.fillStyle = this.theme.label
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'top'
    ctx.lineWidth = 1

    for (const tick of ticks) {
      const x = Math.round(tick.screen) + 0.5
      const len = tick.kind === 'major' ? 10 : tick.kind === 'mid' ? 7 : 4
      ctx.beginPath()
      ctx.moveTo(x, h)
      ctx.lineTo(x, h - len)
      ctx.stroke()
      if (tick.label != null) {
        ctx.fillText(tick.label, x + 3, 3)
      }
    }
  }

  private drawVertical(camera: Camera2D): void {
    const ctx = this.vertical.getContext('2d')
    if (!ctx) return
    const w = this.size
    const h = this.vertical.height / this.dpr
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = this.theme.background
    ctx.fillRect(0, 0, w, h)

    // along = vertical canvas height; cross = ruler thickness (was swapped → no Y band).
    this.paintSelectionBand(ctx, camera, 'y', /* along */ h, /* cross */ w)

    const ticks = generateTicks(camera, 'y', this.worldUnit, this.displayUnit, h)
    ctx.strokeStyle = this.theme.tick
    ctx.fillStyle = this.theme.label
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.lineWidth = 1

    for (const tick of ticks) {
      const y = Math.round(tick.screen) + 0.5
      const len = tick.kind === 'major' ? 10 : tick.kind === 'mid' ? 7 : 4
      ctx.beginPath()
      ctx.moveTo(w, y)
      ctx.lineTo(w - len, y)
      ctx.stroke()
      if (tick.label != null) {
        ctx.save()
        ctx.translate(3, y + 3)
        ctx.rotate(-Math.PI / 2)
        ctx.textBaseline = 'top'
        ctx.fillText(tick.label, 0, 0)
        ctx.restore()
      }
    }
  }

  /**
   * Paint selection span (fill + edge ticks) along one ruler axis.
   * @param alongSize Length of the ruler along the measured axis (CSS px)
   * @param crossSize Thickness of the ruler band (CSS px)
   */
  private paintSelectionBand(
    ctx: CanvasRenderingContext2D,
    camera: Camera2D,
    axis: 'x' | 'y',
    alongSize: number,
    crossSize: number,
  ): void {
    const box = this.selectionBounds
    if (!box) return
    const a =
      axis === 'x'
        ? camera.worldToScreen({ x: box.minX, y: box.minY, __space: 'world' }).x
        : camera.worldToScreen({ x: box.minX, y: box.minY, __space: 'world' }).y
    const b =
      axis === 'x'
        ? camera.worldToScreen({ x: box.maxX, y: box.maxY, __space: 'world' }).x
        : camera.worldToScreen({ x: box.maxX, y: box.maxY, __space: 'world' }).y
    const start = Math.min(a, b)
    const end = Math.max(a, b)
    // Clip to the measurable span of this ruler canvas
    const p0 = Math.max(0, Math.min(alongSize, start))
    const p1 = Math.max(0, Math.min(alongSize, end))
    if (p1 - p0 < 0.5) {
      // Degenerate / thin selection — still show a 2px marker if in view
      if (start < 0 || start > alongSize) return
      const m = Math.round(start) + 0.5
      ctx.strokeStyle = this.theme.selectionEdge
      ctx.lineWidth = 2
      ctx.beginPath()
      if (axis === 'x') {
        ctx.moveTo(m, 0)
        ctx.lineTo(m, crossSize)
      } else {
        ctx.moveTo(0, m)
        ctx.lineTo(crossSize, m)
      }
      ctx.stroke()
      return
    }

    ctx.fillStyle = this.theme.selectionFill
    if (axis === 'x') ctx.fillRect(p0, 0, p1 - p0, crossSize)
    else ctx.fillRect(0, p0, crossSize, p1 - p0)

    ctx.strokeStyle = this.theme.selectionEdge
    ctx.lineWidth = 1
    const e0 = Math.round(p0) + 0.5
    const e1 = Math.round(p1) + 0.5
    ctx.beginPath()
    if (axis === 'x') {
      ctx.moveTo(e0, 0)
      ctx.lineTo(e0, crossSize)
      ctx.moveTo(e1, 0)
      ctx.lineTo(e1, crossSize)
    } else {
      ctx.moveTo(0, e0)
      ctx.lineTo(crossSize, e0)
      ctx.moveTo(0, e1)
      ctx.lineTo(crossSize, e1)
    }
    ctx.stroke()
  }
}

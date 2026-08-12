import { resolveLayerAwarePaint, resolveLayerGcode, type Layer } from '@cadkit/document'
import {
  arcTextLocalBounds,
  layoutArcText,
  measureTextAdvance,
  textEntityToLocalOutlines,
  type Camera2D,
} from '@cadkit/geometry'
import type { Entity, EntityId, LayerId, ScreenPoint, TextArcPath, TextEntity } from '@cadkit/types'

export interface TextDraftState {
  entityId: EntityId | null
  /** Layer used for engraver-mode paint (line = stroke / fill = fill). */
  layerId?: LayerId
  content: string
  /** Caret / selection end (insertion point). */
  caret: number
  /** Selection start; equals caret when collapsed. */
  selStart?: number
  /** Selection end; equals caret when collapsed. */
  selEnd?: number
  world: { x: number; y: number }
  /** World-space font size (same units as TextEntity.fontSize). */
  fontSize: number
  fontFamily: string
  color: string
  align?: 'left' | 'center' | 'right'
  widthFactor?: number
  rotation?: number
  path?: TextArcPath
}

export { measureTextAdvance }

function caretLocalOffset(
  content: string,
  caret: number,
  fontSize: number,
  fontFamily: string,
  widthFactor = 1,
): { x: number; y: number } {
  const safe = Math.max(0, Math.min(caret, content.length))
  const before = content.slice(0, safe)
  const lines = before.split(/\r?\n/u)
  const lineIndex = Math.max(0, lines.length - 1)
  const lineText = lines[lineIndex] ?? ''
  return {
    x: measureTextAdvance(lineText, fontSize, fontFamily, widthFactor),
    y: lineIndex * fontSize,
  }
}

function makeGlyphSpan(): HTMLSpanElement {
  const span = document.createElement('span')
  Object.assign(span.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    whiteSpace: 'pre',
    lineHeight: '1',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    // Origin at top-left so `translate(x,y) rotate translate(-50%,-100%)`
    // puts the em-box bottom-center on the layout pose (matches arcTextLocalBounds).
    transformOrigin: '0 0',
  } as Partial<CSSStyleDeclaration>)
  return span
}

function firstTextNode(el: HTMLElement): Text | null {
  const walk = (node: Node): Text | null => {
    if (node.nodeType === Node.TEXT_NODE) return node as Text
    for (const child of node.childNodes) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(el)
}

/**
 * DOM layer for the *live text draft* only (IME caret / selection / typing preview).
 * Committed TextEntity glyphs are vector outlines in the WebGPU scene — not DOM.
 */
export class TextOverlay {
  readonly root: HTMLDivElement
  private readonly pool = new Map<EntityId, HTMLDivElement>()
  private draftEl: HTMLDivElement | null = null
  private caretEl: HTMLDivElement | null = null
  private selLayer: HTMLDivElement | null = null
  private draft: TextDraftState | null = null
  private editingId: EntityId | null = null
  private getLayer: ((id: LayerId) => Layer | undefined) | null = null

  constructor(host: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'cadkit-text-overlay'
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      // Above WebGPU canvas / rulers; below floating chrome (view bar z-20).
      zIndex: '4',
      overflow: 'hidden',
    } as Partial<CSSStyleDeclaration>)
    host.appendChild(this.root)
  }

  setCanvasBounds(left: number, top: number, right = 0, bottom = 0): void {
    this.root.style.inset = `${top}px ${right}px ${bottom}px ${left}px`
  }

  setEditing(id: EntityId | null): void {
    this.editingId = id
  }

  setDraft(draft: TextDraftState | null): void {
    this.draft = draft
    this.editingId = draft?.entityId ?? null
  }

  getDraft(): TextDraftState | null {
    return this.draft
  }

  /**
   * Screen-space caret tip (top of caret bar) used to park the hidden IME
   * and to draw the blinking caret. Prefers live DOM Range metrics when available.
   */
  getCaretScreen(camera: Camera2D): { x: number; y: number; fontSizePx: number; rotation: number } | null {
    if (!this.draft) return null
    const zoom = camera.getState().zoom
    const fontSizePx = this.draft.fontSize * zoom
    const caret = this.draft.selEnd ?? this.draft.caret

    if (this.draft.path?.kind === 'arc') {
      return this.getArcCaretScreen(camera, caret, fontSizePx)
    }

    // Range metrics are axis-aligned; only trust them for upright text.
    const rot = this.draft.rotation ?? 0
    if (Math.abs(rot) < 1e-6) {
      const fromDom = this.measureStraightCaretFromDom(caret)
      if (fromDom) return fromDom
    }

    return this.computeStraightCaretScreen(camera, caret, fontSizePx)
  }

  /** Hit-test draft label (or a generous text pad) in overlay/canvas screen space. */
  hitTestDraft(screen: ScreenPoint, camera: Camera2D, pad = 8): boolean {
    if (!this.draft) return false
    if (this.draft.path?.kind === 'arc') {
      return this.hitTestArcDraft(screen, camera, pad)
    }
    if (this.draftEl && this.draftEl.style.display !== 'none') {
      const rootRect = this.root.getBoundingClientRect()
      const measure = this.draftEl.querySelector(
        '[data-cadkit-text-measure]',
      ) as HTMLElement | null
      const r = (measure ?? this.draftEl).getBoundingClientRect()
      if (r.width > 0 || r.height > 0) {
        const x = rootRect.left + screen.x
        const y = rootRect.top + screen.y
        return (
          x >= r.left - pad &&
          x <= r.right + pad &&
          y >= r.top - pad &&
          y <= r.bottom + pad
        )
      }
    }
    // Fallback AABB around text (rotation ignored — still blocks entity drag while editing).
    const zoom = camera.getState().zoom
    const fontSizePx = this.draft.fontSize * zoom
    const w =
      measureTextAdvance(
        this.draft.content || ' ',
        this.draft.fontSize,
        this.draft.fontFamily,
        this.draft.widthFactor ?? 1,
      ) * zoom
    const lines = Math.max(1, this.draft.content.split(/\r?\n/u).length)
    const h = fontSizePx * lines
    const base = camera.worldToScreen({
      x: this.draft.world.x,
      y: this.draft.world.y,
      __space: 'world',
    })
    let left = base.x
    if (this.draft.align === 'center') left -= w / 2
    else if (this.draft.align === 'right') left -= w
    const top = base.y - fontSizePx
    return (
      screen.x >= left - pad &&
      screen.x <= left + w + pad &&
      screen.y >= top - pad &&
      screen.y <= top + h + pad
    )
  }

  /** Map a screen point to a caret index in the current draft. */
  caretIndexAt(screen: ScreenPoint, camera: Camera2D): number {
    if (!this.draft) return 0
    const content = this.draft.content
    if (!content) return 0

    if (this.draft.path?.kind === 'arc') {
      return this.arcCaretIndexAt(screen, camera)
    }

    const fromDom = this.straightCaretIndexFromDom(screen)
    if (fromDom != null) return fromDom

    return this.straightCaretIndexComputed(screen, camera)
  }

  update(
    _entities: readonly Entity[],
    camera: Camera2D,
    getLayer?: (id: LayerId) => Layer | undefined,
  ): void {
    this.getLayer = getLayer ?? null
    // Committed text is drawn as GPU vector outlines — clear any legacy DOM labels.
    if (this.pool.size) {
      for (const el of this.pool.values()) el.remove()
      this.pool.clear()
    }
    this.renderDraft(camera)
  }

  clear(): void {
    for (const el of this.pool.values()) el.remove()
    this.pool.clear()
    this.draftEl?.remove()
    this.caretEl?.remove()
    this.selLayer?.remove()
    this.draftEl = null
    this.caretEl = null
    this.selLayer = null
    this.draft = null
    this.editingId = null
  }

  dispose(): void {
    this.clear()
    this.root.remove()
  }

  /** Test helper: count glyph spans inside a label (arc mode). */
  countGlyphNodes(id: EntityId): number {
    const el = this.pool.get(id)
    if (!el) return 0
    return el.querySelectorAll('[data-cadkit-glyph]').length
  }

  private ensureLabel(id: EntityId): HTMLDivElement {
    let el = this.pool.get(id)
    if (!el) {
      el = document.createElement('div')
      Object.assign(el.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '0',
        height: '0',
        pointerEvents: 'none',
        userSelect: 'none',
      } as Partial<CSSStyleDeclaration>)
      this.pool.set(id, el)
      this.root.appendChild(el)
    }
    return el
  }

  private paintLabel(
    el: HTMLDivElement,
    e: TextEntity,
    camera: Camera2D,
    layer?: Layer,
  ): void {
    // Visual = same glyph outlines as GPU. Invisible measure layer keeps IME caret.
    el.replaceChildren()
    el.removeAttribute('data-arc')
    el.style.left = '0'
    el.style.top = '0'
    el.style.width = '0'
    el.style.height = '0'
    el.style.transform = ''
    el.style.fontSize = ''
    el.style.webkitTextStroke = ''
    el.style.color = ''
    el.style.opacity = String(e.style.opacity ?? 1)

    const paint = resolveLayerAwarePaint(layer, e.style)
    const mode = resolveLayerGcode(layer).mode
    const color =
      mode === 'line'
        ? paint.stroke || '#111827'
        : paint.fill || paint.stroke || '#111827'

    this.appendOutlineSvg(el, e, camera, color, mode === 'line')

    if (e.path?.kind === 'arc') {
      el.setAttribute('data-arc', '1')
      this.appendInvisibleArcMeasure(el, e, camera)
    } else {
      this.appendInvisibleStraightMeasure(el, e, camera)
    }
  }

  /** Screen-space SVG paths from `textEntityToLocalOutlines` (GPU-parity draft). */
  private appendOutlineSvg(
    el: HTMLDivElement,
    e: TextEntity,
    camera: Camera2D,
    color: string,
    strokeOnly: boolean,
  ): void {
    const outlines = textEntityToLocalOutlines(e)
    if (!outlines.length) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('data-cadkit-text-outlines', '1')
    Object.assign(svg.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      overflow: 'visible',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)
    svg.setAttribute('width', '1')
    svg.setAttribute('height', '1')

    let d = ''
    for (const contour of outlines) {
      const pts = contour.points
      if (pts.length < 2) continue
      for (let i = 0; i < pts.length; i++) {
        const s = camera.worldToScreen({
          x: pts[i]!.x,
          y: pts[i]!.y,
          __space: 'world',
        })
        d += `${i === 0 ? 'M' : 'L'}${s.x} ${s.y}`
      }
      d += 'Z'
    }
    if (!d) return
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    if (strokeOnly) {
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', color)
      path.setAttribute('stroke-width', '1')
      path.setAttribute('vector-effect', 'non-scaling-stroke')
    } else {
      path.setAttribute('fill', color)
      path.setAttribute('fill-rule', 'evenodd')
      path.setAttribute('stroke', 'none')
    }
    svg.appendChild(path)
    el.appendChild(svg)
  }

  /** Transparent DOM text for caret / selection metrics (not painted). */
  private appendInvisibleStraightMeasure(
    el: HTMLDivElement,
    e: TextEntity,
    camera: Camera2D,
  ): void {
    const screen = camera.worldToScreen({
      x: e.position.x,
      y: e.position.y,
      __space: 'world',
    })
    const zoom = camera.getState().zoom
    const wf = e.widthFactor ?? 1
    const naturalW = measureTextAdvance(e.content, e.fontSize, e.fontFamily || 'sans-serif', 1)
    const measure = document.createElement('div')
    measure.dataset.cadkitTextMeasure = '1'
    measure.textContent = e.content
    Object.assign(measure.style, {
      position: 'absolute',
      left: `${screen.x}px`,
      top: `${screen.y - e.fontSize * zoom}px`,
      width: `${Math.max(1, naturalW * zoom)}px`,
      height: 'auto',
      whiteSpace: 'pre',
      lineHeight: '1',
      fontFamily: e.fontFamily || 'sans-serif',
      fontSize: `${Math.max(1, e.fontSize * zoom)}px`,
      textAlign: e.align ?? 'left',
      color: 'transparent',
      opacity: '0',
      pointerEvents: 'none',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>)
    const anchorX = e.align === 'center' ? '50%' : e.align === 'right' ? '100%' : '0'
    const translateX = e.align === 'center' ? '-50%' : e.align === 'right' ? '-100%' : '0'
    measure.style.transformOrigin = `${anchorX} 100%`
    measure.style.transform = `translateX(${translateX}) rotate(${e.rotation ?? 0}rad) scaleX(${wf})`
    el.appendChild(measure)
  }

  private appendInvisibleArcMeasure(
    el: HTMLDivElement,
    e: TextEntity,
    camera: Camera2D,
  ): void {
    const path = e.path!
    const zoom = camera.getState().zoom
    const poses = layoutArcText(
      e.content,
      e.fontSize,
      e.position,
      path,
      e.widthFactor ?? 1,
      e.fontFamily || 'sans-serif',
    )
    const wf = Math.max(1e-6, e.widthFactor ?? 1)
    for (const g of poses) {
      if (g.char === ' ') continue
      const span = makeGlyphSpan()
      span.dataset.cadkitGlyph = '1'
      span.textContent = g.char
      const screen = camera.worldToScreen({ x: g.x, y: g.y, __space: 'world' })
      const deg = (g.rotation * 180) / Math.PI
      const boxW = Math.max(1, (g.advance / wf) * zoom)
      const boxH = Math.max(1, e.fontSize * zoom)
      span.style.fontFamily = e.fontFamily || 'sans-serif'
      span.style.fontSize = `${boxH}px`
      span.style.width = `${boxW}px`
      span.style.height = `${boxH}px`
      span.style.color = 'transparent'
      span.style.opacity = '0'
      span.style.display = 'flex'
      span.style.alignItems = 'flex-end'
      span.style.justifyContent = 'center'
      span.style.transform = `translate(${screen.x}px, ${screen.y}px) rotate(${deg}deg) translate(-50%, -100%)`
      el.appendChild(span)
    }
  }

  private renderDraft(camera: Camera2D): void {
    if (!this.draft) {
      if (this.draftEl) this.draftEl.style.display = 'none'
      if (this.caretEl) this.caretEl.style.display = 'none'
      if (this.selLayer) this.selLayer.style.display = 'none'
      return
    }
    if (!this.draftEl) {
      this.draftEl = document.createElement('div')
      Object.assign(this.draftEl.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '0',
        height: '0',
        pointerEvents: 'none',
        userSelect: 'none',
      } as Partial<CSSStyleDeclaration>)
      this.root.appendChild(this.draftEl)
    }
    if (!this.selLayer) {
      this.selLayer = document.createElement('div')
      Object.assign(this.selLayer.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        overflow: 'visible',
      } as Partial<CSSStyleDeclaration>)
      this.root.appendChild(this.selLayer)
    }
    if (!this.caretEl) {
      this.caretEl = document.createElement('div')
      this.caretEl.className = 'cadkit-text-caret'
      Object.assign(this.caretEl.style, {
        position: 'absolute',
        width: '1.5px',
        background: '#2563eb',
        pointerEvents: 'none',
        transformOrigin: '0 0',
      } as Partial<CSSStyleDeclaration>)
      this.root.appendChild(this.caretEl)
      if (!document.getElementById('cadkit-text-caret-style')) {
        const style = document.createElement('style')
        style.id = 'cadkit-text-caret-style'
        style.textContent =
          '@keyframes cadkit-caret-blink{0%,49%{opacity:1}50%,100%{opacity:0}}.cadkit-text-caret{animation:cadkit-caret-blink 1s step-end infinite}'
        document.head.appendChild(style)
      }
    }

    const d = this.draft
    const fake: TextEntity = {
      id: (d.entityId ?? ('draft' as EntityId)) as EntityId,
      type: 'text',
      layerId: (d.layerId ?? ('0' as LayerId)) as LayerId,
      style: { fill: d.color, stroke: d.color },
      transform: [1, 0, 0, 1, 0, 0],
      version: 1,
      content: d.content,
      position: { x: d.world.x, y: d.world.y },
      fontFamily: d.fontFamily,
      fontSize: d.fontSize,
      align: d.align,
      widthFactor: d.widthFactor,
      rotation: d.rotation,
      path: d.path,
    }

    this.paintLabel(
      this.draftEl,
      fake,
      camera,
      d.layerId ? this.getLayer?.(d.layerId) : undefined,
    )
    this.draftEl.style.display = 'block'

    this.renderSelectionHighlight(camera)

    const caret = this.getCaretScreen(camera)
    if (!caret) {
      this.caretEl.style.display = 'none'
      return
    }
    const selStart = d.selStart ?? d.caret
    const selEnd = d.selEnd ?? d.caret
    // Hide caret while a non-collapsed selection is active (OS text-field convention).
    if (selStart !== selEnd) {
      this.caretEl.style.display = 'none'
      return
    }
    this.caretEl.style.display = 'block'
    this.caretEl.style.left = `${caret.x}px`
    this.caretEl.style.top = `${caret.y}px`
    this.caretEl.style.height = `${Math.max(8, caret.fontSizePx)}px`
    this.caretEl.style.transform = caret.rotation ? `rotate(${caret.rotation}rad)` : ''
  }

  private renderSelectionHighlight(camera: Camera2D): void {
    if (!this.selLayer || !this.draft) return
    const start = this.draft.selStart ?? this.draft.caret
    const end = this.draft.selEnd ?? this.draft.caret
    const a = Math.min(start, end)
    const b = Math.max(start, end)
    this.selLayer.replaceChildren()
    if (a === b) {
      this.selLayer.style.display = 'none'
      return
    }
    this.selLayer.style.display = 'block'
    const rootRect = this.root.getBoundingClientRect()

    if (this.draft.path?.kind === 'arc') {
      const poses = layoutArcText(
        this.draft.content,
        this.draft.fontSize,
        this.draft.world,
        this.draft.path,
        this.draft.widthFactor ?? 1,
        this.draft.fontFamily,
      )
      const zoom = camera.getState().zoom
      const fontSizePx = this.draft.fontSize * zoom
      const wf = Math.max(1e-6, this.draft.widthFactor ?? 1)
      for (let i = a; i < b && i < poses.length; i++) {
        const g = poses[i]!
        if (g.char === ' ' || g.char === '\n') continue
        const screen = camera.worldToScreen({ x: g.x, y: g.y, __space: 'world' })
        const box = document.createElement('div')
        const w = Math.max(4, (g.advance / wf) * zoom)
        Object.assign(box.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: `${w}px`,
          height: `${fontSizePx}px`,
          background: 'rgba(37, 99, 235, 0.28)',
          transform: `translate(${screen.x}px, ${screen.y}px) rotate(${g.rotation}rad) translate(-50%, -100%)`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        } as Partial<CSSStyleDeclaration>)
        this.selLayer.appendChild(box)
      }
      return
    }

    const rects = this.measureStraightSelectionRects(a, b)
    if (rects.length) {
      for (const r of rects) {
        if (r.width <= 0 && r.height <= 0) continue
        const box = document.createElement('div')
        Object.assign(box.style, {
          position: 'absolute',
          left: `${r.left - rootRect.left}px`,
          top: `${r.top - rootRect.top}px`,
          width: `${Math.max(1, r.width)}px`,
          height: `${Math.max(1, r.height)}px`,
          background: 'rgba(37, 99, 235, 0.28)',
          pointerEvents: 'none',
        } as Partial<CSSStyleDeclaration>)
        this.selLayer.appendChild(box)
      }
      return
    }

    // Computed fallback for environments without layout (happy-dom).
    const zoom = camera.getState().zoom
    const fontSizePx = this.draft.fontSize * zoom
    const before = this.draft.content.slice(0, a)
    const selected = this.draft.content.slice(a, b)
    const lineStart = before.lastIndexOf('\n') + 1
    const lineSel = selected.split(/\r?\n/u)[0] ?? ''
    const x0 = measureTextAdvance(
      this.draft.content.slice(lineStart, a),
      this.draft.fontSize,
      this.draft.fontFamily,
      this.draft.widthFactor ?? 1,
    )
    const x1 =
      x0 +
      measureTextAdvance(
        lineSel,
        this.draft.fontSize,
        this.draft.fontFamily,
        this.draft.widthFactor ?? 1,
      )
    const caret0 = this.computeStraightCaretScreen(camera, a, fontSizePx)
    if (!caret0) return
    const box = document.createElement('div')
    const w = Math.max(1, (x1 - x0) * zoom)
    Object.assign(box.style, {
      position: 'absolute',
      left: `${caret0.x}px`,
      top: `${caret0.y}px`,
      width: `${w}px`,
      height: `${fontSizePx}px`,
      background: 'rgba(37, 99, 235, 0.28)',
      transform: caret0.rotation ? `rotate(${caret0.rotation}rad)` : '',
      transformOrigin: '0 0',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>)
    this.selLayer.appendChild(box)
  }

  private measureStraightCaretFromDom(
    index: number,
  ): { x: number; y: number; fontSizePx: number; rotation: number } | null {
    if (!this.draftEl || this.draftEl.style.display === 'none') return null
    const textNode = firstTextNode(this.draftEl)
    if (!textNode) return null
    const len = textNode.length
    const i = Math.max(0, Math.min(index, len))
    try {
      const range = document.createRange()
      if (i < len) {
        range.setStart(textNode, i)
        range.setEnd(textNode, Math.min(i + 1, len))
        const r = range.getBoundingClientRect()
        if (r.height > 0 || r.width > 0) {
          const rootRect = this.root.getBoundingClientRect()
          return {
            x: r.left - rootRect.left,
            y: r.top - rootRect.top,
            fontSizePx: r.height || (this.draft?.fontSize ?? 12),
            rotation: this.draft?.rotation ?? 0,
          }
        }
      }
      if (i > 0) {
        range.setStart(textNode, i - 1)
        range.setEnd(textNode, i)
        const r = range.getBoundingClientRect()
        if (r.height > 0 || r.width > 0) {
          const rootRect = this.root.getBoundingClientRect()
          return {
            x: r.right - rootRect.left,
            y: r.top - rootRect.top,
            fontSizePx: r.height || (this.draft?.fontSize ?? 12),
            rotation: this.draft?.rotation ?? 0,
          }
        }
      }
      // Empty content — use label box.
      const box = this.draftEl.getBoundingClientRect()
      if (box.height > 0 || box.width > 0) {
        const rootRect = this.root.getBoundingClientRect()
        const align = this.draft?.align ?? 'left'
        let x = box.left - rootRect.left
        if (align === 'center') x += box.width / 2
        else if (align === 'right') x += box.width
        return {
          x,
          y: box.top - rootRect.top,
          fontSizePx: box.height || (this.draft?.fontSize ?? 12),
          rotation: this.draft?.rotation ?? 0,
        }
      }
    } catch {
      /* Range unsupported */
    }
    return null
  }

  private measureStraightSelectionRects(start: number, end: number): DOMRect[] {
    if (!this.draftEl) return []
    const textNode = firstTextNode(this.draftEl)
    if (!textNode) return []
    const a = Math.max(0, Math.min(start, textNode.length))
    const b = Math.max(0, Math.min(end, textNode.length))
    if (a === b) return []
    try {
      const range = document.createRange()
      range.setStart(textNode, Math.min(a, b))
      range.setEnd(textNode, Math.max(a, b))
      return [...range.getClientRects()]
    } catch {
      return []
    }
  }

  private computeStraightCaretScreen(
    camera: Camera2D,
    caret: number,
    fontSizePx: number,
  ): { x: number; y: number; fontSizePx: number; rotation: number } | null {
    if (!this.draft) return null
    const zoom = camera.getState().zoom
    const rot = this.draft.rotation ?? 0
    const wf = this.draft.widthFactor ?? 1
    // Local offset in CSS px before scaleX (paint applies widthFactor via scaleX).
    const off = caretLocalOffset(
      this.draft.content,
      caret,
      this.draft.fontSize,
      this.draft.fontFamily,
      1,
    )
    const base = camera.worldToScreen({
      x: this.draft.world.x,
      y: this.draft.world.y,
      __space: 'world',
    })
    const topLeft = { x: base.x, y: base.y - fontSizePx }
    const naturalW = measureTextAdvance(
      this.draft.content,
      this.draft.fontSize,
      this.draft.fontFamily,
      1,
    )
    const W = naturalW * zoom
    const H = fontSizePx
    const align = this.draft.align ?? 'left'
    const ox = align === 'center' ? W / 2 : align === 'right' ? W : 0
    // CSS: transform-origin (ox, H) + translateX(-ox) rotate scaleX — ox terms cancel.
    const lx = off.x * zoom
    const ly = off.y * zoom
    const relX = (lx - ox) * wf
    const relY = ly - H
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    return {
      x: topLeft.x + relX * cos - relY * sin,
      y: topLeft.y + H + relX * sin + relY * cos,
      fontSizePx,
      rotation: rot,
    }
  }

  /**
   * Arc draft hit-test. Parent draftEl is 0×0 (glyphs positioned via transform),
   * so the straight-text AABB around the circle center must not be used.
   */
  private hitTestArcDraft(screen: ScreenPoint, camera: Camera2D, pad: number): boolean {
    if (this.draftEl && this.draftEl.style.display !== 'none') {
      const rootRect = this.root.getBoundingClientRect()
      const x = rootRect.left + screen.x
      const y = rootRect.top + screen.y
      const glyphs = this.draftEl.querySelectorAll('[data-cadkit-glyph]')
      let minL = Infinity
      let minT = Infinity
      let maxR = -Infinity
      let maxB = -Infinity
      let any = false
      for (const node of glyphs) {
        const r = (node as HTMLElement).getBoundingClientRect()
        if (r.width <= 0 && r.height <= 0) continue
        any = true
        minL = Math.min(minL, r.left)
        minT = Math.min(minT, r.top)
        maxR = Math.max(maxR, r.right)
        maxB = Math.max(maxB, r.bottom)
        if (
          x >= r.left - pad &&
          x <= r.right + pad &&
          y >= r.top - pad &&
          y <= r.bottom + pad
        ) {
          return true
        }
      }
      // Gaps between glyphs still count (union AABB of laid-out spans).
      if (
        any &&
        x >= minL - pad &&
        x <= maxR + pad &&
        y >= minT - pad &&
        y <= maxB + pad
      ) {
        return true
      }
    }

    const draft = this.draft!
    const box = arcTextLocalBounds(
      draft.content || ' ',
      draft.fontSize,
      draft.world,
      draft.path!,
      draft.widthFactor ?? 1,
      draft.fontFamily,
    )
    const corners = [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ].map((p) => camera.worldToScreen({ x: p.x, y: p.y, __space: 'world' }))
    const minX = Math.min(...corners.map((c) => c.x)) - pad
    const maxX = Math.max(...corners.map((c) => c.x)) + pad
    const minY = Math.min(...corners.map((c) => c.y)) - pad
    const maxY = Math.max(...corners.map((c) => c.y)) + pad
    return screen.x >= minX && screen.x <= maxX && screen.y >= minY && screen.y <= maxY
  }

  /**
   * Baseline (em-box bottom) screen position for an arc caret slot.
   * Matches glyph CSS: pose at bottom-center, then rotate around that point.
   */
  private getArcCaretBaseline(
    camera: Camera2D,
    caret: number,
  ): { x: number; y: number; rotation: number } | null {
    const draft = this.draft!
    const poses = layoutArcText(
      draft.content,
      draft.fontSize,
      draft.world,
      draft.path!,
      draft.widthFactor ?? 1,
      draft.fontFamily,
    )
    if (poses.length === 0) {
      const screen = camera.worldToScreen({
        x: draft.world.x + draft.path!.radius,
        y: draft.world.y,
        __space: 'world',
      })
      return { x: screen.x, y: screen.y, rotation: 0 }
    }
    const idx = Math.max(0, Math.min(caret, poses.length) - 1)
    const g = poses[Math.max(0, idx)]!
    const after = caret <= 0 ? poses[0]! : g
    const along = caret <= 0 ? -after.advance / 2 : after.advance / 2
    const wx = after.x + Math.cos(after.rotation) * along
    const wy = after.y + Math.sin(after.rotation) * along
    const screen = camera.worldToScreen({ x: wx, y: wy, __space: 'world' })
    return { x: screen.x, y: screen.y, rotation: after.rotation }
  }

  private getArcCaretScreen(
    camera: Camera2D,
    caret: number,
    fontSizePx: number,
  ): { x: number; y: number; fontSizePx: number; rotation: number } {
    const base = this.getArcCaretBaseline(camera, caret)
    if (!base) {
      return { x: 0, y: 0, fontSizePx, rotation: 0 }
    }
    // Caret tip = em-box top. Local (0,-H) after rotate(θ) → (H·sinθ, -H·cosθ).
    // Element draws downward from tip with the same rotation (transform-origin 0 0).
    return {
      x: base.x + fontSizePx * Math.sin(base.rotation),
      y: base.y - fontSizePx * Math.cos(base.rotation),
      fontSizePx,
      rotation: base.rotation,
    }
  }

  private straightCaretIndexFromDom(screen: ScreenPoint): number | null {
    if (!this.draftEl || !this.draft) return null
    const textNode = firstTextNode(this.draftEl)
    if (!textNode) return null
    const len = textNode.length
    if (len === 0) return 0
    const rootRect = this.root.getBoundingClientRect()
    const targetX = rootRect.left + screen.x
    const targetY = rootRect.top + screen.y
    try {
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i <= len; i++) {
        const range = document.createRange()
        if (i < len) {
          range.setStart(textNode, i)
          range.setEnd(textNode, Math.min(i + 1, len))
          const r = range.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) continue
          const cx = r.left
          const cy = r.top + r.height / 2
          const dist = (cx - targetX) ** 2 + (cy - targetY) ** 2
          if (dist < bestDist) {
            bestDist = dist
            best = i
          }
          // If click is in the right half of this glyph, prefer after it.
          if (
            targetX >= r.left &&
            targetX <= r.right &&
            targetY >= r.top - 2 &&
            targetY <= r.bottom + 2
          ) {
            return targetX > r.left + r.width / 2 ? i + 1 : i
          }
        } else {
          range.setStart(textNode, len - 1)
          range.setEnd(textNode, len)
          const r = range.getBoundingClientRect()
          if (r.width === 0 && r.height === 0) continue
          const cx = r.right
          const cy = r.top + r.height / 2
          const dist = (cx - targetX) ** 2 + (cy - targetY) ** 2
          if (dist < bestDist) {
            bestDist = dist
            best = len
          }
        }
      }
      return bestDist < Infinity ? best : null
    } catch {
      return null
    }
  }

  private straightCaretIndexComputed(screen: ScreenPoint, camera: Camera2D): number {
    if (!this.draft) return 0
    const content = this.draft.content
    const zoom = camera.getState().zoom
    const fontSizePx = this.draft.fontSize * zoom
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i <= content.length; i++) {
      const c = this.computeStraightCaretScreen(camera, i, fontSizePx)
      if (!c) continue
      const dist = (c.x - screen.x) ** 2 + (c.y + fontSizePx / 2 - screen.y) ** 2
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    return best
  }

  private arcCaretIndexAt(screen: ScreenPoint, camera: Camera2D): number {
    if (!this.draft?.path || this.draft.path.kind !== 'arc') return 0
    const poses = layoutArcText(
      this.draft.content,
      this.draft.fontSize,
      this.draft.world,
      this.draft.path,
      this.draft.widthFactor ?? 1,
      this.draft.fontFamily,
    )
    if (poses.length === 0) return 0
    const fontSizePx = this.draft.fontSize * camera.getState().zoom
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i <= poses.length; i++) {
      const base = this.getArcCaretBaseline(camera, i)
      if (!base) continue
      // Compare against glyph mid-height along the local upright axis.
      const mx = base.x + (fontSizePx / 2) * Math.sin(base.rotation)
      const my = base.y - (fontSizePx / 2) * Math.cos(base.rotation)
      const dist = (mx - screen.x) ** 2 + (my - screen.y) ** 2
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    return best
  }

}

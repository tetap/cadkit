import type { Editor } from '@cadkit/editor'
import type { Entity, ImageEntity } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { refreshHotFromSelection } from '../bindEditorEvents.js'
import { t } from '../i18n/index.js'
import { openCurveTextDialog } from './CurveTextDialog.js'
import { openOffsetDialog } from './OffsetDialog.js'
import { btnGhost, fieldControl, fieldLabel } from './tokens.js'

function applyHotStyle(editor: Editor, store: AppStore, patch: Record<string, unknown>): void {
  const ids = store.get().selectionIds
  for (const id of ids) {
    if (patch.stroke !== undefined || patch.fill !== undefined || patch.opacity !== undefined) {
      editor.applyStyle(id, {
        stroke: patch.stroke as string | undefined,
        fill: patch.fill as string | undefined,
        opacity: patch.opacity as number | undefined,
      })
    }
  }
  refreshHotFromSelection(editor, store)
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 100) / 100
  return String(r)
}

function applyGeometry(editor: Editor, store: AppStore, el: HTMLElement): void {
  const id = store.get().selectionIds[0]
  if (!id) return
  const x = Number((el.querySelector('#ctx-x') as HTMLInputElement | null)?.value)
  const y = Number((el.querySelector('#ctx-y') as HTMLInputElement | null)?.value)
  const w = Number((el.querySelector('#ctx-w') as HTMLInputElement | null)?.value)
  const h = Number((el.querySelector('#ctx-h') as HTMLInputElement | null)?.value)
  const e = editor.document.getEntity(id)
  if (!e) return

  if (e.type === 'text' && Number.isFinite(x) && Number.isFinite(y)) {
    editor.updateEntity(id, { position: { x, y } } as Partial<Entity>, 'ctx-pos')
  } else if (e.type === 'image') {
    const patch: Partial<ImageEntity> = {}
    if (Number.isFinite(x) && Number.isFinite(y)) patch.origin = { x, y }
    if (Number.isFinite(w) && w > 0) patch.width = w
    if (Number.isFinite(h) && h > 0) patch.height = h
    editor.updateEntity(id, patch as Partial<Entity>, 'ctx-image')
  } else if (e.type === 'line' && Number.isFinite(x) && Number.isFinite(y)) {
    const nw = Number.isFinite(w) && w >= 0 ? w : Math.abs(e.end.x - e.start.x)
    const nh = Number.isFinite(h) && h >= 0 ? h : Math.abs(e.end.y - e.start.y)
    editor.updateEntity(
      id,
      { start: { x, y }, end: { x: x + nw, y: y + nh } } as Partial<Entity>,
      'ctx-line',
    )
  } else if (e.type === 'circle' && Number.isFinite(x) && Number.isFinite(y)) {
    const size = Number.isFinite(w) && w > 0 ? w : Number.isFinite(h) && h > 0 ? h : e.radius * 2
    const r = size / 2
    editor.updateEntity(
      id,
      { center: { x: x + r, y: y + r }, radius: r } as Partial<Entity>,
      'ctx-circle',
    )
  } else if (e.type === 'ellipse' && Number.isFinite(x) && Number.isFinite(y)) {
    const rx = Number.isFinite(w) && w > 0 ? w / 2 : e.radiusX
    const ry = Number.isFinite(h) && h > 0 ? h / 2 : e.radiusY
    editor.updateEntity(
      id,
      { center: { x: x + rx, y: y + ry }, radiusX: rx, radiusY: ry } as Partial<Entity>,
      'ctx-ellipse',
    )
  } else if (
    (e.type === 'polyline' || e.type === 'bezier') &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    e.points.length > 0
  ) {
    const xs = e.points.map((p) => p.x)
    const ys = e.points.map((p) => p.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    const ow = maxX - minX || 1
    const oh = maxY - minY || 1
    const nw = Number.isFinite(w) && w > 0 ? w : ow
    const nh = Number.isFinite(h) && h > 0 ? h : oh
    const sx = nw / ow
    const sy = nh / oh
    const points = e.points.map((p) => ({
      x: x + (p.x - minX) * sx,
      y: y + (p.y - minY) * sy,
    }))
    editor.updateEntity(id, { points } as Partial<Entity>, 'ctx-poly')
  }

  refreshHotFromSelection(editor, store)
}

export function mountContextBar(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  let disposeOffset: (() => void) | null = null
  let offsetOpen = false
  let disposeCurve: (() => void) | null = null
  let curveOpen = false

  const closeOffset = () => {
    disposeOffset?.()
    disposeOffset = null
    offsetOpen = false
  }
  const closeCurve = () => {
    disposeCurve?.()
    disposeCurve = null
    curveOpen = false
  }

  const render = () => {
    const { hot, selectionIds } = store.get()
    const disabled = selectionIds.length === 0
    const single = selectionIds.length === 1
    const showText = hot.entityType === 'text'
    const showSize = single && hot.entityType !== 'text' && hot.entityType !== null
    const geoDisabled = !single

    // Match ViewBar: hide the floating pill when nothing is selected.
    if (disabled) {
      closeOffset()
      closeCurve()
      el.innerHTML = ''
      el.hidden = true
      return
    }
    el.hidden = false

    el.innerHTML = `
      <div class="pointer-events-auto relative flex max-w-full items-center gap-2 overflow-x-auto rounded-2xl border border-neutral-200/90 bg-white/95 px-3 py-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.12)] backdrop-blur">
        <label class="${fieldLabel}">X
          <input type="number" id="ctx-x" class="${fieldControl} w-[4.5rem]" step="0.01" value="${fmt(hot.x)}" ${geoDisabled ? 'disabled' : ''} />
        </label>
        <label class="${fieldLabel}">Y
          <input type="number" id="ctx-y" class="${fieldControl} w-[4.5rem]" step="0.01" value="${fmt(hot.y)}" ${geoDisabled ? 'disabled' : ''} />
        </label>
        ${
          showSize
            ? `<label class="${fieldLabel}">W
                <input type="number" id="ctx-w" class="${fieldControl} w-[4.5rem]" min="0" step="0.01" value="${fmt(hot.width)}" />
              </label>
              <label class="${fieldLabel}">H
                <input type="number" id="ctx-h" class="${fieldControl} w-[4.5rem]" min="0" step="0.01" value="${fmt(hot.height)}" />
              </label>`
            : ''
        }
        <span class="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>
        <label class="${fieldLabel}">${t('stroke')}
          <input type="color" id="ctx-stroke" class="h-8 w-10 cursor-pointer rounded border border-neutral-300 bg-white p-0.5" value="${toColorInput(hot.stroke)}" />
        </label>
        <label class="${fieldLabel}">${t('fill')}
          <input type="color" id="ctx-fill" class="h-8 w-10 cursor-pointer rounded border border-neutral-300 bg-white p-0.5" value="${toColorInput(hot.fill)}" />
        </label>
        <label class="${fieldLabel}">${t('opacity')}
          <input type="number" id="ctx-opacity" class="${fieldControl} w-16" min="0" max="1" step="0.05" value="${hot.opacity}" />
        </label>
        ${
          showText
            ? `<label class="${fieldLabel}">${t('fontSize')}
                <input type="number" id="ctx-fs" class="${fieldControl} w-16" min="1" step="1" value="${hot.fontSize}" />
              </label>
              <button type="button" id="ctx-curve" class="${btnGhost} gap-1.5 ${hot.arcText ? '!border-brand-dark !bg-brand/15 !text-brand-dark' : ''}" title="${t('curveText')}">
                <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="M3 14c3-8 11-8 14 0"/>
                  <path d="M5 12.5h0.1M8 9.5h0.1M12 9.5h0.1M15 12.5h0.1" stroke-linecap="round"/>
                </svg>
                ${t('curveText')}
              </button>`
            : ''
        }
        <span class="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>
        <button type="button" id="ctx-offset" class="${btnGhost} gap-1.5" title="${t('offset')}">
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="5" y="5" width="8" height="8" rx="1"/>
            <rect x="3" y="3" width="12" height="12" rx="1.5" stroke-dasharray="2 1.5"/>
          </svg>
          ${t('offset')}
        </button>
        <span class="shrink-0 pl-1 text-xs text-muted">
          ${selectionIds.length} ${t('selected')}
        </span>
      </div>
    `

    for (const key of ['#ctx-x', '#ctx-y', '#ctx-w', '#ctx-h']) {
      el.querySelector(key)?.addEventListener('change', () => applyGeometry(editor, store, el))
    }
    el.querySelector('#ctx-stroke')?.addEventListener('input', (ev) => {
      applyHotStyle(editor, store, { stroke: (ev.target as HTMLInputElement).value })
    })
    el.querySelector('#ctx-fill')?.addEventListener('input', (ev) => {
      applyHotStyle(editor, store, { fill: (ev.target as HTMLInputElement).value })
    })
    el.querySelector('#ctx-opacity')?.addEventListener('change', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value)
      if (Number.isFinite(v)) applyHotStyle(editor, store, { opacity: v })
    })
    el.querySelector('#ctx-fs')?.addEventListener('change', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value)
      const id = store.get().selectionIds[0]
      if (!id || !Number.isFinite(v)) return
      editor.updateEntity(id, { fontSize: v } as Partial<Entity>, 'ctx-fontSize')
      refreshHotFromSelection(editor, store)
    })
    el.querySelector('#ctx-curve')?.addEventListener('click', () => {
      const id = store.get().selectionIds[0]
      if (!id || store.get().hot.entityType !== 'text') return
      closeOffset()
      if (curveOpen) {
        closeCurve()
        return
      }
      curveOpen = true
      const host = el.querySelector('.pointer-events-auto') as HTMLElement | null
      if (!host) return
      disposeCurve = openCurveTextDialog(host, editor, id, () => {
        disposeCurve = null
        curveOpen = false
        refreshHotFromSelection(editor, store)
      })
    })
    el.querySelector('#ctx-offset')?.addEventListener('click', () => {
      if (store.get().selectionIds.length === 0) {
        store.set({ status: t('offsetNeedSelection') })
        return
      }
      closeCurve()
      if (offsetOpen) {
        closeOffset()
        return
      }
      offsetOpen = true
      const host = el.querySelector('.pointer-events-auto') as HTMLElement | null
      if (!host) return
      disposeOffset = openOffsetDialog(host, editor, () => {
        disposeOffset = null
        offsetOpen = false
        refreshHotFromSelection(editor, store)
      })
    })
  }

  const unsub = store.subscribeKeys(['hot', 'selectionIds', 'localeTick', 'uiEpoch'], render)
  return () => {
    closeOffset()
    closeCurve()
    unsub()
  }
}

function toColorInput(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7)
  if (value === 'none' || value === 'transparent' || value.endsWith('00')) return '#000000'
  return '#222222'
}

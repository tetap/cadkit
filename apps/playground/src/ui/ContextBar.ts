import type { BooleanOp, Editor } from '@cadkit/editor'
import type { Entity, ImageEntity } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { refreshHotFromSelection } from '../bindEditorEvents.js'
import { t, type MessageKey } from '../i18n/index.js'
import { openCurveTextDialog } from './CurveTextDialog.js'
import { ICONS } from './icons.js'
import { openOffsetDialog } from './OffsetDialog.js'
import { btnGhost, fieldControl, fieldLabel } from './tokens.js'

const BOOL_OPS: Array<{ op: BooleanOp; label: MessageKey; tip: MessageKey }> = [
  { op: 'union', label: 'booleanUnion', tip: 'booleanUnion' },
  { op: 'subtract', label: 'booleanSubtract', tip: 'tipBooleanSubtract' },
  { op: 'intersect', label: 'booleanIntersect', tip: 'booleanIntersect' },
  { op: 'exclude', label: 'booleanExclude', tip: 'booleanExclude' },
]

const MIRROR_OPS: Array<{ axis: 'horizontal' | 'vertical'; label: MessageKey }> = [
  { axis: 'horizontal', label: 'mirrorH' },
  { axis: 'vertical', label: 'mirrorV' },
]

const MENU_ITEM =
  'flex w-full items-center px-3 py-1.5 text-left text-xs text-ink hover:bg-soft'
const MENU_PANEL =
  'fixed z-[80] min-w-[9.5rem] overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-lg'

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

function chevronSvg(): string {
  return `<svg viewBox="0 0 12 12" class="h-3 w-3 opacity-70" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <path d="M3 4.5 6 7.5 9 4.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`
}

function placeBodyMenu(menu: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect()
  const pad = 8
  document.body.appendChild(menu)
  menu.classList.remove('hidden')
  const mw = menu.offsetWidth
  const mh = menu.offsetHeight
  let left = r.left
  let top = r.bottom + 6
  if (left + mw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - mw - pad)
  if (top + mh > window.innerHeight - pad) top = Math.max(pad, r.top - mh - 6)
  menu.style.left = `${left}px`
  menu.style.top = `${top}px`
}

export function mountContextBar(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  let disposeOffset: (() => void) | null = null
  let offsetOpen = false
  let disposeCurve: (() => void) | null = null
  let curveOpen = false
  /** Currently open toolbar dropdown id (`bool` | `mirror`), or null. */
  let openMenu: 'bool' | 'mirror' | null = null
  let floatingMenu: HTMLElement | null = null
  let onDocPointerDown: ((ev: PointerEvent) => void) | null = null

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

  const closeMenus = () => {
    openMenu = null
    if (floatingMenu) {
      floatingMenu.remove()
      floatingMenu = null
    }
    for (const id of ['#ctx-bool', '#ctx-mirror']) {
      el.querySelector(id)?.setAttribute('aria-expanded', 'false')
    }
    if (onDocPointerDown) {
      document.removeEventListener('pointerdown', onDocPointerDown, true)
      onDocPointerDown = null
    }
    if (editor.hasLiveOffsetPreview()) editor.refreshLiveOffsetPreview()
    else editor.clearPreview()
  }

  const openToolbarMenu = (kind: 'bool' | 'mirror', itemsHtml: string) => {
    const btn = el.querySelector(kind === 'bool' ? '#ctx-bool' : '#ctx-mirror') as HTMLElement | null
    if (!btn) return
    if (openMenu === kind) {
      closeMenus()
      return
    }
    closeOffset()
    closeCurve()
    closeMenus()
    openMenu = kind
    const menu = document.createElement('div')
    menu.id = kind === 'bool' ? 'ctx-bool-menu' : 'ctx-mirror-menu'
    menu.setAttribute('role', 'menu')
    menu.className = MENU_PANEL
    menu.innerHTML = itemsHtml
    floatingMenu = menu
    placeBodyMenu(menu, btn)
    btn.setAttribute('aria-expanded', 'true')

    if (kind === 'bool') {
      menu.querySelectorAll<HTMLButtonElement>('[data-bool]').forEach((item) => {
        const op = item.dataset.bool as BooleanOp
        item.addEventListener('mouseenter', () => {
          editor.previewBooleanSelection(op)
        })
        item.addEventListener('mouseleave', () => {
          if (editor.hasLiveOffsetPreview()) editor.refreshLiveOffsetPreview()
          else editor.clearPreview()
        })
        item.addEventListener('click', () => {
          const ids = editor.booleanSelection(op)
          closeMenus()
          if (!ids.length) {
            store.set({ status: t('booleanNeedSelection') })
            return
          }
          refreshHotFromSelection(editor, store)
          store.set({ status: t('ready') })
        })
      })
    } else {
      menu.querySelectorAll<HTMLButtonElement>('[data-mirror]').forEach((item) => {
        item.addEventListener('click', () => {
          const axis = item.dataset.mirror as 'horizontal' | 'vertical'
          // Mirror all selected entities about the selection AABB center.
          editor.mirrorSelection(axis)
          closeMenus()
          refreshHotFromSelection(editor, store)
        })
      })
    }

    onDocPointerDown = (e) => {
      const target = e.target
      if (!(target instanceof Node)) {
        closeMenus()
        return
      }
      if (btn.contains(target) || menu.contains(target)) return
      closeMenus()
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
  }

  const mirrorMenuHtml = () =>
    MIRROR_OPS.map(
      (m) => `
      <button type="button" role="menuitem" data-mirror="${m.axis}" class="${MENU_ITEM}" title="${t(m.label)}">
        ${t(m.label)}
      </button>`,
    ).join('')

  const boolMenuHtml = () =>
    BOOL_OPS.map(
      (b) => `
      <button type="button" role="menuitem" data-bool="${b.op}" class="${MENU_ITEM}" title="${t(b.tip)}">
        ${t(b.label)}
      </button>`,
    ).join('')

  const render = () => {
    const { hot, selectionIds } = store.get()
    const disabled = selectionIds.length === 0
    const single = selectionIds.length === 1
    const multi = selectionIds.length >= 2
    const showText = hot.entityType === 'text'
    const showImage = single && hot.entityType === 'image'
    const showSize = single && hot.entityType !== 'text' && hot.entityType !== null
    const geoDisabled = !single
    const canUngroup = selectionIds.some((id) => editor.document.getEntity(id)?.type === 'group')
    const canBoolean = editor.getBooleanSelection().length >= 2
    const effectsOpen = store.get().effectsOpen

    // Match ViewBar: hide the floating pill when nothing is selected.
    if (disabled) {
      closeOffset()
      closeCurve()
      closeMenus()
      el.innerHTML = ''
      el.hidden = true
      return
    }
    el.hidden = false
    closeMenus()

    el.innerHTML = `
      <div class="pointer-events-auto relative flex max-w-full items-center gap-2 overflow-visible rounded-2xl border border-neutral-200/90 bg-white/95 px-3 py-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.12)] backdrop-blur">
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
        ${
          showText
            ? `<span class="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>
              <label class="${fieldLabel}">${t('fontSize')}
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
        ${
          showImage
            ? `<span class="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>
              <button type="button" id="ctx-effects" class="${btnGhost} gap-1.5 ${effectsOpen ? '!border-brand-dark !bg-brand/15 !text-brand-dark' : ''}" title="${t('imageAdjust')}" aria-pressed="${effectsOpen}">
                <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <circle cx="10" cy="10" r="3"/>
                  <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M5.2 14.8l1.4-1.4M13.4 6.6l1.4-1.4" stroke-linecap="round"/>
                </svg>
                ${t('imageAdjust')}
              </button>`
            : ''
        }
        <span class="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>
        <button type="button" id="ctx-mirror" class="${btnGhost} gap-1" aria-haspopup="menu" aria-expanded="false" title="${t('mirror')}">
          ${t('mirror')}
          ${chevronSvg()}
        </button>
        <span class="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden="true"></span>
        <button type="button" id="ctx-offset" class="${btnGhost} gap-1.5" title="${t('offset')}">
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="5" y="5" width="8" height="8" rx="1"/>
            <rect x="3" y="3" width="12" height="12" rx="1.5" stroke-dasharray="2 1.5"/>
          </svg>
          ${t('offset')}
        </button>
        ${
          canBoolean
            ? `<button type="button" id="ctx-bool" class="${btnGhost} gap-1" aria-haspopup="menu" aria-expanded="false" title="${t('boolean')}">
                ${t('boolean')}
                ${chevronSvg()}
              </button>`
            : ''
        }
        ${
          multi
            ? `<button type="button" id="ctx-group" class="${btnGhost} gap-1.5 [&_svg]:h-4 [&_svg]:w-4" title="${t('tipGroup')}">
                ${ICONS.group}
                ${t('group')}
              </button>`
            : ''
        }
        ${
          canUngroup
            ? `<button type="button" id="ctx-ungroup" class="${btnGhost} gap-1.5 [&_svg]:h-4 [&_svg]:w-4" title="${t('tipUngroup')}">
                ${ICONS.ungroup}
                ${t('ungroup')}
              </button>`
            : ''
        }
        <span class="shrink-0 pl-1 text-xs text-muted">
          ${selectionIds.length} ${t('selected')}
        </span>
      </div>
    `

    for (const key of ['#ctx-x', '#ctx-y', '#ctx-w', '#ctx-h']) {
      el.querySelector(key)?.addEventListener('change', () => applyGeometry(editor, store, el))
    }
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
      closeMenus()
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
    el.querySelector('#ctx-effects')?.addEventListener('click', () => {
      store.set({ effectsOpen: !store.get().effectsOpen })
    })
    el.querySelector('#ctx-mirror')?.addEventListener('click', (ev) => {
      ev.stopPropagation()
      openToolbarMenu('mirror', mirrorMenuHtml())
    })
    el.querySelector('#ctx-offset')?.addEventListener('click', () => {
      if (store.get().selectionIds.length === 0) {
        store.set({ status: t('offsetNeedSelection') })
        return
      }
      closeCurve()
      closeMenus()
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
    el.querySelector('#ctx-bool')?.addEventListener('click', (ev) => {
      ev.stopPropagation()
      openToolbarMenu('bool', boolMenuHtml())
    })
    el.querySelector('#ctx-group')?.addEventListener('click', () => {
      const ids = store.get().selectionIds
      if (ids.length >= 2) editor.group(ids)
    })
    el.querySelector('#ctx-ungroup')?.addEventListener('click', () => {
      for (const id of store.get().selectionIds) {
        const e = editor.document.getEntity(id)
        if (e?.type === 'group') editor.ungroup(id)
      }
    })
  }

  const unsub = store.subscribeKeys(
    ['hot', 'selectionIds', 'localeTick', 'uiEpoch', 'effectsOpen'],
    render,
  )
  return () => {
    closeOffset()
    closeCurve()
    closeMenus()
    unsub()
  }
}

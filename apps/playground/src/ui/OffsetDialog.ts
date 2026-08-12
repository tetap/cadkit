import type { Editor, OffsetDirection, OffsetJoin, OffsetOptions } from '@cadkit/editor'
import { t } from '../i18n/index.js'
import { btnGhost, fieldControl, fieldLabel } from './tokens.js'

export interface OffsetDialogState {
  distance: number
  direction: OffsetDirection
  join: OffsetJoin
  outerShapesOnly: boolean
  precisionOpen: boolean
  precision: number
}

const DEFAULT_STATE: OffsetDialogState = {
  distance: 2,
  direction: 'external',
  join: 'round',
  outerShapesOnly: false,
  precisionOpen: false,
  precision: 4,
}

function toOptions(s: OffsetDialogState): OffsetOptions {
  return {
    distance: s.distance,
    direction: s.direction,
    join: s.join,
    outerShapesOnly: s.outerShapesOnly,
    precision: s.precision,
    arcTolerance: Math.max(0.05, 0.5 / Math.max(1, s.precision)),
  }
}

const JOIN_ICONS: Record<OffsetJoin, string> = {
  miter: `<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 16V8l6-4 6 4v8"/></svg>`,
  round: `<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 16V9a6 6 0 0 1 12 0v7"/></svg>`,
  bevel: `<svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 16V10l4-4h4l4 4v6"/></svg>`,
}

/**
 * Floating Offset panel (LightBurn-style). Host should be position:relative.
 * Returns disposer.
 */
export function openOffsetDialog(
  host: HTMLElement,
  editor: Editor,
  onDone: () => void,
): () => void {
  let state: OffsetDialogState = { ...DEFAULT_STATE }
  const root = document.createElement('div')
  root.id = 'offset-dialog'
  root.className =
    'absolute right-3 top-14 z-40 w-[280px] overflow-hidden rounded-xl border border-line bg-panel shadow-xl'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', t('offset'))

  const refreshPreview = () => {
    if (!(state.distance > 0)) {
      // Keep the live offset session alive so moving the selection still tracks.
      editor.clearPreviewGeometry()
      return
    }
    editor.previewOffsetSelection(toOptions(state))
  }

  const render = () => {
    const unit = editor.getWorldUnit()
    root.innerHTML = `
      <header class="flex items-center justify-between border-b border-line px-3 py-2.5">
        <h3 class="font-display text-sm font-semibold text-ink">${t('offset')}</h3>
        <button type="button" id="off-close" class="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-soft" aria-label="${t('cancel')}">×</button>
      </header>
      <div class="space-y-3 px-3 py-3">
        <div>
          <div class="${fieldLabel} mb-1.5">${t('offsetDirection')}</div>
          <div class="flex gap-4 text-xs text-ink">
            <label class="inline-flex items-center gap-1.5">
              <input type="checkbox" id="off-ext" ${state.direction === 'external' ? 'checked' : ''} />
              ${t('offsetExternal')}
            </label>
            <label class="inline-flex items-center gap-1.5">
              <input type="checkbox" id="off-inner" ${state.direction === 'inner' ? 'checked' : ''} />
              ${t('offsetInner')}
            </label>
          </div>
        </div>
        <div>
          <div class="${fieldLabel} mb-1.5">${t('offsetCorner')}</div>
          <div class="flex gap-1" role="group">
            ${(['miter', 'round', 'bevel'] as OffsetJoin[])
              .map(
                (j) => `
              <button type="button" data-join="${j}"
                class="grid h-9 flex-1 place-items-center rounded-md border ${
                  state.join === j
                    ? 'border-brand-dark bg-brand/15 text-brand-dark'
                    : 'border-neutral-300 bg-white text-ink hover:bg-soft'
                }"
                title="${j}" aria-pressed="${state.join === j}">${JOIN_ICONS[j]}</button>`,
              )
              .join('')}
          </div>
        </div>
        <div>
          <div class="mb-1 flex items-center justify-between">
            <label class="${fieldLabel}" for="off-dist">${t('offsetDistance')} (${unit})</label>
            <input type="number" id="off-dist-num" class="${fieldControl} w-16" min="0.01" step="0.1" value="${state.distance}" />
          </div>
          <input type="range" id="off-dist" class="w-full accent-slate-800" min="0.1" max="20" step="0.1" value="${state.distance}" />
        </div>
        <label class="flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" id="off-outer" ${state.outerShapesOnly ? 'checked' : ''} />
          ${t('offsetOuterOnly')}
        </label>
        <details class="rounded-md border border-line bg-soft/40 px-2 py-1.5" ${state.precisionOpen ? 'open' : ''}>
          <summary class="cursor-pointer text-xs font-medium text-ink">${t('offsetPrecision')}</summary>
          <div class="mt-2 flex items-center gap-2 pb-1">
            <input type="range" id="off-prec" class="flex-1 accent-slate-800" min="2" max="8" step="1" value="${state.precision}" />
            <span class="w-6 text-right text-xs text-muted">${state.precision}</span>
          </div>
        </details>
      </div>
      <footer class="flex justify-end gap-2 border-t border-line px-3 py-2.5">
        <button type="button" id="off-cancel" class="${btnGhost}">${t('cancel')}</button>
        <button type="button" id="off-ok" class="inline-flex h-8 items-center rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800">${t('confirm')}</button>
      </footer>
    `

    const close = () => {
      editor.clearPreview()
      root.remove()
      onDone()
    }

    root.querySelector('#off-close')?.addEventListener('click', close)
    root.querySelector('#off-cancel')?.addEventListener('click', close)
    root.querySelector('#off-ok')?.addEventListener('click', () => {
      editor.offsetSelection(toOptions(state))
      root.remove()
      onDone()
    })

    const setDir = (dir: OffsetDirection) => {
      state = { ...state, direction: dir }
      render()
      refreshPreview()
    }
    root.querySelector('#off-ext')?.addEventListener('change', (ev) => {
      if ((ev.target as HTMLInputElement).checked) setDir('external')
      else setDir('inner')
    })
    root.querySelector('#off-inner')?.addEventListener('change', (ev) => {
      if ((ev.target as HTMLInputElement).checked) setDir('inner')
      else setDir('external')
    })

    root.querySelectorAll<HTMLButtonElement>('[data-join]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state = { ...state, join: btn.dataset.join as OffsetJoin }
        render()
        refreshPreview()
      })
    })

    const syncDist = (v: number) => {
      if (!Number.isFinite(v) || v <= 0) return
      state = { ...state, distance: v }
      const range = root.querySelector<HTMLInputElement>('#off-dist')
      const num = root.querySelector<HTMLInputElement>('#off-dist-num')
      if (range) range.value = String(v)
      if (num) num.value = String(v)
      refreshPreview()
    }
    root.querySelector('#off-dist')?.addEventListener('input', (ev) => {
      syncDist(Number((ev.target as HTMLInputElement).value))
    })
    root.querySelector('#off-dist-num')?.addEventListener('change', (ev) => {
      syncDist(Number((ev.target as HTMLInputElement).value))
    })

    root.querySelector('#off-outer')?.addEventListener('change', (ev) => {
      state = { ...state, outerShapesOnly: (ev.target as HTMLInputElement).checked }
      refreshPreview()
    })

    const details = root.querySelector('details')
    details?.addEventListener('toggle', () => {
      state = { ...state, precisionOpen: details.open }
    })
    root.querySelector('#off-prec')?.addEventListener('input', (ev) => {
      state = { ...state, precision: Number((ev.target as HTMLInputElement).value) }
      const label = root.querySelector('#off-prec')?.nextElementSibling
      if (label) label.textContent = String(state.precision)
      refreshPreview()
    })
  }

  // Anchor relative to canvas section (context bar's parent)
  const section = host.closest('section') ?? host.parentElement ?? document.body
  if (getComputedStyle(section).position === 'static') {
    ;(section as HTMLElement).style.position = 'relative'
  }
  section.appendChild(root)
  render()
  refreshPreview()

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      editor.clearPreview()
      root.remove()
      onDone()
    }
  }
  document.addEventListener('keydown', onKey)

  return () => {
    document.removeEventListener('keydown', onKey)
    editor.clearPreview()
    root.remove()
  }
}

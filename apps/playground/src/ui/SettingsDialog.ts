import type { Editor } from '@cadkit/editor'
import type { LengthUnit, WorkAreaMode } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import {
  availableLocales,
  getLocale,
  LOCALE_LABELS,
  setLocale,
  t,
  type Locale,
} from '../i18n/index.js'
import { btnGhost, fieldControl, fieldLabel, hint, sectionCard, sectionTitle } from './tokens.js'

const UNITS: LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft', 'px']
const SETTINGS_KEY = 'cadkit.playground.settings'

export interface PersistedSettings {
  rasterDpi?: number
  svgDpi?: number
}

export function loadPersistedSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as PersistedSettings
  } catch {
    return {}
  }
}

function persistDpi(editor: Editor): void {
  const payload: PersistedSettings = {
    rasterDpi: editor.getRasterDpi(),
    svgDpi: editor.getSvgDpi(),
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload))
}

/** Apply saved import DPI onto a freshly created editor. */
export function applyPersistedImportDpi(editor: Editor): void {
  const s = loadPersistedSettings()
  if (s.rasterDpi) editor.setRasterDpi(s.rasterDpi)
  if (s.svgDpi) editor.setSvgDpi(s.svgDpi)
}

/**
 * Modal settings: language + document display + work area + guides + import DPI.
 */
export function openSettingsDialog(editor: Editor, store: AppStore, onDone?: () => void): () => void {
  const backdrop = document.createElement('div')
  backdrop.id = 'settings-dialog'
  backdrop.className = 'fixed inset-0 z-[90]'
  document.body.appendChild(backdrop)

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close()
  }

  function close() {
    backdrop.remove()
    document.removeEventListener('keydown', onKey)
    onDone?.()
  }

  const paintChrome = () => {
    backdrop.innerHTML = `
      <div class="absolute inset-0 bg-black/45" data-settings-close></div>
      <div
        class="absolute left-1/2 top-[8%] w-[min(440px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header class="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="settings-title" class="font-display text-base font-semibold text-ink">${t('settings')}</h2>
          <button type="button" class="grid h-8 w-8 place-items-center rounded-md text-lg text-muted hover:bg-soft" data-settings-close aria-label="${t('cancel')}">×</button>
        </header>
        <div id="settings-body" class="max-h-[70vh] overflow-y-auto p-4"></div>
        <footer class="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" id="settings-done" class="inline-flex h-8 items-center rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800">${t('confirm')}</button>
        </footer>
      </div>
    `
    backdrop.querySelectorAll('[data-settings-close]').forEach((el) => {
      el.addEventListener('click', close)
    })
    backdrop.querySelector('#settings-done')?.addEventListener('click', close)
  }

  const render = () => {
    paintChrome()
    const body = backdrop.querySelector<HTMLElement>('#settings-body')!
    const s = store.get()
    const wa = editor.getWorkArea()
    const page = wa.mode === 'page'
    const unitOpts = UNITS.map(
      (u) => `<option value="${u}" ${u === s.displayUnit ? 'selected' : ''}>${u}</option>`,
    ).join('')
    const localeOpts = availableLocales()
      .map(
        (locale) =>
          `<option value="${locale}" ${locale === getLocale() ? 'selected' : ''}>${LOCALE_LABELS[locale]}</option>`,
      )
      .join('')

    body.innerHTML = `
      <div class="${sectionCard}">
        <h3 class="${sectionTitle}">${t('settingsLanguage')}</h3>
        <label class="${fieldLabel} flex w-full justify-between gap-3">
          <span>${t('langLabel')}</span>
          <select id="set-locale" class="${fieldControl} w-36">${localeOpts}</select>
        </label>
      </div>

      <div class="${sectionCard}">
        <h3 class="${sectionTitle}">${t('settingsDocument')}</h3>
        <label class="${fieldLabel} mb-2 flex w-full justify-between gap-3">
          <span>${t('unit')}</span>
          <select id="set-unit" class="${fieldControl} w-28">${unitOpts}</select>
        </label>
        <label class="${fieldLabel} mb-2 flex w-full justify-between gap-3">
          <span>${t('workArea')}</span>
          <select id="set-wa-mode" class="${fieldControl} w-28">
            <option value="page" ${page ? 'selected' : ''}>${t('workAreaPage')}</option>
            <option value="unbounded" ${!page ? 'selected' : ''}>${t('workAreaUnbounded')}</option>
          </select>
        </label>
        <div id="set-wa-size" class="${page ? 'flex items-center gap-2' : 'hidden'}">
          <span class="text-xs text-muted">${t('workAreaSize')}</span>
          <input id="set-wa-w" type="number" min="1" step="1" value="${wa.width}" class="${fieldControl} w-20 tabular-nums" />
          <span class="text-muted">×</span>
          <input id="set-wa-h" type="number" min="1" step="1" value="${wa.height}" class="${fieldControl} w-20 tabular-nums" />
          <span class="text-xs text-muted">${s.displayUnit}</span>
        </div>
      </div>

      <div class="${sectionCard}">
        <h3 class="${sectionTitle}">${t('settingsGuides')}</h3>
        <label class="mb-2 flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" id="set-grid" ${s.gridVisible ? 'checked' : ''} />
          ${t('grid')}
        </label>
        <label class="flex items-center gap-2 text-xs text-ink">
          <input type="checkbox" id="set-rulers" ${s.rulersVisible ? 'checked' : ''} />
          ${t('rulers')}
        </label>
      </div>

      <div class="${sectionCard} !mb-0">
        <h3 class="${sectionTitle}">${t('settingsImport')}</h3>
        <p class="${hint} mb-3">${t('settingsImportHint')}</p>
        <label class="${fieldLabel} mb-2 flex w-full justify-between gap-3">
          <span>${t('imageDpi')}</span>
          <input id="set-raster-dpi" type="number" min="1" step="1" value="${editor.getRasterDpi()}" class="${fieldControl} w-28 tabular-nums" />
        </label>
        <label class="${fieldLabel} flex w-full justify-between gap-3">
          <span>${t('svgDpi')}</span>
          <input id="set-svg-dpi" type="number" min="1" step="1" value="${editor.getSvgDpi()}" class="${fieldControl} w-28 tabular-nums" />
        </label>
        <div class="mt-2 flex gap-2">
          <button type="button" id="set-dpi-reset" class="${btnGhost}">${t('settingsDpiReset')}</button>
        </div>
      </div>
    `

    body.querySelector('#set-locale')?.addEventListener('change', (ev) => {
      setLocale((ev.target as HTMLSelectElement).value as Locale)
      store.set({ localeTick: store.get().localeTick + 1 })
      render()
    })

    body.querySelector('#set-unit')?.addEventListener('change', (ev) => {
      const unit = (ev.target as HTMLSelectElement).value as LengthUnit
      editor.setDisplayUnit(unit)
      store.set({ displayUnit: unit })
      render()
    })
    body.querySelector('#set-wa-mode')?.addEventListener('change', (ev) => {
      const mode = (ev.target as HTMLSelectElement).value as WorkAreaMode
      editor.setWorkAreaMode(mode)
      store.set({ uiEpoch: store.get().uiEpoch + 1 })
      if (mode === 'page') editor.fitView()
      render()
    })
    const applySize = () => {
      const w = Number((body.querySelector('#set-wa-w') as HTMLInputElement | null)?.value)
      const h = Number((body.querySelector('#set-wa-h') as HTMLInputElement | null)?.value)
      if (!(w > 0) || !(h > 0)) return
      const cur = editor.getWorkArea()
      editor.setWorkAreaSize(w, h, cur.originX, cur.originY)
      editor.fitView()
      store.set({ uiEpoch: store.get().uiEpoch + 1 })
    }
    body.querySelector('#set-wa-w')?.addEventListener('change', applySize)
    body.querySelector('#set-wa-h')?.addEventListener('change', applySize)

    body.querySelector('#set-grid')?.addEventListener('change', (ev) => {
      const next = (ev.target as HTMLInputElement).checked
      editor.setGridVisible(next)
      store.set({ gridVisible: next })
    })
    body.querySelector('#set-rulers')?.addEventListener('change', (ev) => {
      const next = (ev.target as HTMLInputElement).checked
      editor.setRulersVisible(next)
      store.set({ rulersVisible: next })
    })

    const applyDpi = () => {
      const raster = Number((body.querySelector('#set-raster-dpi') as HTMLInputElement | null)?.value)
      const svg = Number((body.querySelector('#set-svg-dpi') as HTMLInputElement | null)?.value)
      if (raster > 0) editor.setRasterDpi(raster)
      if (svg > 0) editor.setSvgDpi(svg)
      persistDpi(editor)
    }
    body.querySelector('#set-raster-dpi')?.addEventListener('change', applyDpi)
    body.querySelector('#set-svg-dpi')?.addEventListener('change', applyDpi)
    body.querySelector('#set-dpi-reset')?.addEventListener('click', () => {
      editor.setRasterDpi(96)
      editor.setSvgDpi(72)
      persistDpi(editor)
      render()
    })
  }

  document.addEventListener('keydown', onKey)
  render()
  return close
}

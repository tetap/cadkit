import type { Editor } from '@cadkit/editor'
import {
  createFilterId,
  validateCustomFilterBody,
  type BuiltinFilterName,
  type FilterOp,
} from '@cadkit/assets'
import type { ImageEntity } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { refreshHotFromSelection } from '../bindEditorEvents.js'
import { t } from '../i18n/index.js'
import { btnGhost, fieldControl, hint, sectionCard, sectionTitle } from './tokens.js'

const BUILTINS: BuiltinFilterName[] = [
  'brightness',
  'contrast',
  'saturation',
  'grayscale',
  'invert',
  'opacity',
  'blur',
]

const DEFAULT_PARAMS: Record<BuiltinFilterName, Record<string, number>> = {
  brightness: { amount: 1 },
  contrast: { amount: 1 },
  saturation: { amount: 1 },
  grayscale: { amount: 1 },
  invert: { amount: 1 },
  opacity: { amount: 1 },
  blur: { amount: 2 },
}

const SLIDER: Partial<Record<BuiltinFilterName, { min: number; max: number; step: number }>> = {
  brightness: { min: 0, max: 2, step: 0.05 },
  contrast: { min: 0, max: 2, step: 0.05 },
  saturation: { min: 0, max: 2, step: 0.05 },
  opacity: { min: 0, max: 1, step: 0.05 },
  blur: { min: 0, max: 16, step: 0.5 },
}

function selectedImage(editor: Editor, store: AppStore): ImageEntity | null {
  const ids = store.get().selectionIds
  if (ids.length !== 1) return null
  const e = editor.document.getEntity(ids[0]!)
  return e?.type === 'image' ? e : null
}

export function mountEffectsPanel(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  let customBody = 'return vec4f(color.rgb * 0.85, color.a);'
  let compileMsg = ''
  let compileOk: boolean | null = null

  const commit = (img: ImageEntity, filters: FilterOp[]) => {
    editor.setImageFilters(img.id, filters)
    refreshHotFromSelection(editor, store)
  }

  const render = () => {
    const img = selectedImage(editor, store)
    if (!img) {
      el.innerHTML = `
        <div class="${sectionCard}">
          <h3 class="${sectionTitle}">${t('effects')}</h3>
          <p class="${hint}">${t('effectsDisabled')}</p>
        </div>`
      return
    }

    const filters = [...(img.filters ?? [])] as FilterOp[]
    const stack = filters
      .map((f, index) => {
        const slider = f.type !== 'custom' ? SLIDER[f.type as BuiltinFilterName] : undefined
        const amount = f.params.amount ?? 1
        return `
          <div class="mb-2 rounded-lg border border-line bg-white p-2.5" data-fid="${f.id}">
            <header class="mb-1.5 flex items-center justify-between gap-2">
              <strong class="text-xs font-semibold capitalize text-ink">${f.type}</strong>
              <div class="flex gap-1">
                <button type="button" class="${btnGhost} !h-7 !min-w-7 !px-0" data-move="up" data-i="${index}" title="Up" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button type="button" class="${btnGhost} !h-7 !min-w-7 !px-0" data-move="down" data-i="${index}" title="Down" ${index === filters.length - 1 ? 'disabled' : ''}>↓</button>
                <button type="button" class="${btnGhost} !h-7 !min-w-7 !px-0" data-remove="${index}" title="Remove">✕</button>
              </div>
            </header>
            ${
              slider
                ? `<label class="block text-xs text-muted">
                    <span class="amount-label">amount ${amount.toFixed(2)}</span>
                    <input type="range" class="mt-1 w-full" data-param="${index}" min="${slider.min}" max="${slider.max}" step="${slider.step}" value="${amount}" />
                  </label>`
                : f.type === 'custom'
                  ? `<p class="${hint}">custom WGSL</p>`
                  : `<p class="${hint}">no params</p>`
            }
          </div>`
      })
      .join('')

    const compileClass =
      compileOk === true
        ? 'text-brand-dark'
        : compileOk === false
          ? 'text-red-600'
          : 'text-muted'

    el.innerHTML = `
      <div class="${sectionCard}">
        <h3 class="${sectionTitle}">${t('effects')}</h3>
        <p class="${hint}">${t('effectsHint')}</p>
        <div class="my-2 flex flex-wrap gap-1.5">
          <select id="fx-add-type" class="${fieldControl}">
            ${BUILTINS.map((b) => `<option value="${b}">${b}</option>`).join('')}
            <option value="custom">custom</option>
          </select>
          <button type="button" id="fx-add" class="${btnGhost}">${t('addFilter')}</button>
          <button type="button" id="fx-reset" class="${btnGhost}">${t('resetFilters')}</button>
        </div>
        <div>${stack || `<p class="${hint}">${t('noFilters')}</p>`}</div>
      </div>
      <div class="${sectionCard}">
        <h3 class="${sectionTitle}">${t('customWgsl')}</h3>
        <p class="${hint}">filter(color, uv, params) → vec4f body</p>
        <textarea id="fx-wgsl" class="mt-2 min-h-[110px] w-full rounded-md border border-neutral-300 bg-white p-2 font-mono text-[11px] text-ink">${escapeHtml(customBody)}</textarea>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <button type="button" id="fx-validate" class="${btnGhost}">${t('validateWgsl')}</button>
          <button type="button" id="fx-add-custom" class="${btnGhost}">${t('addCustomFilter')}</button>
        </div>
        <div class="mt-2 text-[11px] ${compileClass}">${escapeHtml(compileMsg || t('compileIdle'))}</div>
      </div>`

    el.querySelector('#fx-add')?.addEventListener('click', () => {
      const type = (el.querySelector('#fx-add-type') as HTMLSelectElement).value
      if (type === 'custom') {
        addCustom(img)
        return
      }
      const name = type as BuiltinFilterName
      editor.addImageFilter(img.id, {
        type: name,
        params: { ...DEFAULT_PARAMS[name] },
      })
      refreshHotFromSelection(editor, store)
    })

    el.querySelector('#fx-reset')?.addEventListener('click', () => {
      commit(img, [])
      compileMsg = ''
      compileOk = null
    })

    el.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.remove)
        const next = filters.filter((_, idx) => idx !== i)
        commit(img, next)
      })
    })

    el.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.i)
        const dir = btn.dataset.move === 'up' ? -1 : 1
        const j = i + dir
        if (j < 0 || j >= filters.length) return
        const next = [...filters]
        const tmp = next[i]!
        next[i] = next[j]!
        next[j] = tmp
        commit(img, next)
      })
    })

    el.querySelectorAll<HTMLInputElement>('[data-param]').forEach((input) => {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.param)
        const amount = Number(input.value)
        const cur = selectedImage(editor, store)
        if (!cur) return
        const stack = [...(cur.filters ?? [])] as FilterOp[]
        const next = stack.map((f, idx) =>
          idx === i ? { ...f, params: { ...f.params, amount } } : f,
        )
        // Live preview without rebuilding the panel (avoids slider focus loss).
        editor.setImageFilters(cur.id, next)
        const label = input.closest('label')
        const span = label?.querySelector('.amount-label')
        if (span) span.textContent = `amount ${amount.toFixed(2)}`
      })
      input.addEventListener('change', () => {
        const i = Number(input.dataset.param)
        const cur = selectedImage(editor, store)
        if (!cur) return
        const stack = [...(cur.filters ?? [])] as FilterOp[]
        const next = stack.map((f, idx) =>
          idx === i
            ? { ...f, params: { ...f.params, amount: Number(input.value) } }
            : f,
        )
        commit(cur, next)
      })
    })

    const wgsl = el.querySelector<HTMLTextAreaElement>('#fx-wgsl')
    wgsl?.addEventListener('input', () => {
      customBody = wgsl.value
    })

    el.querySelector('#fx-validate')?.addEventListener('click', () => {
      customBody = wgsl?.value ?? customBody
      const v = validateCustomFilterBody(customBody)
      compileOk = v.ok
      compileMsg = v.ok ? t('compileOk') : v.errors.join('; ')
      render()
    })

    el.querySelector('#fx-add-custom')?.addEventListener('click', () => addCustom(img))

    function addCustom(target: ImageEntity) {
      customBody = wgsl?.value ?? customBody
      const v = validateCustomFilterBody(customBody)
      compileOk = v.ok
      compileMsg = v.ok ? t('compileOk') : v.errors.join('; ')
      if (!v.ok) {
        render()
        return
      }
      editor.addImageFilter(target.id, {
        id: createFilterId(),
        type: 'custom',
        params: { p0: 1 },
        wgslBody: customBody,
      })
      refreshHotFromSelection(editor, store)
    }
  }

  return store.subscribeKeys(['selectionIds', 'localeTick', 'uiEpoch'], render)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

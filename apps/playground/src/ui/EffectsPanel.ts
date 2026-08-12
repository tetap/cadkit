import type { Editor } from '@cadkit/editor'
import { createFilterId, type BuiltinFilterName, type FilterOp } from '@cadkit/assets'
import type { ImageEntity } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { refreshHotFromSelection } from '../bindEditorEvents.js'
import { t } from '../i18n/index.js'
import { btnGhost, hint, sectionCard } from './tokens.js'

type ToneMode = 'none' | 'grayscale' | 'floydSteinberg' | 'threshold'

interface AdjustState {
  brightness: number
  contrast: number
  saturation: number
  tone: ToneMode
  cutoff: number
}

/** Map UI -100..100 centered at 0 → filter amount (1 = identity). */
function uiToAmount(ui: number): number {
  return 1 + ui / 100
}

function amountToUi(amount: number): number {
  return Math.round((amount - 1) * 100)
}

function parseFilters(filters: readonly FilterOp[]): AdjustState {
  const state: AdjustState = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    tone: 'none',
    cutoff: 0.5,
  }
  for (const f of filters) {
    if (f.type === 'brightness') state.brightness = amountToUi(f.params.amount ?? 1)
    else if (f.type === 'contrast') state.contrast = amountToUi(f.params.amount ?? 1)
    else if (f.type === 'saturation') state.saturation = amountToUi(f.params.amount ?? 1)
    else if (f.type === 'grayscale') state.tone = 'grayscale'
    else if (f.type === 'floydSteinberg') state.tone = 'floydSteinberg'
    else if (f.type === 'threshold') {
      state.tone = 'threshold'
      state.cutoff = f.params.cutoff ?? f.params.amount ?? 0.5
    }
  }
  return state
}

function buildFilters(state: AdjustState): FilterOp[] {
  const out: FilterOp[] = []
  const push = (type: BuiltinFilterName, params: Record<string, number>) => {
    out.push({ id: createFilterId(), type, params })
  }
  if (state.brightness !== 0) push('brightness', { amount: uiToAmount(state.brightness) })
  if (state.contrast !== 0) push('contrast', { amount: uiToAmount(state.contrast) })
  if (state.saturation !== 0) push('saturation', { amount: uiToAmount(state.saturation) })
  if (state.tone === 'grayscale') push('grayscale', { amount: 1 })
  else if (state.tone === 'floydSteinberg') push('floydSteinberg', { levels: 2, amount: 1 })
  else if (state.tone === 'threshold') push('threshold', { cutoff: state.cutoff, amount: state.cutoff })
  return out
}

function selectedImage(editor: Editor, store: AppStore): ImageEntity | null {
  const ids = store.get().selectionIds
  if (ids.length !== 1) return null
  const e = editor.document.getEntity(ids[0]!)
  return e?.type === 'image' ? e : null
}

/**
 * Floating right drawer: image adjustment (sliders + mutually exclusive tone mode).
 */
export function mountEffectsPanel(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  const commit = (img: ImageEntity, state: AdjustState) => {
    editor.setImageFilters(img.id, buildFilters(state))
    refreshHotFromSelection(editor, store)
  }

  const render = () => {
    const { effectsOpen } = store.get()
    const img = selectedImage(editor, store)

    if (!effectsOpen || !img) {
      el.classList.add('hidden')
      el.innerHTML = ''
      el.setAttribute('aria-hidden', 'true')
      return
    }

    el.classList.remove('hidden')
    el.setAttribute('aria-hidden', 'false')

    const state = parseFilters((img.filters ?? []) as FilterOp[])
    const tones: Array<{ id: ToneMode; label: string }> = [
      { id: 'none', label: t('toneNone') },
      { id: 'grayscale', label: t('toneGrayscale') },
      { id: 'floydSteinberg', label: t('toneFloyd') },
      { id: 'threshold', label: t('toneThreshold') },
    ]

    const slider = (id: string, label: string, value: number, min: number, max: number) => `
      <label class="mb-2.5 block">
        <div class="mb-1 flex items-center justify-between text-xs">
          <span class="text-muted">${label}</span>
          <span class="tabular-nums text-ink">${value}</span>
        </div>
        <input type="range" id="${id}" class="w-full accent-brand" min="${min}" max="${max}" step="1" value="${value}" />
      </label>`

    el.innerHTML = `
      <div class="pointer-events-auto flex h-full flex-col border-l border-neutral-200/90 bg-white/95 shadow-[-4px_0_24px_rgba(15,23,42,0.08)] backdrop-blur">
        <header class="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <h3 class="font-display text-sm font-semibold text-ink">${t('imageAdjust')}</h3>
          <div class="flex items-center gap-1">
            <button type="button" id="fx-reset" class="${btnGhost} !h-7 !px-2" title="${t('resetFilters')}">↺</button>
            <button type="button" id="fx-close" class="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-soft" aria-label="${t('cancel')}">×</button>
          </div>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div class="${sectionCard} !mb-3">
            <p class="mb-2 text-[10px] uppercase tracking-wide text-muted">${t('toneMode')}</p>
            <div class="flex flex-col gap-1.5" role="radiogroup" aria-label="${t('toneMode')}">
              ${tones
                .map(
                  (tone) => `
                <label class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-soft">
                  <input type="radio" name="fx-tone" value="${tone.id}" ${state.tone === tone.id ? 'checked' : ''} />
                  <span>${tone.label}</span>
                </label>`,
                )
                .join('')}
            </div>
            ${
              state.tone === 'threshold'
                ? `<label class="mt-2 block text-xs text-muted">
                    <span>${t('thresholdCutoff')} ${Math.round(state.cutoff * 100)}</span>
                    <input type="range" id="fx-cutoff" class="mt-1 w-full accent-brand" min="0" max="100" step="1" value="${Math.round(state.cutoff * 100)}" />
                  </label>`
                : ''
            }
          </div>
          <div class="${sectionCard}">
            <p class="mb-2 text-[10px] uppercase tracking-wide text-muted">${t('imageAdjust')}</p>
            ${slider('fx-brightness', t('adjBrightness'), state.brightness, -100, 100)}
            ${slider('fx-contrast', t('adjContrast'), state.contrast, -100, 100)}
            ${slider('fx-saturation', t('adjSaturation'), state.saturation, -100, 100)}
            <p class="${hint}">${t('imageAdjustHint')}</p>
          </div>
        </div>
      </div>`

    const readState = (): AdjustState => {
      const tone =
        (el.querySelector<HTMLInputElement>('input[name="fx-tone"]:checked')?.value as ToneMode) ??
        'none'
      const cutoffEl = el.querySelector<HTMLInputElement>('#fx-cutoff')
      return {
        brightness: Number(el.querySelector<HTMLInputElement>('#fx-brightness')?.value ?? 0),
        contrast: Number(el.querySelector<HTMLInputElement>('#fx-contrast')?.value ?? 0),
        saturation: Number(el.querySelector<HTMLInputElement>('#fx-saturation')?.value ?? 0),
        tone,
        cutoff: cutoffEl ? Number(cutoffEl.value) / 100 : state.cutoff,
      }
    }

    const onChange = () => commit(img, readState())

    el.querySelector('#fx-close')?.addEventListener('click', () => {
      store.set({ effectsOpen: false })
    })
    el.querySelector('#fx-reset')?.addEventListener('click', () => {
      commit(img, {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        tone: 'none',
        cutoff: 0.5,
      })
    })
    el.querySelectorAll<HTMLInputElement>('input[name="fx-tone"]').forEach((r) => {
      r.addEventListener('change', () => {
        onChange()
        render()
      })
    })
    for (const id of ['fx-brightness', 'fx-contrast', 'fx-saturation', 'fx-cutoff']) {
      el.querySelector(`#${id}`)?.addEventListener('input', onChange)
    }
  }

  return store.subscribeKeys(
    ['hot', 'selectionIds', 'localeTick', 'uiEpoch', 'effectsOpen'],
    render,
  )
}

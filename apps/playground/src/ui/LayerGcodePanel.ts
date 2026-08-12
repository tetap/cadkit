import type { Editor, LayerFillStyle, LayerGcodeParams } from '@cadkit/editor'
import { isImageLayer, resolveLayerGcode } from '@cadkit/editor'
import type { LayerId } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { t } from '../i18n/index.js'
import { fieldControl, fieldLabel, hint, sectionCard, sectionTitle } from './tokens.js'

const FILL_STYLES: Array<{ value: LayerFillStyle; labelKey: 'fillBidirectional' | 'fillCrossHatch' }> = [
  { value: 'bidirectional', labelKey: 'fillBidirectional' },
  { value: 'crossHatch', labelKey: 'fillCrossHatch' },
]

/**
 * Right-sidebar form for per-layer engraver mode + GRBL params.
 * Image layers are separate (no line/fill coupling).
 */
export function mountLayerGcodePanel(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  const targetLayerId = (): LayerId | null =>
    store.get().inspectedLayerId ?? editor.getActiveLayerId() ?? null

  const render = () => {
    const inspectedLayerId = targetLayerId()
    if (!inspectedLayerId) {
      el.innerHTML = `
        <div class="flex h-full flex-col justify-center px-4 py-8">
          <p class="${hint} text-center">${t('layerGcodeEmpty')}</p>
        </div>`
      return
    }

    const layer = editor.document.getLayer(inspectedLayerId)
    if (!layer) {
      el.innerHTML = `
        <div class="flex h-full flex-col justify-center px-4 py-8">
          <p class="${hint} text-center">${t('layerGcodeEmpty')}</p>
        </div>`
      return
    }

    const g = resolveLayerGcode(layer)
    const imageLayer = isImageLayer(layer)
    const isFill = g.mode === 'fill'

    if (imageLayer) {
      el.innerHTML = `
        <div class="px-3 py-3">
          <div class="${sectionCard}">
            <h3 class="${sectionTitle}">${t('layerGcode')}</h3>
            <p class="${hint} mb-3">${escapeHtml(layer.name)}</p>
            <div class="rounded-md border border-neutral-300 bg-soft/60 px-3 py-2.5 text-xs text-ink mb-3">
              <div class="font-medium">${t('engraveImage')}</div>
              <p class="${hint} mt-1.5">${t('engraveImageHint')}</p>
            </div>
            <label class="${fieldLabel} flex-col !items-stretch gap-1 mb-3">
              ${t('lineSpacing')}
              <div class="flex items-center gap-2">
                <input type="number" id="lg-spacing" class="${fieldControl} w-full" min="0.01" step="0.01" value="${g.lineSpacing}" />
                <span class="shrink-0 text-[10px] text-muted">mm</span>
              </div>
              <span class="${hint} mt-1">${t('imageScanHint')}</span>
            </label>
          </div>

          <div class="${sectionCard}">
            <h3 class="${sectionTitle}">${t('machineParams')}</h3>
            <label class="${fieldLabel} mb-3 flex-col !items-stretch gap-1">
              ${t('laserPower')}
              <input type="number" id="lg-power" class="${fieldControl} w-full" step="1" value="${g.power}" />
            </label>
            <label class="${fieldLabel} mb-3 flex-col !items-stretch gap-1">
              ${t('feedSpeed')}
              <div class="flex items-center gap-2">
                <input type="number" id="lg-speed" class="${fieldControl} w-full" min="1" step="10" value="${g.speed}" />
                <span class="shrink-0 text-[10px] text-muted">mm/min</span>
              </div>
            </label>
            <label class="${fieldLabel} flex-col !items-stretch gap-1">
              ${t('passes')}
              <input type="number" id="lg-passes" class="${fieldControl} w-full" min="1" step="1" value="${g.passes}" />
            </label>
          </div>
        </div>`

      const patchImageGcode = (partial: Partial<LayerGcodeParams>) => {
        const current = resolveLayerGcode(editor.document.getLayer(inspectedLayerId))
        editor.updateLayer(inspectedLayerId, {
          gcode: { ...current, mode: 'image', ...partial },
        })
        store.set({ layerEpoch: store.get().layerEpoch + 1 })
      }
      el.querySelector('#lg-spacing')?.addEventListener('change', (ev) => {
        const v = Number((ev.target as HTMLInputElement).value)
        if (Number.isFinite(v) && v > 0) patchImageGcode({ lineSpacing: v })
      })
      el.querySelector('#lg-power')?.addEventListener('change', (ev) => {
        const v = Number((ev.target as HTMLInputElement).value)
        if (Number.isFinite(v)) patchImageGcode({ power: v })
      })
      el.querySelector('#lg-speed')?.addEventListener('change', (ev) => {
        const v = Number((ev.target as HTMLInputElement).value)
        if (Number.isFinite(v) && v > 0) patchImageGcode({ speed: v })
      })
      el.querySelector('#lg-passes')?.addEventListener('change', (ev) => {
        const v = Number((ev.target as HTMLInputElement).value)
        if (Number.isFinite(v) && v >= 1) patchImageGcode({ passes: Math.round(v) })
      })
      return
    }

    el.innerHTML = `
      <div class="px-3 py-3">
        <div class="${sectionCard}">
          <h3 class="${sectionTitle}">${t('layerGcode')}</h3>
          <p class="${hint} mb-3">${escapeHtml(layer.name)}</p>

          <div class="mb-3">
            <div class="${fieldLabel} mb-1.5">${t('engraveMode')}</div>
            <div class="grid grid-cols-2 gap-1.5">
              <label class="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs ${
                g.mode === 'line'
                  ? 'border-brand-dark bg-brand/15 font-medium text-brand-dark'
                  : 'border-neutral-300 bg-white text-ink hover:bg-soft'
              }">
                <input type="radio" name="lg-mode" value="line" class="sr-only" ${g.mode === 'line' ? 'checked' : ''} />
                ${t('engraveLine')}
              </label>
              <label class="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs ${
                g.mode === 'fill'
                  ? 'border-brand-dark bg-brand/15 font-medium text-brand-dark'
                  : 'border-neutral-300 bg-white text-ink hover:bg-soft'
              }">
                <input type="radio" name="lg-mode" value="fill" class="sr-only" ${g.mode === 'fill' ? 'checked' : ''} />
                ${t('engraveFill')}
              </label>
            </div>
          </div>

          <div id="lg-fill-fields" class="${isFill ? 'space-y-3' : 'hidden'}">
            <label class="${fieldLabel} flex-col !items-stretch gap-1">
              ${t('lineSpacing')}
              <div class="flex items-center gap-2">
                <input type="number" id="lg-spacing" class="${fieldControl} w-full" min="0.01" step="0.01" value="${g.lineSpacing}" />
                <span class="shrink-0 text-[10px] text-muted">mm</span>
              </div>
            </label>
            <label class="${fieldLabel} flex-col !items-stretch gap-1">
              ${t('fillStyle')}
              <select id="lg-fill-style" class="${fieldControl} w-full">
                ${FILL_STYLES.map(
                  (s) =>
                    `<option value="${s.value}" ${g.fillStyle === s.value ? 'selected' : ''}>${t(s.labelKey)}</option>`,
                ).join('')}
              </select>
            </label>
            <label class="${fieldLabel} flex-col !items-stretch gap-1">
              ${t('fillAngle')}
              <div class="flex items-center gap-2">
                <input type="number" id="lg-fill-angle" class="${fieldControl} w-full" min="0" max="179.9" step="1" value="${fmtAngle(g.fillAngle)}" />
                <span class="shrink-0 text-[10px] text-muted">°</span>
              </div>
              <span class="${hint} mt-1">${t('fillAngleHint')}</span>
            </label>
          </div>
        </div>

        <div class="${sectionCard}">
          <h3 class="${sectionTitle}">${t('machineParams')}</h3>
          <label class="${fieldLabel} mb-3 flex-col !items-stretch gap-1">
            ${t('laserPower')}
            <input type="number" id="lg-power" class="${fieldControl} w-full" step="1" value="${g.power}" />
          </label>
          <label class="${fieldLabel} mb-3 flex-col !items-stretch gap-1">
            ${t('feedSpeed')}
            <div class="flex items-center gap-2">
              <input type="number" id="lg-speed" class="${fieldControl} w-full" min="1" step="10" value="${g.speed}" />
              <span class="shrink-0 text-[10px] text-muted">mm/min</span>
            </div>
          </label>
          <label class="${fieldLabel} flex-col !items-stretch gap-1">
            ${t('passes')}
            <input type="number" id="lg-passes" class="${fieldControl} w-full" min="1" step="1" value="${g.passes}" />
          </label>
        </div>

        <p class="${hint}">${t('layerGcodeHint')}</p>
      </div>
    `

    const patchGcode = (partial: Partial<LayerGcodeParams>) => {
      const current = resolveLayerGcode(editor.document.getLayer(inspectedLayerId))
      if (current.mode === 'image') return
      editor.updateLayer(inspectedLayerId, { gcode: { ...current, ...partial } })
      store.set({ layerEpoch: store.get().layerEpoch + 1 })
    }

    el.querySelectorAll<HTMLInputElement>('input[name="lg-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return
        patchGcode({ mode: input.value === 'fill' ? 'fill' : 'line' })
      })
    })
    el.querySelector('#lg-spacing')?.addEventListener('change', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value)
      if (Number.isFinite(v) && v > 0) patchGcode({ lineSpacing: v })
    })
    el.querySelector('#lg-fill-style')?.addEventListener('change', (ev) => {
      const v = (ev.target as HTMLSelectElement).value as LayerFillStyle
      patchGcode({ fillStyle: v })
    })
    el.querySelector('#lg-fill-angle')?.addEventListener('change', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value)
      if (Number.isFinite(v)) patchGcode({ fillAngle: v })
    })
    el.querySelector('#lg-power')?.addEventListener('change', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value)
      if (Number.isFinite(v)) patchGcode({ power: v })
    })
    el.querySelector('#lg-speed')?.addEventListener('change', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value)
      if (Number.isFinite(v) && v > 0) patchGcode({ speed: v })
    })
    el.querySelector('#lg-passes')?.addEventListener('change', (ev) => {
      const v = Number((ev.target as HTMLInputElement).value)
      if (Number.isFinite(v) && v >= 1) patchGcode({ passes: Math.round(v) })
    })
  }

  return store.subscribeKeys(['inspectedLayerId', 'layerEpoch', 'localeTick'], render)
}

function fmtAngle(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 10) / 10
  return String(r)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export type { LayerId }

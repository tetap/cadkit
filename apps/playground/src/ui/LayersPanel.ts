import type { Editor, Layer } from '@cadkit/editor'
import type { LayerId } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { refreshHotFromSelection } from '../bindEditorEvents.js'
import { t } from '../i18n/index.js'
import { btnGhost, fieldControl, hint } from './tokens.js'

function toColorInput(value: string | undefined): string {
  if (!value) return '#32cd79'
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7)
  return '#32cd79'
}

export function mountLayersPanel(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  const render = () => {
    const layers = editor.getLayers()
    const active = editor.getActiveLayerId()
    const selCount = store.get().selectionIds.length

    el.innerHTML = `
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="font-display text-sm font-semibold text-ink">${t('layers')}</h3>
        <button type="button" id="ly-add" class="${btnGhost} !h-7 !px-2" title="${t('layerAdd')}">+</button>
      </div>
      <p class="${hint} mb-3">${t('layersHint')}</p>
      <ul class="space-y-1" role="listbox" aria-label="${t('layers')}">
        ${layers
          .map((layer) => rowHtml(layer, layer.id === active, layers.length > 1))
          .join('')}
      </ul>
      <button
        type="button"
        id="ly-move"
        class="${btnGhost} mt-3 w-full"
        ${selCount === 0 ? 'disabled' : ''}
      >${t('layerMoveSelection')}</button>
    `

    el.querySelector('#ly-add')?.addEventListener('click', () => {
      editor.addLayer({ name: `${t('layer')} ${editor.getLayers().length}` })
      store.set({ layerEpoch: store.get().layerEpoch + 1 })
    })

    el.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((row) => {
      const id = row.dataset.layerId as LayerId
      row.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('[data-stop]')) return
        editor.setActiveLayer(id)
        store.set({ layerEpoch: store.get().layerEpoch + 1 })
      })
      row.querySelector<HTMLInputElement>('[data-color]')?.addEventListener('input', (ev) => {
        ev.stopPropagation()
        editor.updateLayer(id, { color: (ev.target as HTMLInputElement).value })
        store.set({ layerEpoch: store.get().layerEpoch + 1 })
        refreshHotFromSelection(editor, store)
      })
      row.querySelector<HTMLInputElement>('[data-vis]')?.addEventListener('change', (ev) => {
        ev.stopPropagation()
        editor.updateLayer(id, { visible: (ev.target as HTMLInputElement).checked })
        store.set({ layerEpoch: store.get().layerEpoch + 1 })
      })
      row.querySelector<HTMLInputElement>('[data-name]')?.addEventListener('change', (ev) => {
        ev.stopPropagation()
        editor.updateLayer(id, { name: (ev.target as HTMLInputElement).value })
        store.set({ layerEpoch: store.get().layerEpoch + 1 })
      })
      row.querySelector('[data-del]')?.addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (editor.getLayers().length <= 1) return
        editor.removeLayer(id)
        store.set({ layerEpoch: store.get().layerEpoch + 1 })
      })
    })

    el.querySelector('#ly-move')?.addEventListener('click', () => {
      editor.moveSelectionToLayer(editor.getActiveLayerId())
      refreshHotFromSelection(editor, store)
      store.set({ layerEpoch: store.get().layerEpoch + 1 })
    })
  }

  return store.subscribeKeys(['localeTick', 'layerEpoch', 'selectionIds'], render)
}

function rowHtml(layer: Layer, active: boolean, canDelete: boolean): string {
  return `
    <li
      data-layer-id="${layer.id}"
      role="option"
      aria-selected="${active}"
      class="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition ${
        active
          ? 'border-brand-dark bg-brand/10'
          : 'border-transparent hover:border-line hover:bg-soft'
      }"
    >
      <label data-stop class="grid place-items-center" title="${t('layerVisible')}">
        <input type="checkbox" data-vis class="h-3.5 w-3.5" ${layer.visible ? 'checked' : ''} />
      </label>
      <input
        data-stop
        data-color
        type="color"
        class="h-6 w-7 cursor-pointer rounded border border-neutral-300 bg-white p-0.5"
        value="${toColorInput(layer.color)}"
        title="${t('layerColor')}"
      />
      <input
        data-stop
        data-name
        type="text"
        class="${fieldControl} h-7 flex-1 !text-xs"
        value="${escapeAttr(layer.name)}"
      />
      ${
        active
          ? `<span class="shrink-0 text-[10px] font-medium text-brand-dark">${t('layerActive')}</span>`
          : ''
      }
      <button
        type="button"
        data-stop
        data-del
        class="grid h-6 w-6 place-items-center rounded text-muted hover:bg-white hover:text-ink disabled:opacity-30"
        title="${t('layerDelete')}"
        ${canDelete ? '' : 'disabled'}
      >×</button>
    </li>
  `
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

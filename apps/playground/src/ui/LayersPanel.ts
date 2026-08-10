import type { Editor, Layer } from '@cadkit/editor'
import type { Entity, EntityId, LayerId, TextEntity } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { refreshHotFromSelection } from '../bindEditorEvents.js'
import { t, type MessageKey } from '../i18n/index.js'
import { btnGhost, fieldControl } from './tokens.js'

function toColorInput(value: string | undefined): string {
  if (!value) return '#32cd79'
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7)
  return '#32cd79'
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

const TYPE_LABEL: Partial<Record<Entity['type'], MessageKey>> = {
  line: 'toolLine',
  polyline: 'toolPolyline',
  ellipse: 'toolEllipse',
  circle: 'toolCircle',
  text: 'toolText',
  image: 'toolImage',
  group: 'group',
  bezier: 'toolPen',
  arc: 'toolCircle',
}

function entityLabel(e: Entity): string {
  if (e.type === 'text') {
    const te = e as TextEntity
    const flat = te.content.replace(/\s+/gu, ' ').trim()
    if (flat) return flat.length > 18 ? `${flat.slice(0, 17)}…` : flat
  }
  const key = TYPE_LABEL[e.type]
  return key ? t(key) : e.type
}

function entitiesByLayer(editor: Editor): Map<LayerId, Entity[]> {
  const map = new Map<LayerId, Entity[]>()
  for (const layer of editor.getLayers()) map.set(layer.id, [])
  for (const e of editor.document.getEntities()) {
    // Nested group children still appear under their own layerId.
    const list = map.get(e.layerId)
    if (list) list.push(e)
    else map.set(e.layerId, [e])
  }
  return map
}

/** Full-height left floating dock: layers + canvas entities, synced with selection. */
export function mountLayersPanel(el: HTMLElement, editor: Editor, store: AppStore): () => void {
  const render = () => {
    const { layersOpen, selectionIds } = store.get()
    if (!layersOpen) {
      el.classList.add('hidden')
      el.classList.remove('pointer-events-none')
      el.innerHTML = ''
      el.setAttribute('aria-hidden', 'true')
      return
    }

    el.classList.remove('hidden')
    el.setAttribute('aria-hidden', 'false')

    const layers = editor.getLayers()
    const active = editor.getActiveLayerId()
    const selected = new Set(selectionIds)
    const byLayer = entitiesByLayer(editor)
    const selCount = selectionIds.length

    el.innerHTML = `
      <div class="pointer-events-auto flex h-full flex-col border-r border-neutral-200/90 bg-white/95 shadow-[4px_0_24px_rgba(15,23,42,0.08)] backdrop-blur">
        <header class="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <h3 class="font-display text-sm font-semibold text-ink">${t('layers')}</h3>
          <div class="flex items-center gap-1">
            <button type="button" id="ly-add" class="${btnGhost} !h-7 !px-2" title="${t('layerAdd')}">+</button>
            <button type="button" id="ly-close" class="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-soft" aria-label="${t('cancel')}">×</button>
          </div>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <ul class="space-y-1" role="tree" aria-label="${t('layers')}">
            ${layers
              .map((layer) =>
                layerBlock(
                  layer,
                  layer.id === active,
                  layers.length > 1,
                  byLayer.get(layer.id) ?? [],
                  selected,
                ),
              )
              .join('')}
          </ul>
        </div>
        <footer class="shrink-0 border-t border-line p-2">
          <button
            type="button"
            id="ly-move"
            class="${btnGhost} w-full"
            ${selCount === 0 ? 'disabled' : ''}
          >${t('layerMoveSelection')}</button>
        </footer>
      </div>
    `

    el.querySelector('#ly-close')?.addEventListener('click', () => {
      store.set({ layersOpen: false })
    })
    el.querySelector('#ly-add')?.addEventListener('click', () => {
      editor.addLayer({ name: `${t('layer')} ${editor.getLayers().length}` })
      store.set({ layerEpoch: store.get().layerEpoch + 1 })
    })
    el.querySelector('#ly-move')?.addEventListener('click', () => {
      editor.moveSelectionToLayer(editor.getActiveLayerId())
      refreshHotFromSelection(editor, store)
      store.set({ layerEpoch: store.get().layerEpoch + 1 })
    })

    el.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((row) => {
      const id = row.dataset.layerId as LayerId
      row.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).closest('[data-stop]')) return
        editor.setActiveLayer(id)
        store.set({ layerEpoch: store.get().layerEpoch + 1 })
      })
      row.addEventListener('dblclick', (ev) => {
        if ((ev.target as HTMLElement).closest('[data-stop]')) return
        const ids = (byLayer.get(id) ?? []).map((e) => e.id)
        if (ids.length) editor.select(ids)
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

    el.querySelectorAll<HTMLElement>('[data-entity-id]').forEach((row) => {
      row.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const id = row.dataset.entityId as EntityId
        if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
          const next = new Set(store.get().selectionIds)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          editor.select([...next])
        } else {
          editor.select([id])
        }
      })
    })
  }

  return store.subscribeKeys(
    ['localeTick', 'layerEpoch', 'selectionIds', 'layersOpen', 'uiEpoch', 'canUndo', 'canRedo'],
    render,
  )
}

function layerBlock(
  layer: Layer,
  active: boolean,
  canDelete: boolean,
  entities: Entity[],
  selected: Set<EntityId>,
): string {
  return `
    <li class="rounded-lg ${active ? 'bg-brand/5 ring-1 ring-brand/30' : ''}" role="treeitem" aria-expanded="true">
      <div
        data-layer-id="${layer.id}"
        class="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-xs transition hover:bg-soft"
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
          class="${fieldControl} h-7 min-w-0 flex-1 !text-xs"
          value="${escapeAttr(layer.name)}"
        />
        <span class="shrink-0 tabular-nums text-[10px] text-muted">${entities.length}</span>
        <button
          type="button"
          data-stop
          data-del
          class="grid h-6 w-6 place-items-center rounded text-muted hover:bg-white hover:text-ink disabled:opacity-30"
          title="${t('layerDelete')}"
          ${canDelete ? '' : 'disabled'}
        >×</button>
      </div>
      ${
        entities.length
          ? `<ul class="mb-1 ml-3 space-y-0.5 border-l border-line pl-2" role="group">
              ${entities.map((e) => entityRow(e, selected.has(e.id))).join('')}
            </ul>`
          : ''
      }
    </li>
  `
}

function entityRow(e: Entity, isSelected: boolean): string {
  const swatch = e.style.stroke || e.style.fill || '#94a3b8'
  return `
    <li>
      <button
        type="button"
        data-entity-id="${e.id}"
        class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition ${
          isSelected
            ? 'bg-brand/15 font-medium text-brand-dark'
            : 'text-ink hover:bg-soft'
        }"
      >
        <span class="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10" style="background:${escapeAttr(toColorInput(swatch))}"></span>
        <span class="min-w-0 flex-1 truncate">${escapeAttr(entityLabel(e))}</span>
      </button>
    </li>
  `
}

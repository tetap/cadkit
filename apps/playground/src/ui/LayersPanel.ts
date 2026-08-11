import type { Editor, Layer } from '@cadkit/editor'
import type { Entity, EntityId, LayerId, TextEntity } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { refreshHotFromSelection } from '../bindEditorEvents.js'
import { t, type MessageKey } from '../i18n/index.js'
import { btnGhost, fieldControl } from './tokens.js'

const MIME_LAYER = 'application/x-cadkit-layer'
const MIME_ENTITIES = 'application/x-cadkit-entities'

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

function clearDropHints(root: HTMLElement): void {
  root.querySelectorAll('.ly-drop-over').forEach((n) => n.classList.remove('ly-drop-over'))
  root.querySelectorAll('.ly-drop-before').forEach((n) => n.classList.remove('ly-drop-before'))
  root.querySelectorAll('.ly-drop-after').forEach((n) => n.classList.remove('ly-drop-after'))
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
        <p class="shrink-0 px-3 pb-1 text-[10px] leading-snug text-muted">${t('layersHint')}</p>
        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <ul class="space-y-1" role="tree" aria-label="${t('layers')}" id="ly-list">
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
      <style>
        .ly-drop-over { outline: 2px solid rgba(37, 99, 235, 0.55); outline-offset: -2px; background: rgba(37, 99, 235, 0.06); }
        .ly-drop-before { box-shadow: inset 0 2px 0 0 #2563eb; }
        .ly-drop-after { box-shadow: inset 0 -2px 0 0 #2563eb; }
        [data-layer-drag]:active { cursor: grabbing; }
      </style>
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

    bindLayerRows(el, editor, store, byLayer)
    bindEntityRows(el, editor, store)
  }

  return store.subscribeKeys(
    ['localeTick', 'layerEpoch', 'selectionIds', 'layersOpen', 'uiEpoch', 'canUndo', 'canRedo'],
    render,
  )
}

function bindLayerRows(
  el: HTMLElement,
  editor: Editor,
  store: AppStore,
  byLayer: Map<LayerId, Entity[]>,
): void {
  el.querySelectorAll<HTMLElement>('[data-layer-id]').forEach((row) => {
    const id = row.dataset.layerId as LayerId
    const block = row.closest('li')

    row.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('[data-stop]')) return
      editor.setActiveLayer(id)
      store.set({
        inspectedLayerId: id,
        layerEpoch: store.get().layerEpoch + 1,
      })
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
      const patch: { layerEpoch: number; inspectedLayerId?: LayerId | null } = {
        layerEpoch: store.get().layerEpoch + 1,
      }
      if (store.get().inspectedLayerId === id) patch.inspectedLayerId = null
      store.set(patch)
    })

    // —— Drag layer to reorder ————————————————————————————————————————————
    const handle = row.querySelector<HTMLElement>('[data-layer-drag]')
    if (handle) {
      handle.addEventListener('dragstart', (ev) => {
        ev.dataTransfer?.setData(MIME_LAYER, id)
        ev.dataTransfer!.effectAllowed = 'move'
        row.classList.add('opacity-50')
      })
      handle.addEventListener('dragend', () => {
        row.classList.remove('opacity-50')
        clearDropHints(el)
      })
    }

    // —— Drop target: reorder layer OR accept entities ————————————————————
    const onDragOver = (ev: DragEvent) => {
      const types = ev.dataTransfer?.types
      if (!types) return
      const isLayer = [...types].includes(MIME_LAYER)
      const isEntity = [...types].includes(MIME_ENTITIES)
      if (!isLayer && !isEntity) return
      ev.preventDefault()
      ev.dataTransfer!.dropEffect = 'move'
      clearDropHints(el)
      if (isLayer && block) {
        const rect = block.getBoundingClientRect()
        const before = ev.clientY < rect.top + rect.height / 2
        block.classList.add(before ? 'ly-drop-before' : 'ly-drop-after')
      } else {
        row.classList.add('ly-drop-over')
      }
    }
    row.addEventListener('dragover', onDragOver)
    block?.addEventListener('dragover', onDragOver)

    const onDragLeave = (ev: DragEvent) => {
      const related = ev.relatedTarget as Node | null
      if (related && (row.contains(related) || block?.contains(related))) return
      block?.classList.remove('ly-drop-before', 'ly-drop-after')
      row.classList.remove('ly-drop-over')
    }
    row.addEventListener('dragleave', onDragLeave)
    block?.addEventListener('dragleave', onDragLeave)

    const onDrop = (ev: DragEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      clearDropHints(el)
      const layerId = ev.dataTransfer?.getData(MIME_LAYER)
      const entityRaw = ev.dataTransfer?.getData(MIME_ENTITIES)
      if (layerId) {
        const order = editor.getLayers().map((l) => l.id)
        const from = order.indexOf(layerId as LayerId)
        const to = order.indexOf(id)
        if (from < 0 || to < 0 || from === to) return
        const rect = (block ?? row).getBoundingClientRect()
        const before = ev.clientY < rect.top + rect.height / 2
        order.splice(from, 1)
        let insertAt = order.indexOf(id)
        if (insertAt < 0) insertAt = order.length
        if (!before) insertAt += 1
        order.splice(insertAt, 0, layerId as LayerId)
        editor.reorderLayers(order)
        store.set({ layerEpoch: store.get().layerEpoch + 1 })
        return
      }
      if (entityRaw) {
        let ids: EntityId[] = []
        try {
          ids = JSON.parse(entityRaw) as EntityId[]
        } catch {
          return
        }
        if (!ids.length) return
        editor.moveEntitiesToLayer(ids, id)
        editor.setActiveLayer(id)
        refreshHotFromSelection(editor, store)
        store.set({
          inspectedLayerId: id,
          layerEpoch: store.get().layerEpoch + 1,
        })
      }
    }
    row.addEventListener('drop', onDrop)
    block?.addEventListener('drop', onDrop)
  })
}

function bindEntityRows(el: HTMLElement, editor: Editor, store: AppStore): void {
  el.querySelectorAll<HTMLElement>('[data-entity-id]').forEach((row) => {
    const id = row.dataset.entityId as EntityId
    row.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
        const next = new Set(store.get().selectionIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        editor.select([...next])
      } else {
        editor.select([id])
      }
    })
    row.addEventListener('dragstart', (ev) => {
      const selected = store.get().selectionIds
      const ids = selected.includes(id) && selected.length > 0 ? selected : [id]
      if (!selected.includes(id)) editor.select([id])
      ev.dataTransfer?.setData(MIME_ENTITIES, JSON.stringify(ids))
      ev.dataTransfer!.effectAllowed = 'move'
      row.classList.add('opacity-50')
    })
    row.addEventListener('dragend', () => {
      row.classList.remove('opacity-50')
      clearDropHints(el)
    })
  })
}

function layerBlock(
  layer: Layer,
  active: boolean,
  canDelete: boolean,
  entities: Entity[],
  selected: Set<EntityId>,
): string {
  return `
    <li class="rounded-lg ${active ? 'bg-brand/5 ring-1 ring-brand/30' : ''}" role="treeitem" aria-expanded="true" data-layer-block="${layer.id}">
      <div
        data-layer-id="${layer.id}"
        class="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 text-xs transition hover:bg-soft"
      >
        <span
          data-layer-drag
          draggable="true"
          data-stop
          class="grid h-6 w-4 shrink-0 cursor-grab place-items-center text-muted hover:text-ink"
          title="${t('layerReorder')}"
          aria-label="${t('layerReorder')}"
        >⋮⋮</span>
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
        draggable="true"
        data-entity-id="${e.id}"
        class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition ${
          isSelected
            ? 'bg-brand/15 font-medium text-brand-dark'
            : 'text-ink hover:bg-soft'
        }"
        title="${t('layerDropHint')}"
      >
        <span class="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10" style="background:${escapeAttr(toColorInput(swatch))}"></span>
        <span class="min-w-0 flex-1 truncate">${escapeAttr(entityLabel(e))}</span>
      </button>
    </li>
  `
}

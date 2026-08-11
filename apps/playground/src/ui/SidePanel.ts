import type { Editor } from '@cadkit/editor'
import type { AppState, AppStore, SideTab } from '../app/store.js'
import { t } from '../i18n/index.js'
import { mountEffectsPanel } from './EffectsPanel.js'
import { mountInspectorPanel } from './InspectorPanel.js'
import { mountLayerGcodePanel } from './LayerGcodePanel.js'

/**
 * Right sidebar: Inspector / Effects tabs, plus Layer G-code when a layer is inspected.
 */
export function mountSidePanel(
  tabsEl: HTMLElement,
  inspectorEl: HTMLElement,
  effectsEl: HTMLElement,
  gcodeEl: HTMLElement,
  editor: Editor,
  store: AppStore,
): () => void {
  const unsubInspector = mountInspectorPanel(inspectorEl, editor, store)
  const unsubEffects = mountEffectsPanel(effectsEl, editor, store)
  const unsubGcode = mountLayerGcodePanel(gcodeEl, editor, store)

  const renderTabs = () => {
    const { sideTab, inspectedLayerId } = store.get()
    const showGcode = inspectedLayerId != null
    const tabClass = (active: boolean) =>
      `flex-1 rounded-t-md px-2 py-2 text-center text-xs font-medium transition ${
        active
          ? 'bg-soft text-ink'
          : 'text-muted hover:bg-soft/60 hover:text-ink'
      }`

    tabsEl.innerHTML = `
      <button type="button" data-tab="inspector" class="${tabClass(!showGcode && sideTab === 'inspector')}">${t('inspector')}</button>
      <button type="button" data-tab="effects" class="${tabClass(!showGcode && sideTab === 'effects')}">${t('effects')}</button>
      ${
        showGcode
          ? `<button type="button" data-tab="layer" class="${tabClass(true)}">${t('layerGcode')}</button>`
          : ''
      }`

    tabsEl.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab
        if (tab === 'layer') return
        if (tab === 'inspector' || tab === 'effects') {
          store.set({ sideTab: tab as SideTab, inspectedLayerId: null })
        }
      })
    })
  }

  const syncVisibility = () => {
    const { sideTab, inspectedLayerId } = store.get()
    const showGcode = inspectedLayerId != null
    inspectorEl.classList.toggle('hidden', showGcode || sideTab !== 'inspector')
    effectsEl.classList.toggle('hidden', showGcode || sideTab !== 'effects')
    gcodeEl.classList.toggle('hidden', !showGcode)
    renderTabs()
  }

  // Prefer Effects when a single image is selected; clear layer inspect on canvas picks.
  const unsubSelection = store.subscribeKeys(['selectionIds'], () => {
    const ids = store.get().selectionIds
    if (ids.length === 0) return
    const patch: Partial<AppState> = {}
    if (store.get().inspectedLayerId) patch.inspectedLayerId = null
    if (ids.length === 1) {
      const e = editor.document.getEntity(ids[0]!)
      if (e?.type === 'image') patch.sideTab = 'effects'
    }
    if (Object.keys(patch).length) store.set(patch)
  })

  const unsubUi = store.subscribeKeys(
    ['sideTab', 'inspectedLayerId', 'localeTick'],
    syncVisibility,
  )

  return () => {
    unsubInspector()
    unsubEffects()
    unsubGcode()
    unsubSelection()
    unsubUi()
  }
}

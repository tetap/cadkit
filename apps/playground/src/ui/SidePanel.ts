import type { Editor } from '@cadkit/editor'
import type { AppStore } from '../app/store.js'
import { mountLayerGcodePanel } from './LayerGcodePanel.js'

/**
 * Right sidebar: layer engraver mode (line/fill paint + G-code params).
 * Per-entity style editing lives in the context bar; image filters use a floating drawer.
 */
export function mountSidePanel(
  gcodeEl: HTMLElement,
  editor: Editor,
  store: AppStore,
): () => void {
  // Keep inspected layer in sync with the active layer / selection's layer.
  const unsubSel = store.subscribeKeys(['selectionIds', 'layerEpoch'], () => {
    const ids = store.get().selectionIds
    if (ids.length === 1) {
      const e = editor.document.getEntity(ids[0]!)
      if (e && store.get().inspectedLayerId !== e.layerId) {
        store.set({ inspectedLayerId: e.layerId })
      }
      return
    }
    const active = editor.getActiveLayerId()
    if (store.get().inspectedLayerId == null) {
      store.set({ inspectedLayerId: active })
    }
  })

  // Initial target = active layer.
  if (store.get().inspectedLayerId == null) {
    store.set({ inspectedLayerId: editor.getActiveLayerId() })
  }

  const unsubGcode = mountLayerGcodePanel(gcodeEl, editor, store)
  return () => {
    unsubSel()
    unsubGcode()
  }
}

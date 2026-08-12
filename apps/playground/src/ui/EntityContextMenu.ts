import type { Editor } from '@cadkit/editor'
import type { EntityId } from '@cadkit/types'
import type { AppStore } from '../app/store.js'
import { refreshHotFromSelection } from '../bindEditorEvents.js'
import { t } from '../i18n/index.js'

type StackAction = 'front' | 'forward' | 'backward' | 'back'

const ITEM_CLASS =
  'block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft disabled:opacity-40 disabled:hover:bg-transparent'

/**
 * Floating context menu for entity stack order (bring/send).
 * Open via canvas or layers-panel right-click.
 */
export function createEntityContextMenu(editor: Editor, store: AppStore): {
  openAt: (clientX: number, clientY: number, ids?: readonly EntityId[]) => void
  close: () => void
  dispose: () => void
} {
  const menu = document.createElement('div')
  menu.id = 'entity-context-menu'
  menu.className =
    'fixed z-50 hidden min-w-[10.5rem] overflow-hidden rounded-md border border-line bg-panel py-1 shadow-lg'
  menu.setAttribute('role', 'menu')
  document.body.appendChild(menu)

  let open = false

  const close = () => {
    if (!open) return
    open = false
    menu.classList.add('hidden')
    menu.innerHTML = ''
  }

  const run = (action: StackAction) => {
    close()
    let ok = false
    if (action === 'front') ok = editor.bringSelectionToFront()
    else if (action === 'forward') ok = editor.bringSelectionForward()
    else if (action === 'backward') ok = editor.sendSelectionBackward()
    else ok = editor.sendSelectionToBack()
    if (!ok) return
    refreshHotFromSelection(editor, store)
    store.set({
      layerEpoch: store.get().layerEpoch + 1,
      uiEpoch: store.get().uiEpoch + 1,
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
    })
  }

  const openAt = (clientX: number, clientY: number, ids?: readonly EntityId[]) => {
    const targets = ids?.length ? [...ids] : editor.selection.toArray()
    if (!targets.length) {
      close()
      return
    }
    if (ids?.length) {
      editor.select(targets)
      store.set({ selectionIds: targets })
      refreshHotFromSelection(editor, store)
    }

    menu.innerHTML = `
      <button type="button" role="menuitem" data-stack="front" class="${ITEM_CLASS}">${t('entityBringToFront')}</button>
      <button type="button" role="menuitem" data-stack="forward" class="${ITEM_CLASS}">${t('entityBringForward')}</button>
      <button type="button" role="menuitem" data-stack="backward" class="${ITEM_CLASS}">${t('entitySendBackward')}</button>
      <button type="button" role="menuitem" data-stack="back" class="${ITEM_CLASS}">${t('entitySendToBack')}</button>
    `
    menu.querySelectorAll<HTMLButtonElement>('[data-stack]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        run(btn.dataset.stack as StackAction)
      })
    })

    menu.classList.remove('hidden')
    open = true
    const pad = 8
    const rect = menu.getBoundingClientRect()
    let left = clientX
    let top = clientY
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad
    menu.style.left = `${Math.max(pad, left)}px`
    menu.style.top = `${Math.max(pad, top)}px`
  }

  const onPointerDown = (ev: PointerEvent) => {
    if (!open) return
    if (menu.contains(ev.target as Node)) return
    close()
  }
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close()
  }
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKey)

  return {
    openAt,
    close,
    dispose: () => {
      close()
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      menu.remove()
    },
  }
}

/** Bind canvas host right-click → entity stack menu. */
export function mountCanvasEntityContextMenu(
  host: HTMLElement,
  editor: Editor,
  store: AppStore,
  menu: ReturnType<typeof createEntityContextMenu>,
): () => void {
  const onContextMenu = (ev: MouseEvent) => {
    ev.preventDefault()
    const hit = editor.pickAtClient(ev.clientX, ev.clientY)
    if (!hit) {
      menu.close()
      return
    }
    const selected = store.get().selectionIds
    if (selected.includes(hit) && selected.length > 0) {
      menu.openAt(ev.clientX, ev.clientY, selected)
    } else {
      menu.openAt(ev.clientX, ev.clientY, [hit])
    }
  }
  host.addEventListener('contextmenu', onContextMenu)
  return () => host.removeEventListener('contextmenu', onContextMenu)
}

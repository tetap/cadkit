import type { Editor } from '@cadkit/editor'
import { t } from '../i18n/index.js'
import type { AppStore } from '../app/store.js'
import { placeImageAt } from '../bindEditorEvents.js'
import { clearDocument, seedDemoContent } from '../dev/seed.js'
import { pickFile } from '../pick-file.js'

export interface AppMenuHandlers {
  openDev: () => void
  openSettings: () => void
  /** Toggle GRBL toolpath preview overlay. */
  toggleGcodePreview?: () => void
}

/** @deprecated Use AppMenuHandlers */
export type AppBarHandlers = AppMenuHandlers

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const IMPORT_ACCEPT = [
  '.svg',
  'image/svg+xml',
  '.dxf',
  'application/dxf',
  '.nc',
  '.gcode',
  '.ngc',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/*',
].join(',')

async function importAnyFile(editor: Editor, store: AppStore, file: File): Promise<void> {
  const name = file.name.toLowerCase()
  store.set({ status: t('importing') })
  try {
    if (name.endsWith('.svg') || file.type === 'image/svg+xml') {
      await editor.import.svg(await file.text())
    } else if (name.endsWith('.dxf') || file.type.includes('dxf')) {
      await editor.import.dxf(file)
    } else if (/\.(nc|gcode|ngc)$/i.test(name)) {
      await editor.import.gcode(file)
    } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) {
      await placeImageAt(editor, file)
      editor.setTool('select')
    } else {
      store.set({ status: t('importFailed') })
      return
    }
    store.set({ status: t('ready') })
  } catch (err) {
    console.error(err)
    store.set({ status: t('importFailed') })
  }
}

/**
 * Wire an app menu (new / import / export / settings / dev) to a trigger button.
 * Menu opens to the right of the trigger (left tool-rail logo).
 */
export function bindAppMenu(
  trigger: HTMLButtonElement,
  editor: Editor,
  store: AppStore,
  handlers: AppMenuHandlers,
): () => void {
  let menuOpen = false
  const menu = document.createElement('div')
  menu.id = 'ab-app-menu'
  menu.className =
    'fixed z-40 hidden min-w-[11rem] overflow-hidden rounded-md border border-line bg-panel py-1 shadow-lg'
  menu.setAttribute('role', 'menu')
  document.body.appendChild(menu)

  const renderMenu = () => {
    menu.innerHTML = `
      <button type="button" role="menuitem" data-file="new" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('newProject')}</button>
      <button type="button" role="menuitem" data-file="import" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('importFile')}</button>
      <button type="button" role="menuitem" data-file="export-svg" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('exportSvg')}</button>
      <button type="button" role="menuitem" data-file="export-json" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('exportJson')}</button>
      <button type="button" role="menuitem" data-file="export-gcode" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('exportGcode')}</button>
      <button type="button" role="menuitem" data-file="preview-gcode" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('gcodePreview')}</button>
      <div class="my-1 border-t border-line" role="separator"></div>
      <button type="button" role="menuitem" data-file="settings" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('settings')}</button>
      <button type="button" role="menuitem" data-file="dev" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('devMenu')}</button>
    `
    menu.querySelectorAll<HTMLButtonElement>('[data-file]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.file
        closeMenu()
        if (action === 'new') {
          if (!confirm(t('confirmNew'))) return
          clearDocument(editor)
          seedDemoContent(editor)
          store.set({ status: t('ready'), selectionIds: [] })
          return
        }
        if (action === 'import') {
          const file = await pickFile(IMPORT_ACCEPT)
          if (!file) return
          await importAnyFile(editor, store, file)
          return
        }
        if (action === 'export-svg') {
          downloadText('cadkit.svg', editor.export.svg(), 'image/svg+xml')
          store.set({ status: t('exported') })
          return
        }
        if (action === 'export-json') {
          downloadText('cadkit.json', editor.export.json(), 'application/json')
          store.set({ status: t('exported') })
          return
        }
        if (action === 'export-gcode') {
          downloadText('cadkit.nc', editor.export.gcode(), 'text/plain')
          store.set({ status: t('exported') })
          return
        }
        if (action === 'preview-gcode') {
          handlers.toggleGcodePreview?.()
          return
        }
        if (action === 'settings') {
          handlers.openSettings()
          return
        }
        if (action === 'dev') {
          handlers.openDev()
        }
      })
    })
  }

  const positionMenu = () => {
    const r = trigger.getBoundingClientRect()
    menu.style.left = `${r.right + 8}px`
    menu.style.top = `${Math.max(8, r.top)}px`
  }

  const closeMenu = () => {
    menuOpen = false
    menu.classList.add('hidden')
    trigger.setAttribute('aria-expanded', 'false')
  }

  const openMenu = () => {
    renderMenu()
    positionMenu()
    menuOpen = true
    menu.classList.remove('hidden')
    trigger.setAttribute('aria-expanded', 'true')
  }

  const onTrigger = (ev: MouseEvent) => {
    ev.stopPropagation()
    if (menuOpen) closeMenu()
    else openMenu()
  }
  trigger.addEventListener('click', onTrigger)

  const onDocClick = (ev: MouseEvent) => {
    if (!menuOpen) return
    const target = ev.target as Node
    if (menu.contains(target) || trigger.contains(target)) return
    closeMenu()
  }
  document.addEventListener('click', onDocClick)

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && menuOpen) closeMenu()
  }
  document.addEventListener('keydown', onKey)

  const unsubLocale = store.subscribeKeys(['localeTick'], () => {
    if (menuOpen) renderMenu()
  })

  return () => {
    unsubLocale()
    trigger.removeEventListener('click', onTrigger)
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKey)
    menu.remove()
  }
}

export { importAnyFile, IMPORT_ACCEPT }

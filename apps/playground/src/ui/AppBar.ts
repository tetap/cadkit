import type { Editor } from '@cadkit/editor'
import { t } from '../i18n/index.js'
import type { AppStore } from '../app/store.js'
import { placeImageAt } from '../bindEditorEvents.js'
import { clearDocument, seedDemoContent } from '../dev/seed.js'
import { pickFile } from '../pick-file.js'
import { btnGhost } from './tokens.js'

export interface AppBarHandlers {
  openDev: () => void
  openSettings: () => void
}

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

export function mountAppBar(
  el: HTMLElement,
  editor: Editor,
  store: AppStore,
  handlers: AppBarHandlers,
): () => void {
  let menuOpen = false

  const closeMenu = () => {
    menuOpen = false
    const menu = el.querySelector('#ab-app-menu')
    menu?.classList.add('hidden')
    el.querySelector('#ab-logo')?.setAttribute('aria-expanded', 'false')
  }

  const render = () => {
    el.innerHTML = `
      <div class="relative flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          id="ab-logo"
          class="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[22%] shadow-sm outline-none ring-brand/40 transition hover:ring-2 focus-visible:ring-2"
          aria-haspopup="menu"
          aria-expanded="false"
          aria-label="${t('appMenu')}"
          title="${t('appMenu')}"
        >
          <img src="/logo.png" alt="" class="h-full w-full object-cover" draggable="false" />
        </button>
        <div
          id="ab-app-menu"
          class="absolute left-3 top-[calc(100%-0.25rem)] z-30 hidden min-w-[11rem] overflow-hidden rounded-md border border-line bg-panel py-1 shadow-lg"
          role="menu"
        >
          <button type="button" role="menuitem" data-file="new" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('newProject')}</button>
          <button type="button" role="menuitem" data-file="import" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('importFile')}</button>
          <button type="button" role="menuitem" data-file="export-json" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('exportJson')}</button>
          <div class="my-1 border-t border-line" role="separator"></div>
          <button type="button" role="menuitem" data-file="settings" class="block w-full px-3 py-2 text-left text-xs text-ink hover:bg-soft">${t('settings')}</button>
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-display text-sm font-semibold text-ink">${t('appTitle')}</div>
        </div>
        <button type="button" id="ab-dev" class="${btnGhost} !px-2" title="${t('devMenu')}">⋯</button>
      </div>
    `

    const logoBtn = el.querySelector<HTMLButtonElement>('#ab-logo')
    const appMenu = el.querySelector<HTMLElement>('#ab-app-menu')
    logoBtn?.addEventListener('click', (ev) => {
      ev.stopPropagation()
      menuOpen = !menuOpen
      appMenu?.classList.toggle('hidden', !menuOpen)
      logoBtn.setAttribute('aria-expanded', String(menuOpen))
    })

    el.querySelectorAll<HTMLButtonElement>('[data-file]').forEach((btn) => {
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
        if (action === 'export-json') {
          downloadText('cadkit.json', editor.export.json(), 'application/json')
          store.set({ status: t('exported') })
          return
        }
        if (action === 'settings') {
          handlers.openSettings()
        }
      })
    })

    el.querySelector('#ab-dev')?.addEventListener('click', () => {
      closeMenu()
      handlers.openDev()
    })
  }

  const onDocClick = (ev: MouseEvent) => {
    if (!menuOpen) return
    if (!el.contains(ev.target as Node)) closeMenu()
  }
  document.addEventListener('click', onDocClick)

  const unsub = store.subscribeKeys(['localeTick'], render)
  return () => {
    unsub()
    document.removeEventListener('click', onDocClick)
  }
}

export { importAnyFile, IMPORT_ACCEPT }

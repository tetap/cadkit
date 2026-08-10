import { createEditor } from '@cadkit/editor'
import { createAppStore } from './app/store.js'
import { bindEditorEvents } from './bindEditorEvents.js'
import { mountDevModal } from './dev/DevModal.js'
import { seedDemoContent } from './dev/seed.js'
import { getLocale, onLocaleChange, t } from './i18n/index.js'
import { mountAppBar } from './ui/AppBar.js'
import { mountContextBar } from './ui/ContextBar.js'
import { mountLayersPanel } from './ui/LayersPanel.js'
import { applyPersistedImportDpi, openSettingsDialog } from './ui/SettingsDialog.js'
import { mountStatusBar } from './ui/StatusBar.js'
import { mountToolRail } from './ui/ToolRail.js'
import { mountViewBar } from './ui/ViewBar.js'

const canvas = document.querySelector<HTMLCanvasElement>('#view')!
const canvasHost = document.querySelector<HTMLElement>('#canvas-host')!
const appBarEl = document.querySelector<HTMLElement>('#app-bar')!
const toolRailEl = document.querySelector<HTMLElement>('#tool-rail')!
const layersPanelEl = document.querySelector<HTMLElement>('#layers-panel')!
const contextBarEl = document.querySelector<HTMLElement>('#context-bar')!
const viewBarEl = document.querySelector<HTMLElement>('#view-bar')!
const statusBarEl = document.querySelector<HTMLElement>('#status-bar')!
const devModal = document.querySelector<HTMLElement>('#dev-modal')!
const devBody = document.querySelector<HTMLElement>('#dev-modal-body')!

async function boot(): Promise<void> {
  document.documentElement.lang = getLocale()
  document.title = t('appTitle')

  const store = createAppStore({ status: t('ready') })

  const editor = await createEditor({
    view: canvas,
    theme: 'light',
    document: { unit: 'mm', displayUnit: 'mm', tolerance: 1e-6, schemaVersion: 1 },
    guides: {
      rulers: true,
      grid: true,
      rulerSize: 24,
      workArea: { mode: 'page', width: 100, height: 100, originX: 0, originY: 0 },
    },
    performance: {
      profile: 'auto',
      memoryBudgetMB: 1024,
      lodNavigationPx: 0.75,
      lodStablePx: 0.35,
      textBudget: 2000,
      maxDirtyRects: 8,
      dirtyMergeAreaRatio: 0.6,
    },
  })

  applyPersistedImportDpi(editor)
  bindEditorEvents(editor, store, canvasHost)

  const dev = mountDevModal(devModal, devBody, editor, store)
  let closeSettings: (() => void) | null = null

  mountAppBar(appBarEl, editor, store, {
    openDev: () => dev.open(),
    openSettings: () => {
      closeSettings?.()
      closeSettings = openSettingsDialog(editor, store, () => {
        closeSettings = null
      })
    },
  })
  mountToolRail(toolRailEl, editor, store)
  mountLayersPanel(layersPanelEl, editor, store)
  mountContextBar(contextBarEl, editor, store)
  mountViewBar(viewBarEl, editor, store)
  mountStatusBar(statusBarEl, editor, store)

  seedDemoContent(editor)
  store.set({ status: t('ready') })

  const openDevFromHash = () => {
    const hash = location.hash.replace(/^#\/?/, '')
    if (hash === 'benchmark') dev.open('benchmark')
  }
  openDevFromHash()
  window.addEventListener('hashchange', openDevFromHash)

  onLocaleChange(() => {
    document.title = t('appTitle')
    store.set({ localeTick: store.get().localeTick + 1, status: t('ready') })
  })
}

boot().catch((err) => {
  console.error(err)
  const status = document.querySelector('#status-bar')
  if (status) status.textContent = String(err)
})

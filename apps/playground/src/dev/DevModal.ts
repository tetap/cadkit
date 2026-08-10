import type { Editor } from '@cadkit/editor'
import type { AppStore } from '../app/store.js'
import { renderSpikeReport, runSpike } from '../benchmark/spike.js'
import { t, type MessageKey } from '../i18n/index.js'
import { clearDocument, seedGrid, seedSquares } from './seed.js'

export function mountDevModal(
  modal: HTMLElement,
  body: HTMLElement,
  editor: Editor,
  store: AppStore,
): { open: (panel?: 'tools' | 'benchmark') => void; close: () => void } {
  let panel: 'tools' | 'benchmark' = 'tools'

  const close = () => {
    modal.hidden = true
  }

  const open = (next: 'tools' | 'benchmark' = 'tools') => {
    panel = next
    modal.hidden = false
    render()
  }

  const render = () => {
    if (panel === 'benchmark') {
      body.innerHTML = `
        <div class="mb-3 flex flex-wrap gap-2">
          <button type="button" id="dev-back" class="inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-medium hover:bg-soft">${t('devBack')}</button>
          <button type="button" id="dev-run-bench" class="inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-medium hover:bg-soft">${t('runBench')}</button>
        </div>
        <div id="dev-bench-report"><p class="text-xs text-muted">${t('benchIdle')}</p></div>`
      body.querySelector('#dev-back')?.addEventListener('click', () => {
        panel = 'tools'
        render()
      })
      body.querySelector('#dev-run-bench')?.addEventListener('click', async () => {
        const reportEl = body.querySelector('#dev-bench-report')!
        reportEl.innerHTML = `<p class="hint">${t('benchRunning')}</p>`
        store.set({ status: t('benchRunning') })
        const report = await runSpike()
        reportEl.innerHTML = renderSpikeReport(report, (key: string) => t(key as MessageKey))
        store.set({ status: `${t('benchDone')} · ABI ${report.abi.major}.${report.abi.minor}` })
        console.info('[cadkit-spike]', report)
      })
      return
    }

    const btn =
      'inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-medium hover:bg-soft'
    body.innerHTML = `
      <p class="mb-3 text-xs text-muted">${t('devHint')}</p>
      <div class="mb-3 flex flex-wrap gap-2">
        <button type="button" id="dev-million-lines" class="${btn}">${t('ex.million-lines.title')}</button>
        <button type="button" id="dev-million-squares" class="${btn}">${t('ex.million-squares.title')}</button>
        <button type="button" id="dev-benchmark" class="${btn}">${t('ex.benchmark.title')}</button>
        <button type="button" id="dev-seed-basic" class="${btn}">${t('ex.basic.title')}</button>
        <button type="button" id="dev-seed-groups" class="${btn}">${t('ex.groups.title')}</button>
        <button type="button" id="dev-seed-svg" class="${btn}">${t('ex.svg.title')}</button>
        <button type="button" id="dev-seed-dxf" class="${btn}">${t('ex.dxf.title')}</button>
        <button type="button" id="dev-large-coords" class="${btn}">${t('ex.large-coords.title')}</button>
      </div>
      <p class="text-xs text-muted">${t('devWarn')}</p>`

    body.querySelector('#dev-million-lines')?.addEventListener('click', async () => {
      close()
      store.set({ status: t('genLines') })
      clearDocument(editor)
      await new Promise((r) => setTimeout(r, 0))
      await seedGrid(editor, 1000, 0, true, (done, total) => {
        store.set({ status: `${t('genLines')} ${Math.round((done / total) * 100)}%` })
      })
      // Local viewport — fitting all 1M would stall the first frame build.
      editor.camera.setZoom(1)
      editor.camera.setCenter({ x: 500, y: 500, __space: 'world' })
      editor.requestRender()
      store.set({ status: `${t('ready')} · 1,000,000` })
    })

    body.querySelector('#dev-million-squares')?.addEventListener('click', async () => {
      close()
      store.set({ status: t('genSquares') })
      clearDocument(editor)
      await new Promise((r) => setTimeout(r, 0))
      await seedSquares(editor, 1_000_000, (done, total) => {
        store.set({ status: `${t('genSquares')} ${Math.round((done / total) * 100)}%` })
      })
      editor.camera.setZoom(1)
      editor.camera.setCenter({ x: 500, y: 500, __space: 'world' })
      editor.requestRender()
      store.set({ status: `${t('ready')} · 1,000,000` })
    })

    body.querySelector('#dev-benchmark')?.addEventListener('click', () => {
      panel = 'benchmark'
      render()
    })

    body.querySelector('#dev-seed-basic')?.addEventListener('click', async () => {
      clearDocument(editor)
      await seedGrid(editor, 12)
      editor.fitView()
      close()
    })

    body.querySelector('#dev-seed-groups')?.addEventListener('click', async () => {
      clearDocument(editor)
      const ids = await seedGrid(editor, 4)
      if (ids.length >= 4) editor.group(ids.slice(0, 4))
      editor.fitView()
      close()
    })

    body.querySelector('#dev-seed-svg')?.addEventListener('click', async () => {
      clearDocument(editor)
      const svg = `<svg xmlns="http://www.w3.org/2000/svg">
        <line x1="0" y1="0" x2="100" y2="40" stroke="#4ea1ff"/>
        <circle cx="50" cy="50" r="20" stroke="#32cd79" fill="none"/>
        <path d="M10 80 C40 40 70 120 100 80" stroke="#e67e22" fill="none"/>
        <text x="10" y="120" font-size="14" fill="#333">CADKit SVG</text>
      </svg>`
      await editor.import.svg(svg)
      close()
    })

    body.querySelector('#dev-seed-dxf')?.addEventListener('click', async () => {
      clearDocument(editor)
      const dxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
80
21
40
0
CIRCLE
10
40
20
20
40
15
0
ENDSEC
0
EOF
`
      await editor.import.dxf(dxf)
      close()
    })

    body.querySelector('#dev-large-coords')?.addEventListener('click', async () => {
      clearDocument(editor)
      await seedGrid(editor, 20, 1e8)
      editor.fitView()
      close()
    })
  }

  modal.querySelectorAll('[data-dev-close]').forEach((node) => {
    node.addEventListener('click', close)
  })

  window.addEventListener('keydown', (ev) => {
    if (!modal.hidden && ev.key === 'Escape') close()
  })

  return { open, close }
}

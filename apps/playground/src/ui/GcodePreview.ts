import type { Editor } from '@cadkit/editor'
import { samplePlanProgress, type GcodeToolpathPlan } from '@cadkit/io-gcode'
import type { AppStore } from '../app/store.js'
import { t } from '../i18n/index.js'

const BRAND = '#22c55e'
const REMAINING = '#9ca3af'

/**
 * Canvas overlay + scrubber for GRBL toolpath preview.
 * Opening preview rebuilds gcode toolpaths; progress paints done=brand / rest=gray.
 */
export function mountGcodePreview(
  host: HTMLElement,
  editor: Editor,
  store: AppStore,
): { open: () => void; close: () => void; toggle: () => void; isOpen: () => boolean } {
  const layer = document.createElement('div')
  layer.className = 'pointer-events-none absolute inset-0 z-[15]'
  layer.hidden = true

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'absolute inset-0 h-full w-full')
  svg.style.overflow = 'visible'

  const bar = document.createElement('div')
  bar.className =
    'pointer-events-auto absolute inset-x-0 bottom-16 z-[16] flex justify-center px-4'
  bar.hidden = true
  bar.innerHTML = `
    <div class="flex w-full max-w-xl items-center gap-3 rounded-2xl border border-line bg-panel/95 px-3 py-2 shadow-[0_8px_28px_rgba(15,23,42,0.14)] backdrop-blur">
      <button type="button" data-gcode-close class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink" aria-label="Close">×</button>
      <div class="min-w-0 flex-1">
        <div class="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span data-gcode-title class="font-medium text-ink">${t('gcodePreview')}</span>
          <span data-gcode-pct class="tabular-nums">0%</span>
        </div>
        <input data-gcode-range type="range" min="0" max="1000" value="0" step="1"
          class="h-2 w-full cursor-pointer appearance-none rounded-full bg-soft"
          style="accent-color:#22c55e" />
      </div>
    </div>
  `

  layer.appendChild(svg)
  host.appendChild(layer)
  host.appendChild(bar)

  let open = false
  let plan: GcodeToolpathPlan | null = null
  let progress = 0
  let rebuildTimer = 0

  const range = () => bar.querySelector<HTMLInputElement>('[data-gcode-range]')
  const pctEl = () => bar.querySelector<HTMLElement>('[data-gcode-pct]')
  const titleEl = () => bar.querySelector<HTMLElement>('[data-gcode-title]')

  const rebuild = () => {
    if (!open) return
    plan = editor.export.toolpaths({ flipY: true })
    const cuts = plan.cuts.length
    const len = plan.cutLength
    if (titleEl()) {
      titleEl()!.textContent = `${t('gcodePreview')} · ${cuts} ${t('gcodePaths')} · ${len.toFixed(1)} mm`
    }
    paint()
  }

  const scheduleRebuild = () => {
    if (!open) return
    window.clearTimeout(rebuildTimer)
    rebuildTimer = window.setTimeout(rebuild, 80)
  }

  const paint = () => {
    if (!open || !plan) {
      svg.replaceChildren()
      return
    }
    const cam = editor.camera
    const { viewportWidth: vw, viewportHeight: vh } = cam.getState()
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`)
    svg.setAttribute('width', String(vw))
    svg.setAttribute('height', String(vh))

    const { done, remaining } = samplePlanProgress(plan, progress)
    const frag = document.createDocumentFragment()

    const addPaths = (paths: { x: number; y: number }[][], color: string, width: number) => {
      for (const pts of paths) {
        if (pts.length < 2) continue
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        const d = pts
          .map((p, i) => {
            const s = cam.worldToScreen({ x: p.x, y: p.y, __space: 'world' })
            return `${i === 0 ? 'M' : 'L'}${s.x} ${s.y}`
          })
          .join(' ')
        el.setAttribute('d', d)
        el.setAttribute('fill', 'none')
        el.setAttribute('stroke', color)
        el.setAttribute('stroke-width', String(width))
        el.setAttribute('stroke-linecap', 'round')
        el.setAttribute('stroke-linejoin', 'round')
        el.setAttribute('vector-effect', 'non-scaling-stroke')
        frag.appendChild(el)
      }
    }

    addPaths(remaining, REMAINING, 1.5)
    addPaths(done, BRAND, 2)
    svg.replaceChildren(frag)
  }

  const setProgress = (t: number) => {
    progress = Math.max(0, Math.min(1, t))
    const r = range()
    if (r) r.value = String(Math.round(progress * 1000))
    if (pctEl()) pctEl()!.textContent = `${Math.round(progress * 100)}%`
    paint()
  }

  bar.querySelector('[data-gcode-close]')?.addEventListener('click', () => close())
  range()?.addEventListener('input', () => {
    const r = range()
    if (!r) return
    setProgress(Number(r.value) / 1000)
  })

  const onCamera = () => paint()
  let unsubCam: (() => void) | null = null
  let unsubStore: (() => void) | null = null

  const openPreview = () => {
    if (open) return
    open = true
    layer.hidden = false
    bar.hidden = false
    progress = 0
    setProgress(0)
    rebuild()
    unsubCam = editor.events.on('camera:change', onCamera)
    unsubStore = store.subscribeKeys(['uiEpoch', 'layerEpoch', 'canUndo', 'canRedo', 'localeTick'], () => {
      if (!open) return
      scheduleRebuild()
    })
    store.set({ status: t('gcodePreviewOn') })
  }

  const close = () => {
    if (!open) return
    open = false
    layer.hidden = true
    bar.hidden = true
    plan = null
    svg.replaceChildren()
    window.clearTimeout(rebuildTimer)
    unsubCam?.()
    unsubCam = null
    unsubStore?.()
    unsubStore = null
    store.set({ status: t('ready') })
  }

  return {
    open: openPreview,
    close,
    toggle: () => (open ? close() : openPreview()),
    isOpen: () => open,
  }
}

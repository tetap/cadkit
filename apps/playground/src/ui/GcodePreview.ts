import type { Editor } from '@cadkit/editor'
import { samplePlanProgress, type GcodeToolpathPlan } from '@cadkit/io-gcode'
import type { AppStore } from '../app/store.js'
import { t } from '../i18n/index.js'

const CUT_DONE = '#22c55e'
const CUT_REST = '#9ca3af'
const TRAVEL = '#f59e0b'
const GRID = '#e5e7eb'
const BG = '#f8fafc'

type Pt = { x: number; y: number }

/**
 * Modal G-code preview with its own canvas (independent of the editor WebGPU view).
 * Progress scrubber paints done=brand / rest=gray; travels are dashed amber.
 */
export function mountGcodePreview(
  editor: Editor,
  store: AppStore,
  opts?: { onOpenChange?: (open: boolean) => void },
): { open: () => void; close: () => void; toggle: () => void; isOpen: () => boolean } {
  let open = false
  let plan: GcodeToolpathPlan | null = null
  let progress = 0
  let backdrop: HTMLDivElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let ro: ResizeObserver | null = null
  let unsubStore: (() => void) | null = null
  let rebuildTimer = 0

  /** Preview camera (CAD Y-down → canvas Y-down). */
  let scale = 1
  let panX = 0
  let panY = 0
  let dragging = false
  let lastX = 0
  let lastY = 0
  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null

  const qs = <T extends Element>(sel: string) => backdrop?.querySelector<T>(sel) ?? null

  const rebuild = () => {
    if (!open) return
    plan = editor.export.toolpaths({ flipY: true })
    bounds = computeBounds(plan)
    const cuts = plan.cuts.length
    const len = plan.cutLength
    const title = qs<HTMLElement>('[data-gcode-title]')
    if (title) {
      title.textContent = `${t('gcodePreview')} · ${cuts} ${t('gcodePaths')} · ${len.toFixed(1)} mm`
    }
    fitView()
    paint()
  }

  const scheduleRebuild = () => {
    if (!open) return
    window.clearTimeout(rebuildTimer)
    rebuildTimer = window.setTimeout(rebuild, 80)
  }

  const fitView = () => {
    if (!canvas || !bounds) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    if (cssW < 2 || cssH < 2) return
    const pad = 36
    const bw = Math.max(1e-6, bounds.maxX - bounds.minX)
    const bh = Math.max(1e-6, bounds.maxY - bounds.minY)
    scale = Math.min((cssW - pad * 2) / bw, (cssH - pad * 2) / bh)
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2
    panX = cssW / 2 - cx * scale
    panY = cssH / 2 - cy * scale
    void dpr
  }

  const worldToScreen = (p: Pt): Pt => ({
    x: p.x * scale + panX,
    y: p.y * scale + panY,
  })

  const resizeCanvas = () => {
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    const pw = Math.round(w * dpr)
    const ph = Math.round(h * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
  }

  const paint = () => {
    if (!open || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)

    // Light grid in screen space
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    const step = 20
    ctx.beginPath()
    for (let x = 0; x <= w; x += step) {
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, h)
    }
    for (let y = 0; y <= h; y += step) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(w, y + 0.5)
    }
    ctx.stroke()

    if (!plan) {
      ctx.fillStyle = '#6b7280'
      ctx.font = '13px system-ui,sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(t('layerGcodeEmpty'), w / 2, h / 2)
      return
    }

    const strokePaths = (paths: Pt[][], color: string, width: number, dashed = false) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash(dashed ? [6, 5] : [])
      for (const pts of paths) {
        if (pts.length < 2) continue
        ctx.beginPath()
        const s0 = worldToScreen(pts[0]!)
        ctx.moveTo(s0.x, s0.y)
        for (let i = 1; i < pts.length; i++) {
          const s = worldToScreen(pts[i]!)
          ctx.lineTo(s.x, s.y)
        }
        ctx.stroke()
      }
      ctx.setLineDash([])
    }

    // Travels under cuts
    const travels: Pt[][] = []
    for (const m of plan.motions) {
      if (m.kind !== 'travel') continue
      travels.push([m.travel.from, m.travel.to])
    }
    strokePaths(travels, TRAVEL, 1.25, true)

    const { done, remaining } = samplePlanProgress(plan, progress)
    strokePaths(remaining, CUT_REST, 1.75)
    strokePaths(done, CUT_DONE, 2.25)

    // Progress tip
    if (progress > 0 && progress < 1 && done.length) {
      const last = done[done.length - 1]!
      const tip = last[last.length - 1]
      if (tip) {
        const s = worldToScreen(tip)
        ctx.fillStyle = CUT_DONE
        ctx.beginPath()
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
  }

  const setProgress = (value: number) => {
    progress = Math.max(0, Math.min(1, value))
    const range = qs<HTMLInputElement>('[data-gcode-range]')
    if (range) range.value = String(Math.round(progress * 1000))
    const pct = qs<HTMLElement>('[data-gcode-pct]')
    if (pct) pct.textContent = `${Math.round(progress * 100)}%`
    paint()
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close()
  }

  const bindCanvasNav = (el: HTMLCanvasElement) => {
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return
      dragging = true
      lastX = ev.clientX
      lastY = ev.clientY
      el.setPointerCapture(ev.pointerId)
      el.style.cursor = 'grabbing'
    })
    el.addEventListener('pointermove', (ev) => {
      if (!dragging) return
      panX += ev.clientX - lastX
      panY += ev.clientY - lastY
      lastX = ev.clientX
      lastY = ev.clientY
      paint()
    })
    const endDrag = (ev: PointerEvent) => {
      if (!dragging) return
      dragging = false
      try {
        el.releasePointerCapture(ev.pointerId)
      } catch {
        /* ignore */
      }
      el.style.cursor = 'grab'
    }
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    el.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault()
        const rect = el.getBoundingClientRect()
        const mx = ev.clientX - rect.left
        const my = ev.clientY - rect.top
        const worldX = (mx - panX) / scale
        const worldY = (my - panY) / scale
        const factor = ev.deltaY > 0 ? 0.9 : 1.1
        const next = Math.max(0.05, Math.min(200, scale * factor))
        panX = mx - worldX * next
        panY = my - worldY * next
        scale = next
        paint()
      },
      { passive: false },
    )
    el.addEventListener('dblclick', () => {
      fitView()
      paint()
    })
  }

  const mountDialog = () => {
    const root = document.createElement('div')
    root.id = 'gcode-preview-dialog'
    root.className = 'fixed inset-0 z-[95]'
    root.innerHTML = `
      <div class="absolute inset-0 bg-black/45" data-gcode-close></div>
      <div
        class="absolute left-1/2 top-[5%] flex h-[min(84vh,760px)] w-[min(960px,94vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gcode-preview-title"
      >
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div class="min-w-0">
            <h2 id="gcode-preview-title" class="font-display text-base font-semibold text-ink">${t('gcodePreview')}</h2>
            <p data-gcode-title class="truncate text-[11px] text-muted"></p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button type="button" data-gcode-fit class="rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink hover:bg-soft">${t('gcodePreviewFit')}</button>
            <button type="button" class="grid h-8 w-8 place-items-center rounded-md text-lg text-muted hover:bg-soft" data-gcode-close aria-label="${t('cancel')}">×</button>
          </div>
        </header>
        <div class="relative min-h-0 flex-1 bg-soft">
          <canvas data-gcode-canvas class="absolute inset-0 h-full w-full cursor-grab touch-none"></canvas>
          <div class="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-md border border-line bg-panel/90 px-2 py-1.5 text-[10px] text-muted shadow-sm backdrop-blur">
            <span><i class="mr-1 inline-block h-1.5 w-3 rounded-sm align-middle" style="background:${CUT_DONE}"></i>${t('gcodeLegendCut')}</span>
            <span><i class="mr-1 inline-block h-1.5 w-3 rounded-sm align-middle" style="background:${TRAVEL}"></i>${t('gcodeLegendTravel')}</span>
            <span class="text-[10px] opacity-80">${t('gcodePreviewNavHint')}</span>
          </div>
        </div>
        <footer class="shrink-0 border-t border-line px-4 py-3">
          <div class="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
            <span>${t('gcodePreviewProgress')}</span>
            <span data-gcode-pct class="tabular-nums text-ink">0%</span>
          </div>
          <input data-gcode-range type="range" min="0" max="1000" value="0" step="1"
            class="h-2 w-full cursor-pointer appearance-none rounded-full bg-soft"
            style="accent-color:#22c55e" />
        </footer>
      </div>
    `
    document.body.appendChild(root)
    backdrop = root
    canvas = root.querySelector<HTMLCanvasElement>('[data-gcode-canvas]')
    if (canvas) {
      bindCanvasNav(canvas)
      ro = new ResizeObserver(() => {
        const prevW = canvas!.clientWidth
        const prevH = canvas!.clientHeight
        const cx = (prevW / 2 - panX) / scale
        const cy = (prevH / 2 - panY) / scale
        resizeCanvas()
        const w = canvas!.clientWidth
        const h = canvas!.clientHeight
        panX = w / 2 - cx * scale
        panY = h / 2 - cy * scale
        paint()
      })
      ro.observe(canvas)
    }
    root.querySelectorAll('[data-gcode-close]').forEach((el) => {
      el.addEventListener('click', () => close())
    })
    root.querySelector('[data-gcode-fit]')?.addEventListener('click', () => {
      fitView()
      paint()
    })
    root.querySelector('[data-gcode-range]')?.addEventListener('input', (ev) => {
      setProgress(Number((ev.target as HTMLInputElement).value) / 1000)
    })
  }

  const openPreview = () => {
    if (open) return
    open = true
    mountDialog()
    progress = 0
    document.addEventListener('keydown', onKey)
    unsubStore = store.subscribeKeys(
      ['uiEpoch', 'layerEpoch', 'canUndo', 'canRedo', 'localeTick'],
      () => {
        if (!open) return
        scheduleRebuild()
      },
    )
    requestAnimationFrame(() => {
      resizeCanvas()
      rebuild()
      setProgress(0)
    })
    store.set({ status: t('gcodePreviewOn') })
    opts?.onOpenChange?.(true)
  }

  const close = () => {
    if (!open) return
    open = false
    window.clearTimeout(rebuildTimer)
    document.removeEventListener('keydown', onKey)
    unsubStore?.()
    unsubStore = null
    ro?.disconnect()
    ro = null
    backdrop?.remove()
    backdrop = null
    canvas = null
    plan = null
    bounds = null
    store.set({ status: t('ready') })
    opts?.onOpenChange?.(false)
  }

  return {
    open: openPreview,
    close,
    toggle: () => (open ? close() : openPreview()),
    isOpen: () => open,
  }
}

function computeBounds(plan: GcodeToolpathPlan): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (p: Pt) => {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  for (const m of plan.motions) {
    if (m.kind === 'travel') {
      add(m.travel.from)
      add(m.travel.to)
    } else {
      for (const p of m.path.points) add(p)
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  }
  // Pad tiny / degenerate boxes
  if (maxX - minX < 1e-3) {
    minX -= 1
    maxX += 1
  }
  if (maxY - minY < 1e-3) {
    minY -= 1
    maxY += 1
  }
  return { minX, minY, maxX, maxY }
}

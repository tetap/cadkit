import type { Editor } from '@cadkit/editor'
import type { GcodeMotion, GcodeToolpathPlan } from '@cadkit/io-gcode'
import type { AppStore } from '../app/store.js'
import { t } from '../i18n/index.js'

const CUT_DONE = '#22c55e'
const TRAVEL = '#f59e0b'
const GRID = '#e5e7eb'
const BG = '#f8fafc'

/** Rebuild full progress colouring only below this many motions; above: tip-only. */
const FULL_PROGRESS_MOTIONS = 20_000
/** Cap travel segments drawn in preview (keeps huge rasters interactive). */
const MAX_TRAVEL_DRAW = 12_000
/** Quantize laser power into this many visual buckets (fewer stroke() calls). */
const POWER_BUCKETS = 32

type Pt = { x: number; y: number }

type StrokeBatch = { color: string; path: Path2D }

type PathCache = {
  travel: Path2D
  rest: StrokeBatch[]
  done: StrokeBatch[]
  progress: number
  tip: Pt | null
  maxPower: number
  /** Rasterized layer for huge plans — pan/zoom only blit this. */
  bake: {
    canvas: OffscreenCanvas | HTMLCanvasElement
    originX: number
    originY: number
    pxPerMm: number
  } | null
}

/** Bake Path2D to a bitmap when motion count exceeds this. */
const BAKE_MOTIONS = 8_000
const BAKE_MAX_EDGE = 2048

/**
 * Modal G-code preview with its own canvas (independent of the editor WebGPU view).
 * Large plans use world-space Path2D caches + rAF so pan/zoom stay interactive.
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
  let paintRaf = 0
  let pathCache: PathCache | null = null

  /** Preview camera (CAD Y-down → canvas Y-down). */
  let scale = 1
  let panX = 0
  let panY = 0
  let dragging = false
  let lastX = 0
  let lastY = 0
  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null

  const qs = <T extends Element>(sel: string) => backdrop?.querySelector<T>(sel) ?? null

  const invalidatePaths = () => {
    pathCache = null
  }

  const rebuild = () => {
    if (!open) return
    void (async () => {
      const next = await editor.export.toolpaths({ flipY: true })
      if (!open) return
      plan = next
      bounds = computeBounds(plan)
      invalidatePaths()
      const cuts = plan.cuts.length
      const len = plan.cutLength
      const title = qs<HTMLElement>('[data-gcode-title]')
      if (title) {
        title.textContent = `${t('gcodePreview')} · ${cuts} ${t('gcodePaths')} · ${len.toFixed(1)} mm`
      }
      fitView()
      schedulePaint()
    })()
  }

  const scheduleRebuild = () => {
    if (!open) return
    window.clearTimeout(rebuildTimer)
    rebuildTimer = window.setTimeout(rebuild, 80)
  }

  const fitView = () => {
    if (!canvas || !bounds) return
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

  const ensurePathCache = (): PathCache | null => {
    if (!plan) return null
    const fullProgress = plan.motions.length <= FULL_PROGRESS_MOTIONS
    // Huge plans: same bake for 0…1 (tip moves separately); only rebuild at 100%.
    const keyProgress = fullProgress ? progress : progress >= 1 ? 1 : 0
    if (pathCache && pathCache.progress === keyProgress) return pathCache

    let maxPower = 1
    for (const c of plan.cuts) maxPower = Math.max(maxPower, c.power)

    const travel = new Path2D()
    const restMap = new Map<string, Path2D>()
    const doneMap = new Map<string, Path2D>()
    const bucket = (tone: number, done: boolean) => {
      const color = done ? cutColorDone(tone) : cutColorRest(tone)
      const map = done ? doneMap : restMap
      let p = map.get(color)
      if (!p) {
        p = new Path2D()
        map.set(color, p)
      }
      return p
    }
    const addPoly = (path: Path2D, pts: readonly Pt[]) => {
      if (pts.length < 2) return
      path.moveTo(pts[0]!.x, pts[0]!.y)
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i]!.x, pts[i]!.y)
    }

    let tip: Pt | null = null
    const target = progress * plan.totalLength
    let travelDrawn = 0

    if (!fullProgress || progress <= 0) {
      // Fast path: all cuts as "rest" (huge plans keep this bake while scrubbing).
      for (const m of plan.motions) {
        if (m.kind === 'travel') {
          if (travelDrawn >= MAX_TRAVEL_DRAW) continue
          travelDrawn++
          travel.moveTo(m.travel.from.x, m.travel.from.y)
          travel.lineTo(m.travel.to.x, m.travel.to.y)
          continue
        }
        const tone = Math.max(0, Math.min(1, m.path.power / maxPower))
        if (tone <= 0.001) continue // S0: skip — nearly invisible, huge count on binary images
        addPoly(bucket(tone, false), m.path.points)
      }
    } else if (progress >= 1) {
      for (const m of plan.motions) {
        if (m.kind === 'travel') {
          if (travelDrawn >= MAX_TRAVEL_DRAW) continue
          travelDrawn++
          travel.moveTo(m.travel.from.x, m.travel.from.y)
          travel.lineTo(m.travel.to.x, m.travel.to.y)
          continue
        }
        const tone = Math.max(0, Math.min(1, m.path.power / maxPower))
        if (tone <= 0.001) continue
        addPoly(bucket(tone, true), m.path.points)
        tip = m.path.points[m.path.points.length - 1] ?? tip
      }
    } else {
      for (const m of plan.motions) {
        if (m.kind === 'travel') {
          if (travelDrawn >= MAX_TRAVEL_DRAW) continue
          travelDrawn++
          travel.moveTo(m.travel.from.x, m.travel.from.y)
          travel.lineTo(m.travel.to.x, m.travel.to.y)
          continue
        }
        const tone = Math.max(0, Math.min(1, m.path.power / maxPower))
        if (tone <= 0.001) continue
        const { path, startDist, endDist } = m
        if (endDist <= target + 1e-9) {
          addPoly(bucket(tone, true), path.points)
          tip = path.points[path.points.length - 1] ?? tip
          continue
        }
        if (startDist >= target - 1e-9) {
          addPoly(bucket(tone, false), path.points)
          continue
        }
        const split = splitAtLength(path.points, target - startDist)
        if (split.before.length >= 2) {
          addPoly(bucket(tone, true), split.before)
          tip = split.before[split.before.length - 1] ?? tip
        }
        if (split.after.length >= 2) addPoly(bucket(tone, false), split.after)
      }
    }

    const toBatches = (map: Map<string, Path2D>): StrokeBatch[] => {
      const out: StrokeBatch[] = []
      for (const [color, path] of map) out.push({ color, path })
      return out
    }

    const rest = toBatches(restMap)
    const done = toBatches(doneMap)
    const bake =
      plan.motions.length >= BAKE_MOTIONS && bounds
        ? bakePathsToCanvas(travel, rest, done, bounds)
        : null

    pathCache = {
      travel,
      rest,
      done,
      progress: keyProgress,
      tip,
      maxPower,
      bake,
    }
    return pathCache
  }

  const paintNow = () => {
    if (!open || !canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)

    // Screen-space grid
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

    const cache = ensurePathCache()
    if (!cache) return

    if (cache.bake) {
      // One drawImage — interactive even with 100k+ segments.
      const { canvas: baked, originX, originY, pxPerMm } = cache.bake
      const screenScale = scale / pxPerMm
      ctx.setTransform(
        dpr * screenScale,
        0,
        0,
        dpr * screenScale,
        dpr * (panX + originX * scale),
        dpr * (panY + originY * scale),
      )
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(baked, 0, 0)
    } else {
      // World-space stroke: pan/zoom = setTransform only (no per-point rebuild).
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * panX, dpr * panY)
      const inv = 1 / Math.max(scale, 1e-6)
      const cutWidth = Math.max(0.45, Math.min(1.6, 0.9 / Math.sqrt(Math.max(scale, 0.2)))) * inv

      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = TRAVEL
      ctx.lineWidth = 1.25 * inv
      ctx.setLineDash([6 * inv, 5 * inv])
      ctx.stroke(cache.travel)
      ctx.setLineDash([])

      for (const b of cache.rest) {
        ctx.strokeStyle = b.color
        ctx.lineWidth = cutWidth
        ctx.stroke(b.path)
      }
      for (const b of cache.done) {
        ctx.strokeStyle = b.color
        ctx.lineWidth = cutWidth + 0.35 * inv
        ctx.stroke(b.path)
      }
    }

    if (progress > 0 && progress < 1) {
      const tip =
        plan.motions.length > FULL_PROGRESS_MOTIONS
          ? tipAtDistance(plan.motions, progress * plan.totalLength)
          : cache.tip
      if (tip) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
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

  const schedulePaint = () => {
    if (paintRaf) return
    paintRaf = requestAnimationFrame(() => {
      paintRaf = 0
      paintNow()
    })
  }

  const setProgress = (value: number) => {
    const prev = progress
    progress = Math.max(0, Math.min(1, value))
    // Invalidate when the Path2D/bake colouring key would change.
    if (plan) {
      const full = plan.motions.length <= FULL_PROGRESS_MOTIONS
      const prevKey = full ? prev : prev >= 1 ? 1 : 0
      const nextKey = full ? progress : progress >= 1 ? 1 : 0
      if (prevKey !== nextKey) invalidatePaths()
    }
    const range = qs<HTMLInputElement>('[data-gcode-range]')
    if (range) range.value = String(Math.round(progress * 1000))
    const pct = qs<HTMLElement>('[data-gcode-pct]')
    if (pct) pct.textContent = `${Math.round(progress * 100)}%`
    schedulePaint()
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
      schedulePaint()
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
        schedulePaint()
      },
      { passive: false },
    )
    el.addEventListener('dblclick', () => {
      fitView()
      schedulePaint()
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
        schedulePaint()
      })
      ro.observe(canvas)
    }
    root.querySelectorAll('[data-gcode-close]').forEach((el) => {
      el.addEventListener('click', () => close())
    })
    root.querySelector('[data-gcode-fit]')?.addEventListener('click', () => {
      fitView()
      schedulePaint()
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
    invalidatePaths()
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
    if (paintRaf) {
      cancelAnimationFrame(paintRaf)
      paintRaf = 0
    }
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
    invalidatePaths()
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

/** Remaining cuts: darker stroke = higher laser power; S0 nearly invisible. */
function cutColorRest(tone: number): string {
  if (tone <= 0.001) return 'rgba(200,200,200,0.15)'
  const q = Math.round(tone * (POWER_BUCKETS - 1)) / (POWER_BUCKETS - 1)
  const v = Math.round(210 - q * 185)
  return `rgb(${v},${v},${v})`
}

/** Completed cuts: green, deeper when power is higher. */
function cutColorDone(tone: number): string {
  const q = Math.round(tone * (POWER_BUCKETS - 1)) / (POWER_BUCKETS - 1)
  const g = Math.round(140 + q * 70)
  const r = Math.round(20 + (1 - q) * 40)
  return `rgb(${r},${g},${Math.round(70 + (1 - q) * 40)})`
}

function bakePathsToCanvas(
  travel: Path2D,
  rest: StrokeBatch[],
  done: StrokeBatch[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): PathCache['bake'] {
  const pad = 2
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX)
  const bh = Math.max(1e-6, bounds.maxY - bounds.minY)
  const pxPerMm = Math.min(BAKE_MAX_EDGE / bw, BAKE_MAX_EDGE / bh, 40)
  const w = Math.max(1, Math.ceil((bw + pad * 2) * pxPerMm))
  const h = Math.max(1, Math.ceil((bh + pad * 2) * pxPerMm))
  const originX = bounds.minX - pad
  const originY = bounds.minY - pad

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h })
  if (!(canvas instanceof OffscreenCanvas)) {
    ;(canvas as HTMLCanvasElement).width = w
    ;(canvas as HTMLCanvasElement).height = h
  }
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (!ctx) return null

  ctx.setTransform(pxPerMm, 0, 0, pxPerMm, -originX * pxPerMm, -originY * pxPerMm)
  const inv = 1 / pxPerMm
  const cutWidth = Math.max(0.4 * inv, 0.08)

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = TRAVEL
  ctx.lineWidth = 1.1 * inv
  ctx.setLineDash([5 * inv, 4 * inv])
  ctx.stroke(travel)
  ctx.setLineDash([])
  for (const b of rest) {
    ctx.strokeStyle = b.color
    ctx.lineWidth = cutWidth
    ctx.stroke(b.path)
  }
  for (const b of done) {
    ctx.strokeStyle = b.color
    ctx.lineWidth = cutWidth * 1.15
    ctx.stroke(b.path)
  }
  return { canvas, originX, originY, pxPerMm }
}

function tipAtDistance(motions: readonly GcodeMotion[], target: number): Pt | null {
  let lo = 0
  let hi = motions.length - 1
  let hit: GcodeMotion | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const m = motions[mid]!
    if (m.endDist < target) lo = mid + 1
    else if (m.startDist > target) hi = mid - 1
    else {
      hit = m
      break
    }
  }
  if (!hit) hit = motions[Math.min(lo, motions.length - 1)] ?? null
  if (!hit) return null
  if (hit.kind === 'travel') {
    const u = hit.endDist <= hit.startDist ? 1 : (target - hit.startDist) / (hit.endDist - hit.startDist)
    const t = Math.max(0, Math.min(1, u))
    return {
      x: hit.travel.from.x + (hit.travel.to.x - hit.travel.from.x) * t,
      y: hit.travel.from.y + (hit.travel.to.y - hit.travel.from.y) * t,
    }
  }
  const split = splitAtLength(hit.path.points, Math.max(0, target - hit.startDist))
  return split.before[split.before.length - 1] ?? hit.path.points[0] ?? null
}

function splitAtLength(points: readonly Pt[], length: number): { before: Pt[]; after: Pt[] } {
  if (length <= 0) return { before: [], after: points.map((p) => ({ ...p })) }
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (acc + seg >= length - 1e-12) {
      const u = seg < 1e-12 ? 0 : (length - acc) / seg
      const mid = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
      return {
        before: [...points.slice(0, i).map((p) => ({ ...p })), mid],
        after: [mid, ...points.slice(i).map((p) => ({ ...p }))],
      }
    }
    acc += seg
  }
  return { before: points.map((p) => ({ ...p })), after: [] }
}

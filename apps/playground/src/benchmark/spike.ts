/**
 * Technical spike harness — WebGPU-only performance + ABI freeze.
 * Includes 1,000,000 squares with FPS / CPU / memory sampling.
 * Run via playground Dev menu, or open `/#/benchmark`.
 */
import { CadDocument } from '@cadkit/document'
import { Camera2D } from '@cadkit/geometry'
import { SceneProjector } from '@cadkit/scene'
import { WebGPURenderer } from '@cadkit/render-webgpu'
import {
  DEFAULT_PERFORMANCE_CONFIG,
  createEntityId,
  createLayerId,
  IDENTITY_TRANSFORM,
  type Entity,
} from '@cadkit/types'
import { WORKER_ABI } from '@cadkit/worker-runtime'

export interface SpikeCaseResult {
  name: string
  backend: string
  entityCount: number
  buildMs: number
  frameMsP50: number
  frameMsP95: number
  fpsAvg: number
  fpsMin: number
  drawCalls: number
  uploadBytes: number
  heapUsedMB: number
  heapTotalMB: number
  cpuBusyRatio: number
  notes: string
}

export interface SpikeReport {
  generatedAt: string
  abi: typeof WORKER_ABI
  webgpuSupported: boolean
  cases: SpikeCaseResult[]
  frozenTargets: Record<string, string>
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]!
}

function sampleMemoryMB(): { used: number; total: number } {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
  }
  if (perf.memory) {
    return {
      used: perf.memory.usedJSHeapSize / (1024 * 1024),
      total: perf.memory.totalJSHeapSize / (1024 * 1024),
    }
  }
  return { used: 0, total: 0 }
}

function emptyCase(name: string, notes: string, count = 0): SpikeCaseResult {
  return {
    name,
    backend: 'webgpu',
    entityCount: count,
    buildMs: 0,
    frameMsP50: Infinity,
    frameMsP95: Infinity,
    fpsAvg: 0,
    fpsMin: 0,
    drawCalls: 0,
    uploadBytes: 0,
    heapUsedMB: 0,
    heapTotalMB: 0,
    cpuBusyRatio: 0,
    notes,
  }
}

/** Chunked insert of axis-aligned closed squares (polylines). */
export function makeSquares(doc: CadDocument, count: number, origin = 0, size = 8, gap = 10): void {
  const layer = doc.getDefaultLayerId() || createLayerId()
  const batch: Entity[] = []
  const flush = () => {
    if (!batch.length) return
    doc.addMany(batch.splice(0, batch.length))
  }
  const cols = Math.ceil(Math.sqrt(count))
  for (let i = 0; i < count; i++) {
    const x = origin + (i % cols) * gap
    const y = origin + Math.floor(i / cols) * gap
    batch.push({
      id: createEntityId('sq'),
      type: 'polyline',
      layerId: layer,
      style: { stroke: '#32cd79', strokeWidth: 1 },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: [
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
      ],
      closed: true,
    })
    if (batch.length >= 25_000) flush()
  }
  flush()
}

function makeLines(doc: CadDocument, count: number, origin = 0): void {
  const layer = doc.getDefaultLayerId() || createLayerId()
  const batch: Entity[] = []
  for (let i = 0; i < count; i++) {
    const x = origin + (i % 1000) * 2
    const y = origin + Math.floor(i / 1000) * 2
    batch.push({
      id: createEntityId('line'),
      type: 'line',
      layerId: layer,
      style: { stroke: '#32cd79', strokeWidth: 1 },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x, y },
      end: { x: x + 1.5, y: y + 1.2 },
    })
    if (batch.length >= 50_000) {
      doc.addMany(batch.splice(0, batch.length))
    }
  }
  if (batch.length) doc.addMany(batch)
}

async function measureBackend(
  name: string,
  count: number,
  kind: 'line' | 'square',
  origin = 0,
  sampleFrames = 60,
): Promise<SpikeCaseResult> {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  document.body.appendChild(canvas)
  canvas.style.position = 'fixed'
  canvas.style.left = '-9999px'

  const memBefore = sampleMemoryMB()
  const doc = new CadDocument()
  const tLoad0 = performance.now()
  if (kind === 'square') makeSquares(doc, count, origin)
  else makeLines(doc, count, origin)
  const loadMs = performance.now() - tLoad0

  const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
  scene.rebuildIndex()
  const camera = new Camera2D()
  camera.setViewport(1280, 720)
  camera.fitBounds(doc.getDocumentBounds())

  const backend = new WebGPURenderer()
  try {
    await backend.initialize(canvas)
  } catch (e) {
    canvas.remove()
    return emptyCase(name, `init failed: ${e instanceof Error ? e.message : String(e)}`, count)
  }
  backend.resize(1280, 720, 1)

  const frames: number[] = []
  let drawCalls = 0
  let uploadBytes = 0
  let buildMs = 0
  let busyMs = 0
  const wall0 = performance.now()

  for (let i = 0; i < sampleFrames; i++) {
    // Keep the GPU busy with small pans (simulates interactive navigation)
    camera.pan(i % 2 === 0 ? 3 : -3, i % 3 === 0 ? 1 : -1)
    const t0 = performance.now()
    const built = scene.build(camera)
    buildMs = built.stats.buildMs
    const metrics = backend.render({
      camera,
      items: built.items,
      selected: new Set(),
      stats: built.stats,
    })
    const dt = performance.now() - t0
    busyMs += dt
    frames.push(metrics.frameMs)
    drawCalls = metrics.drawCalls
    uploadBytes = metrics.uploadBytes
    // Yield so the browser can paint / GC between samples
    if (i % 10 === 9) await new Promise((r) => requestAnimationFrame(r))
  }

  const wallMs = Math.max(1, performance.now() - wall0)
  frames.sort((a, b) => a - b)
  const fpsSamples = frames.map((ms) => (ms > 0 ? 1000 / ms : 0))
  const fpsAvg = fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, fpsSamples.length)
  const fpsMin = Math.min(...fpsSamples)
  const memAfter = sampleMemoryMB()

  backend.dispose()
  canvas.remove()

  const p95 = percentile(frames, 95)
  return {
    name,
    backend: 'webgpu',
    entityCount: count,
    buildMs,
    frameMsP50: percentile(frames, 50),
    frameMsP95: p95,
    fpsAvg,
    fpsMin,
    drawCalls,
    uploadBytes,
    heapUsedMB: Math.max(0, memAfter.used - memBefore.used) || memAfter.used,
    heapTotalMB: memAfter.total,
    cpuBusyRatio: busyMs / wallMs,
    notes:
      `load=${loadMs.toFixed(0)}ms · ` +
      (p95 <= 16.7 ? 'meets high-end 60fps target' : p95 <= 33 ? 'meets integrated 30fps target' : 'needs LOD/device tiering'),
  }
}

export async function runSpike(): Promise<SpikeReport> {
  const webgpuSupported = await WebGPURenderer.isSupported()
  const cases: SpikeCaseResult[] = []

  if (!webgpuSupported) {
    cases.push(emptyCase('webgpu-unavailable', 'WebGPU required — Canvas2D path removed'))
  } else {
    cases.push(await measureBackend('100k-squares-webgpu', 100_000, 'square', 0, 45))
    cases.push(await measureBackend('1m-squares-webgpu', 1_000_000, 'square', 0, 60))
    cases.push(await measureBackend('1m-lines-webgpu', 1_000_000, 'line', 0, 45))
    cases.push(await measureBackend('large-coords-squares', 50_000, 'square', 1e8, 30))
  }

  {
    const doc = new CadDocument()
    const t0 = performance.now()
    makeSquares(doc, 1_000_000)
    const loadMs = performance.now() - t0
    const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
    scene.rebuildIndex()
    const camera = new Camera2D()
    camera.setViewport(1280, 720)
    camera.fitBounds(doc.getDocumentBounds())
    const mem = sampleMemoryMB()
    const t1 = performance.now()
    const built = scene.build(camera)
    const buildMs = performance.now() - t1
    cases.push({
      name: '1m-squares-display-list-cpu',
      backend: 'cpu',
      entityCount: 1_000_000,
      buildMs,
      frameMsP50: buildMs,
      frameMsP95: buildMs,
      fpsAvg: buildMs > 0 ? 1000 / buildMs : 0,
      fpsMin: buildMs > 0 ? 1000 / buildMs : 0,
      drawCalls: built.stats.batchHints,
      uploadBytes: 0,
      heapUsedMB: mem.used,
      heapTotalMB: mem.total,
      cpuBusyRatio: 1,
      notes: `load=${loadMs.toFixed(0)}ms visible=${built.stats.visibleCount} culled=${built.stats.culledCount}`,
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    abi: WORKER_ABI,
    webgpuSupported,
    cases,
    frozenTargets: {
      'nav-desktop-high-p95': '<= 16.7ms',
      'nav-integrated-p95': '<= 33ms',
      '1m-squares-fps': '60fps high-end / 30fps integrated (LOD-qualified)',
      'click-p95': '<= 100ms',
      'edit-first-correct-frame': '<= 100ms',
      'simple-visible-1m': '60fps high-end / 30fps integrated (LOD-qualified)',
      'total-entities-10m': 'chunked out-of-core, bounded memory',
      'worker-abi': `${WORKER_ABI.major}.${WORKER_ABI.minor}/${WORKER_ABI.channel}`,
      renderer: 'webgpu-only',
    },
  }
}

export type SpikeTranslate = (key: string) => string

const defaultSpikeT: SpikeTranslate = (key) => {
  const en: Record<string, string> = {
    'spike.title': 'Tech spike report (WebGPU · 1M squares)',
    'spike.generated': 'Generated at',
    'spike.webgpu': 'WebGPU',
    'spike.available': 'available',
    'spike.unavailable': 'unavailable',
    'spike.targets': 'Frozen targets',
    'spike.results': 'Results',
    'spike.note':
      'Notes: FPS is derived from frame time; CPU busy = (build+render)/wall; Heap from performance.memory (Chromium).',
    'spike.col.case': 'Case',
    'spike.col.backend': 'Backend',
    'spike.col.entities': 'Entities',
    'spike.col.build': 'Build ms',
    'spike.col.p95': 'Frame p95',
    'spike.col.fpsAvg': 'FPS avg',
    'spike.col.fpsMin': 'FPS min',
    'spike.col.cpu': 'CPU busy',
    'spike.col.heapUsed': 'Heap used MB',
    'spike.col.heapTotal': 'Heap total MB',
    'spike.col.draws': 'Draws',
    'spike.col.upload': 'Upload MB',
    'spike.col.notes': 'Notes',
  }
  return en[key] ?? key
}

export function renderSpikeReport(report: SpikeReport, translate: SpikeTranslate = defaultSpikeT): string {
  const tr = translate
  const rows = report.cases
    .map(
      (c) =>
        `<tr>
          <td>${c.name}</td>
          <td>${c.backend}</td>
          <td>${c.entityCount.toLocaleString()}</td>
          <td>${c.buildMs.toFixed(2)}</td>
          <td class="${c.frameMsP95 <= 16.7 ? 'ok' : 'warn'}">${c.frameMsP95.toFixed(2)}</td>
          <td>${c.fpsAvg.toFixed(1)}</td>
          <td>${c.fpsMin.toFixed(1)}</td>
          <td>${(c.cpuBusyRatio * 100).toFixed(1)}%</td>
          <td>${c.heapUsedMB.toFixed(1)}</td>
          <td>${c.heapTotalMB.toFixed(1)}</td>
          <td>${c.drawCalls}</td>
          <td>${(c.uploadBytes / 1024 / 1024).toFixed(2)}</td>
          <td>${c.notes}</td>
        </tr>`,
    )
    .join('')

  const targets = Object.entries(report.frozenTargets)
    .map(([k, v]) => `<li><code>${k}</code>: ${v}</li>`)
    .join('')

  const gpuLabel = report.webgpuSupported
    ? `<span class="ok">${tr('spike.available')}</span>`
    : `<span class="warn">${tr('spike.unavailable')}</span>`

  return `
    <h2>${tr('spike.title')}</h2>
    <p>${tr('spike.generated')}：${report.generatedAt}</p>
    <p>${tr('spike.webgpu')}：${gpuLabel}
       · Worker ABI：<code>${report.abi.major}.${report.abi.minor}</code> / ${report.abi.channel}</p>
    <p>${tr('spike.note')}</p>
    <h3>${tr('spike.targets')}</h3>
    <ul>${targets}</ul>
    <h3>${tr('spike.results')}</h3>
    <table>
      <thead>
        <tr>
          <th>${tr('spike.col.case')}</th><th>${tr('spike.col.backend')}</th><th>${tr('spike.col.entities')}</th><th>${tr('spike.col.build')}</th>
          <th>${tr('spike.col.p95')}</th><th>${tr('spike.col.fpsAvg')}</th><th>${tr('spike.col.fpsMin')}</th><th>${tr('spike.col.cpu')}</th>
          <th>${tr('spike.col.heapUsed')}</th><th>${tr('spike.col.heapTotal')}</th>
          <th>${tr('spike.col.draws')}</th><th>${tr('spike.col.upload')}</th><th>${tr('spike.col.notes')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

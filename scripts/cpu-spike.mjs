/**
 * Headless CPU portion of the tech spike (no WebGPU).
 * Freezes Worker ABI + display-list scale numbers for CI.
 */
import { CadDocument } from '../packages/document/dist/index.js'
import { Camera2D } from '../packages/geometry/dist/index.js'
import { SceneProjector } from '../packages/scene/dist/index.js'
import { DEFAULT_PERFORMANCE_CONFIG, createEntityId, IDENTITY_TRANSFORM } from '../packages/types/dist/index.js'
import { WORKER_ABI } from '../packages/worker-runtime/dist/index.js'
import { writeFileSync } from 'node:fs'

function makeLines(doc, count) {
  const layer = doc.getDefaultLayerId()
  const batch = []
  for (let i = 0; i < count; i++) {
    const x = (i % 1000) * 2
    const y = Math.floor(i / 1000) * 2
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

const counts = [10_000, 100_000, 1_000_000]
const cases = []

for (const count of counts) {
  const doc = new CadDocument()
  const tAdd0 = performance.now()
  makeLines(doc, count)
  const addMs = performance.now() - tAdd0
  const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
  const camera = new Camera2D()
  camera.setViewport(1280, 720)
  camera.fitBounds(doc.getDocumentBounds())
  const builds = []
  for (let i = 0; i < 10; i++) {
    camera.pan(1, 0)
    const t0 = performance.now()
    const built = scene.build(camera)
    builds.push({ ms: performance.now() - t0, visible: built.stats.visibleCount, batches: built.stats.batchHints })
  }
  builds.sort((a, b) => a.ms - b.ms)
  const p95 = builds[Math.ceil(builds.length * 0.95) - 1]
  cases.push({
    name: `${count}-lines-display-list`,
    entityCount: count,
    addMs: Number(addMs.toFixed(2)),
    buildP50: Number(builds[Math.floor(builds.length / 2)].ms.toFixed(2)),
    buildP95: Number(p95.ms.toFixed(2)),
    visible: p95.visible,
    batchHints: p95.batches,
  })
}

const report = {
  generatedAt: new Date().toISOString(),
  abi: WORKER_ABI,
  cases,
  frozenTargets: {
    'nav-desktop-high-p95': '<= 16.7ms',
    'nav-integrated-p95': '<= 33ms',
    'click-p95': '<= 100ms',
    'edit-first-correct-frame': '<= 100ms',
    'simple-visible-1m': '60fps high-end / 30fps integrated (LOD-qualified)',
    'total-entities-10m': 'chunked out-of-core, bounded memory',
    'worker-abi': `${WORKER_ABI.major}.${WORKER_ABI.minor}/${WORKER_ABI.channel}`,
  },
}

writeFileSync(new URL('../spike-report.json', import.meta.url), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

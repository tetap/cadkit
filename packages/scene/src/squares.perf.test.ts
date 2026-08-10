/**
 * CPU-side performance gate for 1,000,000 closed squares.
 * Measures load + display-list build + heap (Node).
 */
import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { Camera2D } from '@cadkit/geometry'
import {
  DEFAULT_PERFORMANCE_CONFIG,
  IDENTITY_TRANSFORM,
  createEntityId,
  type Entity,
} from '@cadkit/types'
import { SceneProjector } from './display-list.js'

const COUNT = 1_000_000

function makeSquares(doc: CadDocument, count: number): void {
  const layer = doc.getDefaultLayerId()
  const batch: Entity[] = []
  const cols = Math.ceil(Math.sqrt(count))
  for (let i = 0; i < count; i++) {
    const x = (i % cols) * 10
    const y = Math.floor(i / cols) * 10
    batch.push({
      id: createEntityId('sq'),
      type: 'polyline',
      layerId: layer,
      style: { stroke: '#32cd79' },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: [
        { x, y },
        { x: x + 8, y },
        { x: x + 8, y: y + 8 },
        { x, y: y + 8 },
      ],
      closed: true,
    })
    if (batch.length >= 25_000) doc.addMany(batch.splice(0, batch.length))
  }
  if (batch.length) doc.addMany(batch)
}

describe('perf: 1e6 squares', () => {
  it(
    'loads and builds display list under budget',
    () => {
      const memBefore = process.memoryUsage().heapUsed
      const doc = new CadDocument()
      const t0 = performance.now()
      makeSquares(doc, COUNT)
      const loadMs = performance.now() - t0
      expect(doc.count()).toBe(COUNT)

      const scene = new SceneProjector(doc, DEFAULT_PERFORMANCE_CONFIG)
      scene.rebuildIndex()
      const camera = new Camera2D()
      camera.setViewport(1280, 720)
      camera.fitBounds(doc.getDocumentBounds())

      const t1 = performance.now()
      const built = scene.build(camera)
      const buildMs = performance.now() - t1
      const memAfter = process.memoryUsage().heapUsed
      const heapDeltaMB = (memAfter - memBefore) / (1024 * 1024)

      // Soft gates — CI machines vary; catch pathological regressions.
      expect(loadMs).toBeLessThan(120_000)
      expect(buildMs).toBeLessThan(5_000)
      expect(built.stats.visibleCount + built.stats.culledCount).toBeGreaterThan(0)
      expect(heapDeltaMB).toBeLessThan(4096)

      // eslint-disable-next-line no-console
      console.info(
        `[perf 1m squares] load=${loadMs.toFixed(0)}ms build=${buildMs.toFixed(1)}ms ` +
          `visible=${built.stats.visibleCount} culled=${built.stats.culledCount} ` +
          `heapΔ=${heapDeltaMB.toFixed(0)}MB rss=${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)}MB`,
      )
    },
    180_000,
  )
})

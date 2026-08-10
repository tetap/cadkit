import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { makeSquares, renderSpikeReport, type SpikeReport } from './spike.js'
import { WORKER_ABI } from '@cadkit/worker-runtime'

describe('spike helpers', () => {
  it('makeSquares inserts closed polylines', () => {
    const doc = new CadDocument()
    makeSquares(doc, 100)
    expect(doc.count()).toBe(100)
    const e = doc.getEntities()[0]!
    expect(e.type).toBe('polyline')
    if (e.type === 'polyline') expect(e.closed).toBe(true)
  })

  it('renderSpikeReport includes fps columns', () => {
    const report: SpikeReport = {
      generatedAt: new Date().toISOString(),
      abi: WORKER_ABI,
      webgpuSupported: false,
      cases: [],
      frozenTargets: { renderer: 'webgpu-only' },
    }
    const html = renderSpikeReport(report)
    expect(html).toContain('FPS avg')
    expect(html).toContain('CPU busy')
  })
})

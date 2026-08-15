import { describe, expect, it } from 'vitest'
import { fitPolylineArcs } from './arc-fit.js'

function sampleCircle(cx: number, cy: number, r: number, n: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * 2 * i) / n
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return pts
}

describe('fitPolylineArcs', () => {
  it('collapses a sampled circle to one arc', () => {
    const pts = sampleCircle(10, 10, 8, 32)
    const segs = fitPolylineArcs(pts, 0.05)
    const arcs = segs.filter((s) => s.kind === 'arc')
    const lines = segs.filter((s) => s.kind === 'line')
    expect(arcs.length).toBe(1)
    expect(lines.length).toBe(0)
    if (arcs[0]?.kind !== 'arc') throw new Error('expected arc')
    expect(arcs[0].center.x).toBeCloseTo(10, 2)
    expect(arcs[0].center.y).toBeCloseTo(10, 2)
  })

  it('fits an open quarter-circle', () => {
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i <= 12; i++) {
      const a = (Math.PI / 2) * (i / 12)
      pts.push({ x: 10 * Math.cos(a), y: 10 * Math.sin(a) })
    }
    const segs = fitPolylineArcs(pts, 0.05)
    expect(segs.some((s) => s.kind === 'arc')).toBe(true)
    expect(segs.filter((s) => s.kind === 'line').length).toBeLessThan(3)
  })

  it('keeps a regular hexagon as straight sides', () => {
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i <= 6; i++) {
      const a = (Math.PI * 2 * i) / 6
      pts.push({ x: Math.cos(a), y: Math.sin(a) })
    }
    const segs = fitPolylineArcs(pts, 0.05)
    expect(segs.every((s) => s.kind === 'line')).toBe(true)
  })

  it('keeps a straight run as lines', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]
    const segs = fitPolylineArcs(pts, 0.05)
    expect(segs).toHaveLength(4)
    expect(segs.every((s) => s.kind === 'line')).toBe(true)
  })
})

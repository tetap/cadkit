import { describe, expect, it } from 'vitest'
import { importGcode } from './parse.js'

describe('importGcode', () => {
  it('parses laser G0/G1 cuts into a polyline and welds fragments', () => {
    const src = `
G21
G90
G0 X0 Y0
M3 S500
G1 X10 Y0 F1000
G1 X10 Y10
M5
G0 X20 Y0
M3
G1 X30 Y0
G1 X30 Y10
M5
M2
`
    const { entities, stats } = importGcode(src, { flipY: false, optimize: true })
    expect(entities.length).toBeGreaterThanOrEqual(1)
    expect(stats?.before).toBeGreaterThanOrEqual(2)
    // Two separate open cuts should remain separate (not endpoint-adjacent).
    const opens = entities.filter((e) => e.type === 'line' || e.type === 'polyline')
    expect(opens.length).toBe(2)
  })

  it('merges endpoint-adjacent G1 segments across M5 gaps when close', () => {
    // Same continuous polyline split by accidental M5/M3 at shared endpoint.
    const src = `
G21 G90
M3
G1 X0 Y0 F1000
G1 X5 Y0
M5
M3
G1 X5 Y0
G1 X10 Y0
M5
`
    const { entities, stats } = importGcode(src, { flipY: false })
    expect(stats?.after).toBeLessThan(stats!.before)
    const poly = entities.find((e) => e.type === 'polyline' || e.type === 'line')
    expect(poly).toBeTruthy()
    if (poly?.type === 'polyline') {
      expect(poly.points[0]!.x).toBeCloseTo(0)
      expect(poly.points[poly.points.length - 1]!.x).toBeCloseTo(10)
    } else if (poly?.type === 'line') {
      expect(poly.start.x).toBeCloseTo(0)
      expect(poly.end.x).toBeCloseTo(10)
    }
  })

  it('imports G2/G3 as arc entities', () => {
    // Quarter circle G3 CCW from (10,0) around origin to (0,10), I/J from start.
    const src = `
G21 G90
G0 X10 Y0
M3 S100
G3 X0 Y10 I-10 J0
M5
`
    const { entities } = importGcode(src, { flipY: false, optimize: false })
    const arcs = entities.filter((e) => e.type === 'arc')
    expect(arcs).toHaveLength(1)
    const a = arcs[0]!
    if (a.type !== 'arc') throw new Error('expected arc')
    expect(a.center.x).toBeCloseTo(0, 5)
    expect(a.center.y).toBeCloseTo(0, 5)
    expect(a.radius).toBeCloseTo(10, 5)
  })

  it('flips Y to match export convention', () => {
    const src = `
G21 G90
G0 X0 Y5
M3
G1 X10 Y5 F1000
M5
`
    const { entities } = importGcode(src, { flipY: true, optimize: false })
    const line = entities.find((e) => e.type === 'line' || e.type === 'polyline')
    expect(line).toBeTruthy()
    if (line?.type === 'line') {
      expect(line.start.y).toBeCloseTo(-5)
      expect(line.end.y).toBeCloseTo(-5)
      expect(line.start.x).toBeCloseTo(0)
      expect(line.end.x).toBeCloseTo(10)
    } else if (line?.type === 'polyline') {
      expect(line.points.map((p) => p.y)).toEqual([-5, -5])
    }
  })

  it('treats G1 as cut when file has no M3/M5', () => {
    const src = `
G21 G90
G0 X0 Y0
G1 X10 Y0
G1 X10 Y10
G0 X0 Y0
`
    const { entities } = importGcode(src, { flipY: false, optimize: false })
    const cuts = entities.filter((e) => e.type === 'line' || e.type === 'polyline')
    expect(cuts.length).toBe(1)
  })

  it('supports G91 incremental and G20 inches', () => {
    const src = `
G20 G91
M3
G1 X1 Y0 F100
G1 X0 Y1
M5
`
    const { entities } = importGcode(src, { flipY: false, optimize: false })
    const e = entities[0]!
    if (e.type === 'polyline') {
      expect(e.points[e.points.length - 1]!.x).toBeCloseTo(25.4, 4)
      expect(e.points[e.points.length - 1]!.y).toBeCloseTo(25.4, 4)
    } else if (e.type === 'line') {
      expect(e.end.x).toBeCloseTo(25.4, 4)
      expect(e.end.y).toBeCloseTo(25.4, 4)
    } else {
      throw new Error(`unexpected ${e.type}`)
    }
  })
})

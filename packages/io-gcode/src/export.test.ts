import { describe, expect, it } from 'vitest'
import { CadDocument } from '@cadkit/document'
import { IDENTITY_TRANSFORM, createEntityId } from '@cadkit/types'
import { buildToolpaths, exportGcode } from './export.js'
import { hatchPolygon } from './hatch.js'

describe('hatchPolygon', () => {
  it('fills a unit square with horizontal segments', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const segs = hatchPolygon(ring, 2)
    expect(segs.length).toBeGreaterThan(2)
    for (const s of segs) {
      expect(s.a.y).toBeCloseTo(s.b.y, 6)
      expect(Math.abs(s.b.x - s.a.x)).toBeGreaterThan(5)
    }
  })
})

describe('exportGcode', () => {
  it('emits GRBL preamble and layer line paths', () => {
    const doc = new CadDocument()
    const layer = doc.getDefaultLayerId()
    doc.add({
      id: createEntityId('line'),
      type: 'line',
      layerId: layer,
      style: { stroke: '#32cd79' },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    const gcode = exportGcode(
      {
        entities: doc.getEntities(),
        layers: doc.getLayers(),
        getEntity: (id) => doc.getEntity(id),
      },
      { flipY: false, decimals: 1 },
    )
    expect(gcode).toContain('G21')
    expect(gcode).toContain('G90')
    expect(gcode).toContain('M3')
    expect(gcode).toContain('M5')
    expect(gcode).toMatch(/G1 X10\.0 Y0\.0/)
    expect(gcode).toContain('M2')
  })

  it('uses layer power/speed and fill hatch for fill mode', () => {
    const doc = new CadDocument()
    const layer = doc.addLayer({ name: 'Fill' })
    doc.updateLayer(layer.id, {
      gcode: {
        mode: 'fill',
        lineSpacing: 2,
        fillStyle: 'bidirectional',
        fillAngle: 0,
        power: 800,
        speed: 1500,
        passes: 1,
      },
    })
    doc.add({
      id: createEntityId('poly'),
      type: 'polyline',
      layerId: layer.id,
      style: { fill: '#111' },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ],
    })
    const gcode = exportGcode(
      {
        entities: doc.getEntities(),
        layers: doc.getLayers(),
        getEntity: (id) => doc.getEntity(id),
      },
      { flipY: false },
    )
    expect(gcode).toContain('S800')
    expect(gcode).toContain('F1500')
    expect(gcode).toContain('Layer Fill')
    // Hatch produces multiple G1 moves beyond a single outline.
    expect((gcode.match(/^G1 /gm) ?? []).length).toBeGreaterThan(2)
  })

  it('respects fillAngle for bidirectional and cross-hatch', () => {
    const doc = new CadDocument()
    const layer = doc.addLayer({ name: 'Angled' })
    doc.updateLayer(layer.id, {
      gcode: {
        mode: 'fill',
        lineSpacing: 5,
        fillStyle: 'bidirectional',
        fillAngle: 90,
        power: 500,
        speed: 1000,
        passes: 1,
      },
    })
    doc.add({
      id: createEntityId('poly'),
      type: 'polyline',
      layerId: layer.id,
      style: { fill: '#111' },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
    })
    const input = {
      entities: doc.getEntities(),
      layers: doc.getLayers(),
      getEntity: (id: ReturnType<typeof createEntityId>) => doc.getEntity(id),
    }
    const vertical = buildToolpaths(input, { flipY: false, optimizeOrder: false })
    // 90° hatch → mostly vertical segments (Δx ≈ 0).
    const vertSegs = vertical.cuts.filter((c) => {
      const a = c.points[0]!
      const b = c.points[c.points.length - 1]!
      return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) > 1
    })
    expect(vertSegs.length).toBeGreaterThan(0)

    doc.updateLayer(layer.id, {
      gcode: {
        mode: 'fill',
        lineSpacing: 5,
        fillStyle: 'crossHatch',
        fillAngle: 30,
        power: 500,
        speed: 1000,
        passes: 1,
      },
    })
    const crossed = buildToolpaths(
      {
        entities: doc.getEntities(),
        layers: doc.getLayers(),
        getEntity: (id) => doc.getEntity(id),
      },
      { flipY: false, optimizeOrder: false },
    )
    expect(crossed.cuts.length).toBeGreaterThan(vertical.cuts.length)
  })

  it('fill hatch keeps serpentine row order (not NN-scrambled)', () => {
    const doc = new CadDocument()
    const layer = doc.addLayer({ name: 'FillOrder' })
    doc.updateLayer(layer.id, {
      gcode: {
        mode: 'fill',
        lineSpacing: 2,
        fillStyle: 'bidirectional',
        fillAngle: 0,
        power: 500,
        speed: 1000,
        passes: 1,
      },
    })
    doc.add({
      id: createEntityId('poly'),
      type: 'polyline',
      layerId: layer.id,
      style: { fill: '#111' },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 20 },
        { x: 0, y: 20 },
      ],
    })
    const input = {
      entities: doc.getEntities(),
      layers: doc.getLayers(),
      getEntity: (id: ReturnType<typeof createEntityId>) => doc.getEntity(id),
    }
    // Raw scanline segments (no chain): Y of successive rows must be monotone.
    const raw = buildToolpaths(input, { flipY: false, optimizeOrder: false })
    const rowY = raw.cuts.map((c) => (c.points[0]!.y + c.points.at(-1)!.y) / 2)
    for (let i = 1; i < rowY.length; i++) {
      expect(rowY[i]!).toBeGreaterThanOrEqual(rowY[i - 1]! - 1e-6)
    }
    // Optimized fill: serpentine chain — one (or few) paths, starts on first row.
    const opt = buildToolpaths(input, { flipY: false, optimizeOrder: true })
    expect(opt.cuts.length).toBeLessThan(raw.cuts.length)
    expect(opt.cuts[0]!.points[0]!.y).toBeCloseTo(rowY[0]!, 5)
    // Empty travel should stay tiny vs cutting a hatch with NN jumps.
    expect(opt.totalLength - opt.cutLength).toBeLessThan(raw.cuts.length)
  })

  it('buildToolpaths orders cuts and reports progress lengths', () => {
    const doc = new CadDocument()
    const layer = doc.getDefaultLayerId()
    doc.add({
      id: createEntityId('a'),
      type: 'line',
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    })
    doc.add({
      id: createEntityId('b'),
      type: 'line',
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 100, y: 0 },
      end: { x: 110, y: 0 },
    })
    const plan = buildToolpaths(
      {
        entities: doc.getEntities(),
        layers: doc.getLayers(),
        getEntity: (id) => doc.getEntity(id),
      },
      { flipY: false, optimizeOrder: true },
    )
    expect(plan.cuts.length).toBe(2)
    expect(plan.cutLength).toBeCloseTo(20, 5)
    expect(plan.totalLength).toBeGreaterThan(plan.cutLength)
    expect(plan.motions.some((m) => m.kind === 'travel')).toBe(true)
  })

  it('optimizeOrder shortens empty travel vs document order', () => {
    const doc = new CadDocument()
    const layer = doc.getDefaultLayerId()
    // Intentionally bad document order: far, near, far.
    for (const [x0, x1] of [
      [80, 90],
      [0, 10],
      [90, 100],
    ] as const) {
      doc.add({
        id: createEntityId('line'),
        type: 'line',
        layerId: layer,
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        start: { x: x0, y: 0 },
        end: { x: x1, y: 0 },
      })
    }
    const input = {
      entities: doc.getEntities(),
      layers: doc.getLayers(),
      getEntity: (id: ReturnType<typeof createEntityId>) => doc.getEntity(id),
    }
    const naive = buildToolpaths(input, { flipY: false, optimizeOrder: false })
    const opt = buildToolpaths(input, { flipY: false, optimizeOrder: true })
    const naiveTravel = naive.totalLength - naive.cutLength
    const optTravel = opt.totalLength - opt.cutLength
    expect(opt.cutLength).toBeCloseTo(naive.cutLength, 5)
    expect(optTravel).toBeLessThan(naiveTravel)
  })

  it('includes image raster scanlines when samples are provided', () => {
    const doc = new CadDocument()
    const imgLayer = doc.addLayer({ name: 'Image' })
    doc.updateLayer(imgLayer.id, {
      gcode: {
        mode: 'image',
        lineSpacing: 1,
        fillStyle: 'bidirectional',
        fillAngle: 0,
        power: 600,
        speed: 1200,
        passes: 1,
      },
    })
    const id = createEntityId('image')
    doc.add({
      id,
      type: 'image',
      layerId: imgLayer.id,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      href: 'test.png',
      width: 4,
      height: 2,
      origin: { x: 0, y: 0 },
    })
    const luma = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255])
    const rasters = new Map([
      [
        id,
        {
          origin: { x: 0, y: 0 },
          width: 4,
          height: 2,
          cols: 4,
          rows: 2,
          luma,
        },
      ],
    ])
    const plan = buildToolpaths(
      {
        entities: doc.getEntities(),
        layers: doc.getLayers(),
        getEntity: (eid) => doc.getEntity(eid),
        imageRasters: rasters,
      },
      { flipY: false, optimizeOrder: false },
    )
    expect(plan.cuts.length).toBeGreaterThan(0)
    expect(plan.cutLength).toBeGreaterThan(0)
    // Dark row at full power; white row stays on the scanline at S0 (not travel).
    expect(plan.cuts.some((c) => c.power === 600)).toBe(true)
    expect(plan.cuts.some((c) => c.power === 0)).toBe(true)
    const gcode = exportGcode(
      {
        entities: doc.getEntities(),
        layers: doc.getLayers(),
        getEntity: (eid) => doc.getEntity(eid),
        imageRasters: rasters,
      },
      { flipY: false, decimals: 1 },
    )
    expect(gcode).toContain('M3')
    expect(gcode).toMatch(/S600/)
    expect(gcode).toMatch(/S0\b/)
    expect(gcode).toMatch(/G1 /)
  })
})

import { describe, expect, it } from 'vitest'
import { Camera2D } from '@cadkit/geometry'
import { DEFAULT_GRID_STYLE, buildGridGeometry, workAreaBounds } from './grid.js'
import { generateWorldGridAxes } from './ticks.js'

function screenExtents(vertices: Float32Array): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < vertices.length; i += 6) {
    const x = vertices[i]!
    const y = vertices[i + 1]!
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { minX, maxX, minY, maxY }
}

describe('buildGridGeometry', () => {
  it('returns empty when invisible', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    const g = buildGridGeometry(cam, 800, 600, 'mm', 'mm', { ...DEFAULT_GRID_STYLE, visible: false })
    expect(g.vertexCount).toBe(0)
  })

  it('emits major and minor screen-space lines', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const g = buildGridGeometry(cam, 800, 600, 'mm', 'mm')
    expect(g.vertexCount).toBeGreaterThan(0)
    expect(g.vertexCount).toBe(g.vertices.length / 6)
    expect(g.majorCount + g.minorCount).toBeGreaterThan(0)
  })

  it('page mode includes a fill without a forced edge border', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    cam.setCenter({ x: 50, y: 40, __space: 'world' })
    const g = buildGridGeometry(
      cam,
      800,
      600,
      'mm',
      'mm',
      DEFAULT_GRID_STYLE,
      { mode: 'page', width: 100, height: 80, originX: 0, originY: 0 },
    )
    expect(g.fillVertexCount).toBe(6)
    expect(g.pageBounds).toEqual(workAreaBounds({ mode: 'page', width: 100, height: 80, originX: 0, originY: 0 }))
    expect(g.vertexCount).toBeGreaterThan(0)

    // forceEnds=false: endpoints are not specially promoted to a page frame.
    const axes = generateWorldGridAxes(0, 100, 10, 50, false)
    expect(axes[0]?.world).toBeCloseTo(0)
    expect(axes[axes.length - 1]?.world).toBeCloseTo(100)
    expect(axes.filter((a) => a.major).map((a) => a.world)).toEqual([0, 50, 100])
  })

  it('page mode with grid hidden draws fill only (no border lines)', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    cam.setCenter({ x: 50, y: 40, __space: 'world' })
    const g = buildGridGeometry(
      cam,
      800,
      600,
      'mm',
      'mm',
      { ...DEFAULT_GRID_STYLE, visible: false },
      { mode: 'page', width: 100, height: 80, originX: 0, originY: 0 },
    )
    expect(g.fillVertexCount).toBe(6)
    expect(g.vertexCount).toBe(0)
  })

  it('page fill screen size tracks camera fit of work area', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 40)
    const g = buildGridGeometry(
      cam,
      800,
      600,
      'mm',
      'mm',
      DEFAULT_GRID_STYLE,
      { mode: 'page', width: 100, height: 100, originX: 0, originY: 0 },
    )
    const xs = g.fillVertices!.filter((_, i) => i % 6 === 0)
    const ys = g.fillVertices!.filter((_, i) => i % 6 === 1)
    const pageW = Math.max(...xs) - Math.min(...xs)
    const pageH = Math.max(...ys) - Math.min(...ys)
    // With 40px padding, page should occupy most of the shorter viewport axis.
    expect(pageW).toBeGreaterThan(400)
    expect(pageH).toBeGreaterThan(400)
    expect(g.vertexCount).toBeGreaterThan(16)
  })

  it('page grid stays inside the work area (not full viewport)', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 80 }, 40)
    const wa = { mode: 'page' as const, width: 100, height: 80, originX: 0, originY: 0 }
    const g = buildGridGeometry(cam, 800, 600, 'mm', 'mm', DEFAULT_GRID_STYLE, wa)
    const page = screenExtents(g.fillVertices!)
    const grid = screenExtents(g.vertices)
    expect(grid.minX).toBeGreaterThanOrEqual(page.minX - 0.5)
    expect(grid.maxX).toBeLessThanOrEqual(page.maxX + 0.5)
    expect(grid.minY).toBeGreaterThanOrEqual(page.minY - 0.5)
    expect(grid.maxY).toBeLessThanOrEqual(page.maxY + 0.5)
    // Must not span the whole canvas like unbounded mode.
    expect(grid.maxX - grid.minX).toBeLessThan(750)
    expect(grid.maxY - grid.minY).toBeLessThan(550)
  })

  it('page grid axes are anchored to work-area origin, not world zero', () => {
    const local = generateWorldGridAxes(30, 130, 10, 50, false, 30)
    expect(local.map((a) => a.world)).toEqual([30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130])
    // Major every 50 local units → world 30, 80, 130
    expect(local.filter((a) => a.major).map((a) => a.world)).toEqual([30, 80, 130])

    const globalAligned = generateWorldGridAxes(30, 130, 10, 50, false, 0)
    // Global majors hit world 50/100 — different from work-area-local majors.
    expect(globalAligned.filter((a) => a.major).map((a) => a.world)).toEqual([50, 100])
  })

  it('page grid omits perimeter lines so the page has no stroked border', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    cam.setCenter({ x: 50, y: 40, __space: 'world' })
    const wa = { mode: 'page' as const, width: 100, height: 80, originX: 0, originY: 0 }
    const g = buildGridGeometry(cam, 800, 600, 'mm', 'mm', DEFAULT_GRID_STYLE, wa)
    const page = screenExtents(g.fillVertices!)
    const grid = screenExtents(g.vertices)
    // Inner grid should be strictly inside the page fill (not sitting on the rim).
    expect(grid.minX).toBeGreaterThan(page.minX + 0.5)
    expect(grid.maxX).toBeLessThan(page.maxX - 0.5)
    expect(grid.minY).toBeGreaterThan(page.minY + 0.5)
    expect(grid.maxY).toBeLessThan(page.maxY - 0.5)
  })
})

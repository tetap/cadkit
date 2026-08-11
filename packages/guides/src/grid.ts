import type { Camera2D, LengthUnit } from '@cadkit/geometry'
import { createAABB, type AABB, type WorkAreaConfig } from '@cadkit/types'
import { buildWorkAreaGuideScale, generateGridLines, generateWorldGridAxes } from './ticks.js'

export interface GridStyle {
  minorColor: [number, number, number, number]
  majorColor: [number, number, number, number]
  visible: boolean
}

/** Light-canvas defaults: opaque greys with enough contrast on #fff (Figma/CAD-like). */
export const DEFAULT_GRID_STYLE: GridStyle = {
  minorColor: [0.78, 0.8, 0.84, 1], // #c7ccd6
  majorColor: [0.58, 0.62, 0.68, 1], // #949eae
  visible: true,
}

/** Dark-canvas grid (Editor theme=dark). */
export const DARK_GRID_STYLE: GridStyle = {
  minorColor: [0.22, 0.26, 0.32, 1],
  majorColor: [0.34, 0.4, 0.48, 1],
  visible: true,
}

export interface GridGeometry {
  /** Interleaved x,y,r,g,b,a line-list in screen space */
  vertices: Float32Array
  vertexCount: number
  majorCount: number
  minorCount: number
  /** Optional page fill as triangle-list (same vertex format) in screen space */
  fillVertices?: Float32Array
  fillVertexCount?: number
  /** World AABB of the page when mode=page */
  pageBounds?: AABB
}

export function workAreaBounds(workArea: WorkAreaConfig): AABB {
  return createAABB(
    workArea.originX,
    workArea.originY,
    workArea.originX + Math.max(0, workArea.width),
    workArea.originY + Math.max(0, workArea.height),
  )
}

/**
 * Build screen-space grid (+ optional page fill) for the current viewport.
 */
export function buildGridGeometry(
  camera: Camera2D,
  width: number,
  height: number,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  style: GridStyle = DEFAULT_GRID_STYLE,
  workArea?: WorkAreaConfig,
  pageFillColor: [number, number, number, number] = [1, 1, 1, 1],
): GridGeometry {
  if (!style.visible && !(workArea?.mode === 'page')) {
    return { vertices: new Float32Array(0), vertexCount: 0, majorCount: 0, minorCount: 0 }
  }

  const mode = workArea?.mode ?? 'unbounded'
  if (mode === 'page' && workArea) {
    return buildPageGridGeometry(
      camera,
      width,
      height,
      worldUnit,
      displayUnit,
      style,
      workArea,
      pageFillColor,
    )
  }
  if (!style.visible) {
    return { vertices: new Float32Array(0), vertexCount: 0, majorCount: 0, minorCount: 0 }
  }
  return buildUnboundedGridGeometry(camera, width, height, worldUnit, displayUnit, style)
}

function buildUnboundedGridGeometry(
  camera: Camera2D,
  width: number,
  height: number,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  style: GridStyle,
): GridGeometry {
  const xs = generateGridLines(camera, 'x', worldUnit, displayUnit, width)
  const ys = generateGridLines(camera, 'y', worldUnit, displayUnit, height)
  const data = new Float32Array((xs.length + ys.length) * 2 * 6)
  let o = 0
  let majorCount = 0
  let minorCount = 0

  const push = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: [number, number, number, number],
  ) => {
    const [r, g, b, a] = color
    data[o++] = x0
    data[o++] = y0
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
    data[o++] = x1
    data[o++] = y1
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
  }

  for (const line of xs) {
    const color = line.major ? style.majorColor : style.minorColor
    push(line.screen, 0, line.screen, height, color)
    if (line.major) majorCount++
    else minorCount++
  }
  for (const line of ys) {
    const color = line.major ? style.majorColor : style.minorColor
    push(0, line.screen, width, line.screen, color)
    if (line.major) majorCount++
    else minorCount++
  }

  return {
    vertices: data.subarray(0, o),
    vertexCount: o / 6,
    majorCount,
    minorCount,
  }
}

function buildPageGridGeometry(
  camera: Camera2D,
  width: number,
  height: number,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  style: GridStyle,
  workArea: WorkAreaConfig,
  pageFillColor: [number, number, number, number],
): GridGeometry {
  const page = workAreaBounds(workArea)
  const tl = camera.worldToScreen({ x: page.minX, y: page.minY, __space: 'world' })
  const br = camera.worldToScreen({ x: page.maxX, y: page.maxY, __space: 'world' })
  const pageLeft = Math.min(tl.x, br.x)
  const pageRight = Math.max(tl.x, br.x)
  const pageTop = Math.min(tl.y, br.y)
  const pageBottom = Math.max(tl.y, br.y)
  const pageW = page.maxX - page.minX
  const pageH = page.maxY - page.minY
  const pageScreenW = Math.max(1, pageRight - pageLeft)
  const pageScreenH = Math.max(1, pageBottom - pageTop)
  // Density from the work area's on-screen size (not the full viewport).
  const pageExtentWorld = Math.max(1e-12, Math.min(pageW, pageH))
  const pageExtentPx = Math.min(pageScreenW, pageScreenH)
  const guide = buildWorkAreaGuideScale(pageExtentWorld, pageExtentPx, worldUnit, displayUnit)
  // Axes locked to work-area origin — not global world-zero multiples.
  // forceEnds=false: do not stroke an extra page-frame border on the work-area edges.
  const ox = workArea.originX
  const oy = workArea.originY
  const xs = style.visible
    ? generateWorldGridAxes(page.minX, page.maxX, guide.minorWorld, guide.majorWorld, false, ox)
    : []
  const ys = style.visible
    ? generateWorldGridAxes(page.minY, page.maxY, guide.minorWorld, guide.majorWorld, false, oy)
    : []
  // Drop lines that sit on the work-area perimeter — page edge is the fill only.
  const onEdge = (world: number, a: number, b: number) =>
    Math.abs(world - a) <= 1e-9 || Math.abs(world - b) <= 1e-9
  const innerXs = xs.filter((line) => !onEdge(line.world, page.minX, page.maxX))
  const innerYs = ys.filter((line) => !onEdge(line.world, page.minY, page.maxY))

  const data = new Float32Array((innerXs.length + innerYs.length) * 2 * 6)
  let o = 0
  let majorCount = 0
  let minorCount = 0

  const pushScreen = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: [number, number, number, number],
  ) => {
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1)
    const maxY = Math.max(y0, y1)
    if (maxX < -1 || minX > width + 1 || maxY < -1 || minY > height + 1) return
    const [r, g, b, a] = color
    data[o++] = x0
    data[o++] = y0
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
    data[o++] = x1
    data[o++] = y1
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
  }

  // Keep stroke endpoints slightly inside the fill so the page rim is not a hard line.
  const rimInset = Math.min(1, pageScreenW * 0.02, pageScreenH * 0.02)
  const gridTop = pageTop + rimInset
  const gridBottom = pageBottom - rimInset
  const gridLeft = pageLeft + rimInset
  const gridRight = pageRight - rimInset

  for (const line of innerXs) {
    const s = camera.worldToScreen({ x: line.world, y: page.minY, __space: 'world' })
    const color = line.major ? style.majorColor : style.minorColor
    pushScreen(s.x, gridTop, s.x, gridBottom, color)
    if (line.major) majorCount++
    else minorCount++
  }
  for (const line of innerYs) {
    const s = camera.worldToScreen({ x: page.minX, y: line.world, __space: 'world' })
    const color = line.major ? style.majorColor : style.minorColor
    pushScreen(gridLeft, s.y, gridRight, s.y, color)
    if (line.major) majorCount++
    else minorCount++
  }

  const fill = new Float32Array(6 * 6)
  let fo = 0
  const put = (x: number, y: number) => {
    fill[fo++] = x
    fill[fo++] = y
    fill[fo++] = pageFillColor[0]
    fill[fo++] = pageFillColor[1]
    fill[fo++] = pageFillColor[2]
    fill[fo++] = pageFillColor[3]
  }
  put(pageLeft, pageTop)
  put(pageRight, pageTop)
  put(pageLeft, pageBottom)
  put(pageRight, pageTop)
  put(pageRight, pageBottom)
  put(pageLeft, pageBottom)

  return {
    vertices: data.subarray(0, o),
    vertexCount: o / 6,
    majorCount,
    minorCount,
    fillVertices: fill,
    fillVertexCount: 6,
    pageBounds: page,
  }
}

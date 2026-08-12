import type { RenderItem } from '@cadkit/scene'
import { isPaintVisible, parseColor } from './color.js'
import { isClosedRing } from './fill-pack.js'

/**
 * Painter ops in document stack order (back → front).
 * Fill and stroke of the same entity stay adjacent so a front layer's fill
 * covers a back layer's stroke (global fill-then-stroke would invert layers).
 */
export type DrawOp =
  | { kind: 'fill'; firstVertex: number; vertexCount: number }
  | { kind: 'stroke'; firstVertex: number; vertexCount: number }
  | { kind: 'rectStroke'; firstInstance: number; instanceCount: number }
  | { kind: 'image'; itemIndex: number }

export interface PackedDrawOrder {
  fillData: Float32Array
  fillVertexCount: number
  strokeData: Float32Array
  strokeVertexCount: number
  /** Compact AA-rect stroke instances: x,y,w,h,r,g,b,a per instance. */
  instanceData: Float32Array
  instanceCount: number
  /** Backing store for stroke floats (may be larger than strokeData). */
  strokeScratch: Float32Array
  ops: DrawOp[]
  uploadBytes: number
}

/**
 * Pack entity fills + strokes into GPU buffers and emit interleaved draw ops.
 * `items` must already be sorted by ascending zOrder (scene display list).
 */
export function packDrawOrder(
  items: readonly RenderItem[],
  strokeScratch?: Float32Array,
): PackedDrawOrder {
  let fillTris = 0
  let strokeSegs = 0
  let instances = 0
  for (const item of items) {
    if (item.kind === 'image' || item.kind === 'text') continue
    if (item.kind === 'instance') {
      if (isPaintVisible(item.fill)) fillTris += 2
      if (isPaintVisible(item.stroke)) instances += 1
      continue
    }
    if (isPaintVisible(item.fill) && isClosedRing(item.kind, item.coords)) {
      const n = uniqueRingCount(item.coords)
      if (n >= 3) fillTris += n - 2
    }
    if (isPaintVisible(item.stroke)) {
      if (item.kind === 'line') strokeSegs += 1
      else if (item.coords.length >= 4) strokeSegs += item.coords.length / 2 - 1
    }
  }

  const fillFloats = Math.max(fillTris * 3 * 6, 6)
  const strokeFloats = Math.max(strokeSegs * 2 * 6, 6)
  const instanceFloats = Math.max(instances * 8, 8)
  const fillData = new Float32Array(fillFloats)
  const instanceData = new Float32Array(instanceFloats)
  const strokeBuf =
    strokeScratch && strokeScratch.length >= strokeFloats
      ? strokeScratch
      : new Float32Array(Math.max(strokeFloats, strokeScratch?.length ?? 0, 6))

  const ops: DrawOp[] = []
  let fillO = 0
  let strokeO = 0
  let instO = 0
  let fillVertexCursor = 0
  let strokeVertexCursor = 0
  let instanceCursor = 0

  const pushFill = (vertexCount: number) => {
    if (vertexCount <= 0) return
    const last = ops[ops.length - 1]
    if (last?.kind === 'fill') last.vertexCount += vertexCount
    else ops.push({ kind: 'fill', firstVertex: fillVertexCursor, vertexCount })
    fillVertexCursor += vertexCount
  }

  const pushStroke = (vertexCount: number) => {
    if (vertexCount <= 0) return
    const last = ops[ops.length - 1]
    if (last?.kind === 'stroke') last.vertexCount += vertexCount
    else ops.push({ kind: 'stroke', firstVertex: strokeVertexCursor, vertexCount })
    strokeVertexCursor += vertexCount
  }

  const pushRectStroke = (count: number) => {
    if (count <= 0) return
    const last = ops[ops.length - 1]
    if (last?.kind === 'rectStroke') last.instanceCount += count
    else ops.push({ kind: 'rectStroke', firstInstance: instanceCursor, instanceCount: count })
    instanceCursor += count
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.kind === 'image') {
      ops.push({ kind: 'image', itemIndex: i })
      continue
    }
    if (item.kind === 'text') continue

    if (item.kind === 'instance' && item.coords.length >= 4) {
      const x = item.coords[0]!
      const y = item.coords[1]!
      const w = item.coords[2]!
      const h = item.coords[3]!
      if (isPaintVisible(item.fill)) {
        const before = fillO
        fillO = appendRectFill(fillData, fillO, x, y, w, h, item.fill!)
        pushFill((fillO - before) / 6)
      }
      if (isPaintVisible(item.stroke)) {
        const [r, g, b, a] = parseColor(item.stroke)
        instanceData[instO++] = x
        instanceData[instO++] = y
        instanceData[instO++] = w
        instanceData[instO++] = h
        instanceData[instO++] = r
        instanceData[instO++] = g
        instanceData[instO++] = b
        instanceData[instO++] = a
        pushRectStroke(1)
      }
      continue
    }

    if (isPaintVisible(item.fill) && isClosedRing(item.kind, item.coords)) {
      const before = fillO
      fillO = appendFillFan(fillData, fillO, item)
      pushFill((fillO - before) / 6)
    }

    if (isPaintVisible(item.stroke)) {
      const before = strokeO
      strokeO = appendStroke(strokeBuf, strokeO, item)
      pushStroke((strokeO - before) / 6)
    }
  }

  return {
    fillData: fillData.subarray(0, fillO),
    fillVertexCount: fillO / 6,
    strokeData: strokeBuf.subarray(0, strokeO),
    strokeVertexCount: strokeO / 6,
    instanceData: instanceData.subarray(0, instO),
    instanceCount: instO / 8,
    strokeScratch: strokeBuf,
    ops,
    uploadBytes: (fillO + strokeO + instO) * 4,
  }
}

function appendRectFill(
  data: Float32Array,
  o: number,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
): number {
  const [r, g, b, a] = parseColor(fill)
  const x1 = x + w
  const y1 = y + h
  // two triangles: (x,y)-(x1,y)-(x1,y1) and (x,y)-(x1,y1)-(x,y1)
  const verts = [x, y, x1, y, x1, y1, x, y, x1, y1, x, y1]
  for (let i = 0; i < verts.length; i += 2) {
    data[o++] = verts[i]!
    data[o++] = verts[i + 1]!
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
  }
  return o
}

function appendFillFan(data: Float32Array, o: number, item: RenderItem): number {
  const [r, g, b, a] = parseColor(item.fill!)
  const c = item.coords
  const n = uniqueRingCount(c)
  if (n < 3) return o
  const x0 = c[0]!
  const y0 = c[1]!
  for (let i = 1; i + 1 < n; i++) {
    const x1 = c[i * 2]!
    const y1 = c[i * 2 + 1]!
    const x2 = c[(i + 1) * 2]!
    const y2 = c[(i + 1) * 2 + 1]!
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
    data[o++] = x2
    data[o++] = y2
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
  }
  return o
}

function appendStroke(data: Float32Array, o: number, item: RenderItem): number {
  const [r, g, b, a] = parseColor(item.stroke)
  const c = item.coords
  if (item.kind === 'line' && c.length >= 4) {
    data[o++] = c[0]!
    data[o++] = c[1]!
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
    data[o++] = c[2]!
    data[o++] = c[3]!
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
    return o
  }
  for (let i = 0; i + 3 < c.length; i += 2) {
    data[o++] = c[i]!
    data[o++] = c[i + 1]!
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
    data[o++] = c[i + 2]!
    data[o++] = c[i + 3]!
    data[o++] = r
    data[o++] = g
    data[o++] = b
    data[o++] = a
  }
  return o
}

function uniqueRingCount(coords: ArrayLike<number>): number {
  let n = Math.floor(coords.length / 2)
  if (n >= 2) {
    const dx = coords[0]! - coords[(n - 1) * 2]!
    const dy = coords[1]! - coords[(n - 1) * 2 + 1]!
    if (dx * dx + dy * dy < 1e-12) n -= 1
  }
  return n
}

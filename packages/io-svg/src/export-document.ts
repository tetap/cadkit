import {
  resolveLayerAwarePaint,
  type Layer,
} from '@cadkit/document'
import {
  entityToOffsetContours,
  entityWorldBounds,
  resolveWorldMatrix,
  textEntityToLocalOutlines,
  transformPoint,
} from '@cadkit/geometry'
import type { Entity, EntityId, LayerId, Vec2 } from '@cadkit/types'
import { emptyAABB, expandAABB, isValidAABB } from '@cadkit/types'

export interface SvgDocumentExportInput {
  entities: readonly Entity[]
  layers?: readonly Layer[]
  getEntity?: (id: EntityId) => Entity | undefined
  /** Padding around content in document units. Default 2. */
  padding?: number
}

/**
 * Export document geometry as SVG matching canvas paint (layer line/fill mode,
 * world transforms, glyph outlines for text, pie wedges for arcs).
 */
export function exportSvgDocument(input: SvgDocumentExportInput): string {
  const lookup = input.getEntity ?? ((id: EntityId) => input.entities.find((e) => e.id === id))
  const layerById = new Map<LayerId, Layer>()
  for (const l of input.layers ?? []) layerById.set(l.id, l)
  const pad = input.padding ?? 2

  const box = emptyAABB()
  const drawn: Array<{
    d: string
    stroke: string
    fill: string
    strokeWidth: number
    markup?: string
  }> = []

  for (const e of input.entities) {
    if (e.type === 'group') continue
    if (e.style.visible === false) continue
    const layer = layerById.get(e.layerId)
    if (layer && layer.visible === false) continue

    const m = resolveWorldMatrix(e, lookup)
    const b = entityWorldBounds(e, m)
    if (isValidAABB(b)) {
      expandAABB(box, b.minX, b.minY)
      expandAABB(box, b.maxX, b.maxY)
    }

    const paint = resolveLayerAwarePaint(layer, e.style)
    const stroke = paint.stroke && paint.stroke !== 'none' ? paint.stroke : 'none'
    const fill = paint.fill && paint.fill !== 'none' ? paint.fill : 'none'
    const strokeWidth = paint.strokeWidth ?? 1

    if (e.type === 'image') {
      const [a, b0, c, d, ee, f] = m
      const t = `matrix(${a} ${b0} ${c} ${d} ${ee} ${f})`
      drawn.push({
        d: '',
        stroke: 'none',
        fill: 'none',
        strokeWidth: 0,
        markup: `<image href="${escapeAttr(e.href)}" x="${e.origin.x}" y="${e.origin.y}" width="${e.width}" height="${e.height}" transform="${t}" preserveAspectRatio="${e.preserveAspectRatio === false ? 'none' : 'xMidYMid meet'}" />`,
      })
      continue
    }

    // Prefer glyph outlines for text so SVG matches GPU vector text.
    if (e.type === 'text') {
      const outlines = textEntityToLocalOutlines(e)
      if (outlines.length) {
        for (const c of outlines) {
          const pts = c.points.map((p) => transformPoint(m, p))
          const d = ringToPath(pts, true)
          if (d) drawn.push({ d, stroke, fill, strokeWidth })
        }
        continue
      }
    }

    // Filled pie for open arcs / partial ellipses (matches canvas).
    if (fill !== 'none' && (e.type === 'arc' || (e.type === 'ellipse' && !isFullEllipse(e)))) {
      const pie = piePath(e, m)
      if (pie) {
        drawn.push({ d: pie, stroke, fill, strokeWidth })
        continue
      }
    }

    const contours = entityToOffsetContours(e, lookup)
    for (const c of contours) {
      const d = ringToPath(c.points, c.closed)
      if (!d) continue
      let full = d
      for (const hole of c.holes ?? []) {
        const hd = ringToPath(hole, true)
        if (hd) full += ` ${hd}`
      }
      drawn.push({
        d: full,
        stroke,
        fill: c.holes?.length && fill !== 'none' ? fill : fill,
        strokeWidth,
      })
    }
  }

  if (!isValidAABB(box)) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"/>\n`
  }

  const minX = box.minX - pad
  const minY = box.minY - pad
  const w = Math.max(1e-3, box.maxX - box.minX + pad * 2)
  const h = Math.max(1e-3, box.maxY - box.minY + pad * 2)

  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}" height="${fmt(h)}" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(w)} ${fmt(h)}">`,
  ]
  for (const item of drawn) {
    if (item.markup) {
      parts.push(item.markup)
      continue
    }
    if (!item.d) continue
    const fillRule = item.d.includes('M') && item.d.split('M').length > 2 ? ' fill-rule="evenodd"' : ''
    parts.push(
      `<path d="${item.d}" stroke="${escapeAttr(item.stroke)}" fill="${escapeAttr(item.fill)}" stroke-width="${item.strokeWidth}" stroke-linejoin="round" stroke-linecap="round"${fillRule} />`,
    )
  }
  parts.push('</svg>')
  return `${parts.join('\n')}\n`
}

function isFullEllipse(e: Extract<Entity, { type: 'ellipse' }>): boolean {
  let sweep = e.endAngle - e.startAngle
  while (sweep <= 0) sweep += Math.PI * 2
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2
  return sweep >= Math.PI * 2 - 1e-3
}

function piePath(entity: Entity, m: ReturnType<typeof resolveWorldMatrix>): string | null {
  const xf = (p: Vec2) => transformPoint(m, p)
  if (entity.type === 'arc') {
    let sweep = entity.endAngle - entity.startAngle
    while (sweep <= 0) sweep += Math.PI * 2
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2
    const count = Math.max(16, Math.ceil(48 * (sweep / (Math.PI * 2))))
    const pts: Vec2[] = [xf(entity.center)]
    for (let i = 0; i <= count; i++) {
      const a = entity.startAngle + (sweep * i) / count
      pts.push(
        xf({
          x: entity.center.x + entity.radius * Math.cos(a),
          y: entity.center.y + entity.radius * Math.sin(a),
        }),
      )
    }
    pts.push(xf(entity.center))
    return ringToPath(pts, true)
  }
  if (entity.type === 'ellipse') {
    let sweep = entity.endAngle - entity.startAngle
    while (sweep <= 0) sweep += Math.PI * 2
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2
    const count = Math.max(16, Math.ceil(48 * (sweep / (Math.PI * 2))))
    const cosR = Math.cos(entity.rotation)
    const sinR = Math.sin(entity.rotation)
    const pts: Vec2[] = [xf(entity.center)]
    for (let i = 0; i <= count; i++) {
      const a = entity.startAngle + (sweep * i) / count
      const lx = entity.radiusX * Math.cos(a)
      const ly = entity.radiusY * Math.sin(a)
      pts.push(
        xf({
          x: entity.center.x + lx * cosR - ly * sinR,
          y: entity.center.y + lx * sinR + ly * cosR,
        }),
      )
    }
    pts.push(xf(entity.center))
    return ringToPath(pts, true)
  }
  return null
}

function ringToPath(points: readonly Vec2[], closed: boolean): string {
  if (points.length < 2) return ''
  let d = `M${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`
  for (let i = 1; i < points.length; i++) {
    d += ` L${fmt(points[i]!.x)} ${fmt(points[i]!.y)}`
  }
  if (closed) d += ' Z'
  return d
}

function fmt(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 1000) / 1000).toString() : '0'
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

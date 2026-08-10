/**
 * SVG import with `svg-pathdata` for robust path command expansion
 * (https://github.com/nfroidure/svg-pathdata).
 *
 * Uses DOMParser when available; otherwise a tag extractor that still expands
 * path / line / rect / circle / ellipse / poly (works in Node & workers).
 */

import { SVGPathData } from 'svg-pathdata'
import { layoutArcText } from '@cadkit/geometry'
import {
  type Entity,
  type EntityStyle,
  type LineEntity,
  type BezierEntity,
  type PolylineEntity,
  type PathEntity,
  type Vec2,
  createEntityId,
  createLayerId,
  IDENTITY_TRANSFORM,
} from '@cadkit/types'

export interface ImportWarning {
  code: string
  message: string
  path?: string
}

export interface SvgImportResult {
  entities: Entity[]
  warnings: ImportWarning[]
}

export interface SvgImportOptions {
  signal?: AbortSignal
  layerId?: ReturnType<typeof createLayerId>
  /** When true, expand path curves into polylines / beziers for editing */
  expandPaths?: boolean
}

type Inherited = {
  stroke?: string
  fill?: string
  transform: string
}

export async function parseSvg(source: string, options: SvgImportOptions = {}): Promise<SvgImportResult> {
  const warnings: ImportWarning[] = []
  const entities: Entity[] = []
  const layerId = options.layerId ?? createLayerId('svg')
  const expandPaths = options.expandPaths ?? true

  if (typeof DOMParser === 'undefined') {
    return parseWithoutDom(source, layerId, expandPaths, warnings, options.signal)
  }

  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    warnings.push({ code: 'SVG_PARSE_ERROR', message: parseError.textContent ?? 'parse error' })
    return { entities, warnings }
  }

  const walk = (el: Element, inherited: Inherited) => {
    options.signal?.throwIfAborted()
    const tag = el.tagName.toLowerCase()
    const localTransform = el.getAttribute('transform')
    const transform = localTransform
      ? `${inherited.transform} ${localTransform}`.trim()
      : inherited.transform
    const style: EntityStyle = {
      stroke: el.getAttribute('stroke') ?? inherited.stroke ?? '#32cd79',
      strokeWidth: Number(el.getAttribute('stroke-width') ?? 1),
      fill: el.getAttribute('fill') ?? inherited.fill,
    }
    const nextInherited: Inherited = {
      stroke: style.stroke,
      fill: style.fill,
      transform,
    }

    pushShape(tag, (name) => el.getAttribute(name), style, transform, layerId, expandPaths, entities, warnings)

    if (tag === 'text') {
      entities.push({
        id: createEntityId('text'),
        type: 'text',
        layerId,
        style,
        transform: parseTransform(transform),
        version: 1,
        content: el.textContent ?? '',
        position: { x: numAttr(el, 'x'), y: numAttr(el, 'y') },
        fontFamily: el.getAttribute('font-family') ?? 'sans-serif',
        fontSize: numAttr(el, 'font-size') || 12,
      })
    } else if (tag === 'image') {
      const href =
        el.getAttribute('href') ||
        el.getAttribute('xlink:href') ||
        el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        ''
      if (!href) {
        warnings.push({ code: 'SVG_PARTIAL', message: '<image> missing href', path: transform })
      } else {
        // Coordinates are SVG user units (1 uu = 1pt @ 72 DPI). Editor.importSvg
        // scales the whole graph into document world units (typically mm).
        const x = numAttr(el, 'x')
        const y = numAttr(el, 'y')
        const w = numAttr(el, 'width') || 1
        const h = numAttr(el, 'height') || 1
        entities.push({
          id: createEntityId('image'),
          type: 'image',
          layerId,
          style,
          transform: parseTransform(transform),
          version: 1,
          href,
          width: w,
          height: h,
          origin: { x, y },
          preserveAspectRatio: el.getAttribute('preserveAspectRatio') !== 'none',
          naturalWidth: w,
          naturalHeight: h,
        })
      }
    } else if (tag === 'use' || tag === 'filter' || tag === 'mask') {
      warnings.push({
        code: 'SVG_PARTIAL',
        message: `Unsupported or partial: <${tag}>`,
        path: transform,
      })
    }

    for (const child of Array.from(el.children)) walk(child, nextInherited)
  }

  const root = doc.documentElement
  if (root) walk(root, { transform: '' })
  return { entities, warnings }
}

export function exportSvg(entities: Entity[], width = 800, height = 600): string {
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  ]
  for (const e of entities) {
    if (e.type === 'line') {
      parts.push(
        `<line x1="${e.start.x}" y1="${e.start.y}" x2="${e.end.x}" y2="${e.end.y}" stroke="${e.style.stroke ?? '#000'}" stroke-width="${e.style.strokeWidth ?? 1}" />`,
      )
    } else if (e.type === 'circle') {
      parts.push(
        `<circle cx="${e.center.x}" cy="${e.center.y}" r="${e.radius}" stroke="${e.style.stroke ?? '#000'}" fill="none" />`,
      )
    } else if (e.type === 'path') {
      parts.push(`<path d="${escapeAttr(e.d)}" stroke="${e.style.stroke ?? '#000'}" fill="none" />`)
    } else if (e.type === 'polyline') {
      const pts = e.points.map((p) => `${p.x},${p.y}`).join(' ')
      parts.push(
        e.closed
          ? `<polygon points="${pts}" stroke="${e.style.stroke ?? '#000'}" fill="none" />`
          : `<polyline points="${pts}" stroke="${e.style.stroke ?? '#000'}" fill="none" />`,
      )
    } else if (e.type === 'bezier') {
      const [p0, p1, p2, p3] = e.points
      if (p0 && p1 && p2 && p3) {
        parts.push(
          `<path d="M${p0.x} ${p0.y} C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}" stroke="${e.style.stroke ?? '#000'}" fill="none" />`,
        )
      }
    } else if (e.type === 'text') {
      if (e.path?.kind === 'arc') {
        const poses = layoutArcText(
          e.content,
          e.fontSize,
          e.position,
          e.path,
          e.widthFactor ?? 1,
        )
        for (const g of poses) {
          if (g.char === ' ') continue
          const deg = (g.rotation * 180) / Math.PI
          parts.push(
            `<text x="${g.x}" y="${g.y}" text-anchor="middle" font-family="${escapeAttr(e.fontFamily)}" font-size="${e.fontSize}" transform="rotate(${deg} ${g.x} ${g.y})">${escapeXml(g.char)}</text>`,
          )
        }
      } else {
        const lines = e.content.split(/\r?\n/u)
        const anchor = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'
        const content =
          lines.length === 1
            ? escapeXml(lines[0] ?? '')
            : lines
                .map(
                  (line, index) =>
                    `<tspan x="${e.position.x}" dy="${index === 0 ? 0 : '1em'}">${escapeXml(line || ' ')}</tspan>`,
                )
                .join('')
        parts.push(
          `<text x="${e.position.x}" y="${e.position.y}" text-anchor="${anchor}" font-family="${escapeAttr(e.fontFamily)}" font-size="${e.fontSize}">${content}</text>`,
        )
      }
    } else if (e.type === 'image') {
      const [a, b, c, d, ee, f] = e.transform
      const t =
        a !== 1 || b !== 0 || c !== 0 || d !== 1 || ee !== 0 || f !== 0
          ? ` transform="matrix(${a} ${b} ${c} ${d} ${ee} ${f})"`
          : ''
      const par = e.preserveAspectRatio === false ? 'none' : 'xMidYMid meet'
      parts.push(
        `<image href="${escapeAttr(e.href)}" x="${e.origin.x}" y="${e.origin.y}" width="${e.width}" height="${e.height}" preserveAspectRatio="${par}"${t} />`,
      )
    }
  }
  parts.push('</svg>')
  return parts.join('\n')
}

function pushShape(
  tag: string,
  getAttr: (name: string) => string | null,
  style: EntityStyle,
  transform: string,
  layerId: ReturnType<typeof createLayerId>,
  expandPaths: boolean,
  entities: Entity[],
  warnings: ImportWarning[],
): void {
  if (tag === 'line') {
    entities.push(
      lineEntity(
        layerId,
        Number(getAttr('x1') ?? 0),
        Number(getAttr('y1') ?? 0),
        Number(getAttr('x2') ?? 0),
        Number(getAttr('y2') ?? 0),
        style,
        transform,
      ),
    )
  } else if (tag === 'polyline' || tag === 'polygon') {
    const pts = parsePoints(getAttr('points') ?? '')
    const poly: PolylineEntity = {
      id: createEntityId('polyline'),
      type: 'polyline',
      layerId,
      style,
      transform: parseTransform(transform),
      version: 1,
      points: pts,
      closed: tag === 'polygon',
    }
    entities.push(poly)
  } else if (tag === 'path') {
    const d = getAttr('d') ?? ''
    if (expandPaths) {
      entities.push(...expandPath(d, layerId, style, transform, warnings))
    } else {
      const path: PathEntity = {
        id: createEntityId('path'),
        type: 'path',
        layerId,
        style,
        transform: parseTransform(transform),
        version: 1,
        d,
      }
      entities.push(path)
    }
  } else if (tag === 'rect') {
    const x = Number(getAttr('x') ?? 0)
    const y = Number(getAttr('y') ?? 0)
    const w = Number(getAttr('width') ?? 0)
    const h = Number(getAttr('height') ?? 0)
    entities.push({
      id: createEntityId('polyline'),
      type: 'polyline',
      layerId,
      style,
      transform: parseTransform(transform),
      version: 1,
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      closed: true,
    })
  } else if (tag === 'circle') {
    entities.push({
      id: createEntityId('circle'),
      type: 'circle',
      layerId,
      style,
      transform: parseTransform(transform),
      version: 1,
      center: { x: Number(getAttr('cx') ?? 0), y: Number(getAttr('cy') ?? 0) },
      radius: Number(getAttr('r') ?? 0),
    })
  } else if (tag === 'ellipse') {
    entities.push({
      id: createEntityId('ellipse'),
      type: 'ellipse',
      layerId,
      style,
      transform: parseTransform(transform),
      version: 1,
      center: { x: Number(getAttr('cx') ?? 0), y: Number(getAttr('cy') ?? 0) },
      radiusX: Number(getAttr('rx') ?? 0),
      radiusY: Number(getAttr('ry') ?? 0),
      rotation: 0,
      startAngle: 0,
      endAngle: Math.PI * 2,
    })
  }
}

function parseWithoutDom(
  source: string,
  layerId: ReturnType<typeof createLayerId>,
  expandPaths: boolean,
  warnings: ImportWarning[],
  signal?: AbortSignal,
): SvgImportResult {
  const entities: Entity[] = []
  const re = /<(line|rect|circle|ellipse|path|polyline|polygon|image)\b([^>]*)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    signal?.throwIfAborted()
    const tag = m[1]!.toLowerCase()
    const attrStr = m[2] ?? ''
    const attrs = new Map<string, string>()
    const attrRe = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
    let am: RegExpExecArray | null
    while ((am = attrRe.exec(attrStr))) {
      attrs.set(am[1]!.toLowerCase(), am[2] ?? am[3] ?? am[4] ?? '')
    }
    const getAttr = (name: string) => attrs.get(name.toLowerCase()) ?? null
    const style: EntityStyle = {
      stroke: getAttr('stroke') ?? '#32cd79',
      strokeWidth: Number(getAttr('stroke-width') ?? 1),
      fill: getAttr('fill') ?? undefined,
    }
    if (tag === 'image') {
      const href = getAttr('href') || getAttr('xlink:href') || ''
      if (!href) {
        warnings.push({ code: 'SVG_PARTIAL', message: '<image> missing href' })
        continue
      }
      entities.push({
        id: createEntityId('image'),
        type: 'image',
        layerId,
        style,
        transform: parseTransform(getAttr('transform') ?? ''),
        version: 1,
        href,
        width: Number(getAttr('width') ?? 1) || 1,
        height: Number(getAttr('height') ?? 1) || 1,
        origin: { x: Number(getAttr('x') ?? 0), y: Number(getAttr('y') ?? 0) },
        preserveAspectRatio: getAttr('preserveaspectratio') !== 'none',
        naturalWidth: Number(getAttr('width') ?? 1) || 1,
        naturalHeight: Number(getAttr('height') ?? 1) || 1,
      })
      continue
    }
    pushShape(tag, getAttr, style, getAttr('transform') ?? '', layerId, expandPaths, entities, warnings)
  }
  warnings.push({
    code: 'SVG_FALLBACK',
    message: 'DOMParser unavailable; used tag extractor with path expansion',
  })
  return { entities, warnings }
}

function expandPath(
  d: string,
  layerId: ReturnType<typeof createLayerId>,
  style: EntityStyle,
  transform: string,
  warnings: ImportWarning[],
): Entity[] {
  const out: Entity[] = []
  try {
    const abs = new SVGPathData(d).toAbs()
    let cx = 0
    let cy = 0
    let sub: Vec2[] = []

    const flushPoly = (closed: boolean) => {
      if (sub.length >= 2) {
        const poly: PolylineEntity = {
          id: createEntityId('polyline'),
          type: 'polyline',
          layerId,
          style,
          transform: parseTransform(transform),
          version: 1,
          points: sub,
          closed,
        }
        out.push(poly)
      }
      sub = []
    }

    for (const cmd of abs.commands) {
      switch (cmd.type) {
        case SVGPathData.MOVE_TO:
          flushPoly(false)
          cx = cmd.x
          cy = cmd.y
          sub = [{ x: cx, y: cy }]
          break
        case SVGPathData.LINE_TO:
          cx = cmd.x
          cy = cmd.y
          sub.push({ x: cx, y: cy })
          break
        case SVGPathData.HORIZ_LINE_TO:
          cx = cmd.x
          sub.push({ x: cx, y: cy })
          break
        case SVGPathData.VERT_LINE_TO:
          cy = cmd.y
          sub.push({ x: cx, y: cy })
          break
        case SVGPathData.CURVE_TO: {
          const bezier: BezierEntity = {
            id: createEntityId('bezier'),
            type: 'bezier',
            layerId,
            style,
            transform: parseTransform(transform),
            version: 1,
            points: [
              { x: cx, y: cy },
              { x: cmd.x1, y: cmd.y1 },
              { x: cmd.x2, y: cmd.y2 },
              { x: cmd.x, y: cmd.y },
            ],
          }
          out.push(bezier)
          cx = cmd.x
          cy = cmd.y
          if (sub.length) sub.push({ x: cx, y: cy })
          break
        }
        case SVGPathData.QUAD_TO: {
          const x1 = cx + (2 / 3) * (cmd.x1 - cx)
          const y1 = cy + (2 / 3) * (cmd.y1 - cy)
          const x2 = cmd.x + (2 / 3) * (cmd.x1 - cmd.x)
          const y2 = cmd.y + (2 / 3) * (cmd.y1 - cmd.y)
          const bezier: BezierEntity = {
            id: createEntityId('bezier'),
            type: 'bezier',
            layerId,
            style,
            transform: parseTransform(transform),
            version: 1,
            points: [
              { x: cx, y: cy },
              { x: x1, y: y1 },
              { x: x2, y: y2 },
              { x: cmd.x, y: cmd.y },
            ],
          }
          out.push(bezier)
          cx = cmd.x
          cy = cmd.y
          if (sub.length) sub.push({ x: cx, y: cy })
          break
        }
        case SVGPathData.CLOSE_PATH:
          flushPoly(true)
          break
        default:
          warnings.push({
            code: 'SVG_PATH_CMD',
            message: `Unhandled path command type ${cmd.type}`,
          })
      }
    }
    flushPoly(false)
  } catch (err) {
    warnings.push({
      code: 'SVG_PATH_ERROR',
      message: err instanceof Error ? err.message : String(err),
    })
    out.push({
      id: createEntityId('path'),
      type: 'path',
      layerId,
      style,
      transform: parseTransform(transform),
      version: 1,
      d,
    })
  }
  return out
}

function lineEntity(
  layerId: ReturnType<typeof createLayerId>,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: EntityStyle,
  transform: string,
): LineEntity {
  return {
    id: createEntityId('line'),
    type: 'line',
    layerId,
    style,
    transform: parseTransform(transform),
    version: 1,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
  }
}

function parseTransform(raw: string): typeof IDENTITY_TRANSFORM | [number, number, number, number, number, number] {
  if (!raw) return IDENTITY_TRANSFORM
  const matrix =
    /matrix\(\s*([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)\s*\)/.exec(
      raw,
    )
  if (matrix) {
    return [
      Number(matrix[1]),
      Number(matrix[2]),
      Number(matrix[3]),
      Number(matrix[4]),
      Number(matrix[5]),
      Number(matrix[6]),
    ]
  }
  const translate = /translate\(\s*([-\d.eE]+)(?:[,\s]+([-\d.eE]+))?\s*\)/.exec(raw)
  if (translate) {
    return [1, 0, 0, 1, Number(translate[1]), Number(translate[2] ?? 0)]
  }
  return IDENTITY_TRANSFORM
}

function numAttr(el: Element, attr: string): number {
  return Number(el.getAttribute(attr) ?? 0)
}

function parsePoints(raw: string): Vec2[] {
  return raw
    .trim()
    .split(/[\s,]+/)
    .reduce<Vec2[]>((acc, part, i, arr) => {
      if (i % 2 === 0 && i + 1 < arr.length) acc.push({ x: Number(part), y: Number(arr[i + 1]) })
      return acc
    }, [])
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeXml(s).replace(/"/g, '&quot;')
}

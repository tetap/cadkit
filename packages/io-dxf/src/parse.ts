/**
 * DXF import powered by `dxf-render/parser` (https://github.com/arbaev/dxf-kit).
 * Maps a broad entity set into CADKit entities with unit scaling.
 */
import { parseDxf } from 'dxf-render/parser'
import {
  type Entity,
  type ArcEntity,
  type CircleEntity,
  type EllipseEntity,
  type LineEntity,
  type NurbsEntity,
  type PolylineEntity,
  type TextEntity,
  type BlockInstanceEntity,
  createEntityId,
  createLayerId,
  createBlockId,
  IDENTITY_TRANSFORM,
} from '@cadkit/types'
import {
  DXF_INSUNITS_TO_MM,
  MM_PER_UNIT,
  dxfInsUnitsToLengthUnit,
  optimizeImportPaths,
  type LengthUnit,
  type OptimizeImportPathsOptions,
} from '@cadkit/geometry'

export interface DxfWarning {
  code: string
  message: string
}

export interface DxfImportChunk {
  entities: Entity[]
  progress: number
  warnings: DxfWarning[]
  documentUnit?: LengthUnit
}

export interface DxfImportOptions {
  signal?: AbortSignal
  chunkSize?: number
  maxEntities?: number
  /** Convert DXF coordinates into this document unit (default mm) */
  targetUnit?: LengthUnit
  /**
   * Weld fragmented LINE / open POLYLINE after parse (xTool-style endpoint merge).
   * Default true. Set false to keep 1:1 entity mapping.
   */
  optimize?: boolean
  /** Options for path welding / collinear simplify when optimize is enabled. */
  optimizeOptions?: OptimizeImportPathsOptions
}

type DxfEntity = {
  type: string
  layer?: string
  handle?: number | string
  vertices?: Array<{ x: number; y: number; z?: number }>
  center?: { x: number; y: number; z?: number }
  radius?: number
  startAngle?: number
  endAngle?: number
  majorAxisEndPoint?: { x: number; y: number; z?: number }
  axisRatio?: number
  startParam?: number
  endParam?: number
  controlPoints?: Array<{ x: number; y: number; z?: number }>
  degreeOfSplineCurve?: number
  knotValues?: number[]
  text?: string
  string?: string
  height?: number
  startPoint?: { x: number; y: number; z?: number }
  insertionPoint?: { x: number; y: number; z?: number }
  name?: string
  xScale?: number
  yScale?: number
  rotation?: number
  shape?: boolean
  color?: number
}

/**
 * Stream-ish importer: parse full DXF via dxf-render, then yield entity chunks.
 */
export async function* importDxf(
  source: string | ReadableStream<Uint8Array>,
  options: DxfImportOptions = {},
): AsyncGenerator<DxfImportChunk> {
  const text = typeof source === 'string' ? source : await readStream(source, options.signal)
  options.signal?.throwIfAborted()

  let data: { header?: { $INSUNITS?: number }; entities?: DxfEntity[] }
  const warnings: DxfWarning[] = []
  try {
    data = parseDxf(text) as typeof data
  } catch (err) {
    warnings.push({
      code: 'DXF_PARSE_ERROR',
      message: err instanceof Error ? err.message : String(err),
    })
    yield { entities: [], progress: 1, warnings }
    return
  }

  const ins = data.header?.$INSUNITS ?? 0
  const documentUnit = dxfInsUnitsToLengthUnit(ins)
  const target = options.targetUnit ?? 'mm'
  const scale = unitScale(ins, target)
  const layerId = createLayerId('0')
  const chunkSize = options.chunkSize ?? 2000
  const maxEntities = options.maxEntities ?? 10_000_000
  const raw = data.entities ?? []
  const doOptimize = options.optimize !== false

  // Map everything first so endpoint welding can see the full line graph.
  const mappedAll: Entity[] = []
  for (let i = 0; i < raw.length; i++) {
    options.signal?.throwIfAborted()
    const mapped = mapEntity(raw[i]!, layerId, scale, warnings)
    if (!mapped) continue
    mappedAll.push(mapped)
    if (mappedAll.length >= maxEntities) {
      warnings.push({ code: 'DXF_LIMIT', message: `Stopped at maxEntities=${maxEntities}` })
      break
    }
  }

  let entities = mappedAll
  if (doOptimize && mappedAll.length) {
    options.signal?.throwIfAborted()
    const { entities: optimized, stats } = optimizeImportPaths(mappedAll, options.optimizeOptions)
    entities = optimized
    if (stats.before > stats.after) {
      warnings.push({
        code: 'DXF_OPTIMIZE',
        message: `Merged linework ${stats.before} → ${stats.after} paths (${stats.mergedGroups} groups, ${stats.closed} closed)`,
      })
    }
  }

  for (let i = 0; i < entities.length; i += chunkSize) {
    options.signal?.throwIfAborted()
    const chunk = entities.slice(i, i + chunkSize)
    const done = Math.min(i + chunkSize, entities.length)
    yield {
      entities: chunk,
      progress: entities.length ? done / entities.length : 1,
      warnings: i === 0 ? warnings.splice(0) : [],
      documentUnit,
    }
  }

  if (entities.length === 0 && warnings.length) {
    yield { entities: [], progress: 1, warnings, documentUnit }
  }
}

export async function importDxfAll(
  source: string | ReadableStream<Uint8Array>,
  options: DxfImportOptions = {},
): Promise<{ entities: Entity[]; warnings: DxfWarning[]; documentUnit?: LengthUnit }> {
  const entities: Entity[] = []
  const warnings: DxfWarning[] = []
  let documentUnit: LengthUnit | undefined
  for await (const chunk of importDxf(source, options)) {
    entities.push(...chunk.entities)
    warnings.push(...chunk.warnings)
    documentUnit = chunk.documentUnit ?? documentUnit
  }
  return { entities, warnings, documentUnit }
}

function unitScale(insUnits: number, target: LengthUnit): number {
  const mm = DXF_INSUNITS_TO_MM[insUnits] ?? 0
  if (!mm) return 1 // unitless → keep raw numbers
  return mm / MM_PER_UNIT[target]
}

function mapEntity(
  e: DxfEntity,
  layerId: ReturnType<typeof createLayerId>,
  scale: number,
  warnings: DxfWarning[],
): Entity | null {
  const style = { stroke: colorToHex(e.color) ?? '#32cd79', strokeWidth: 1 }
  const s = (n: number) => n * scale

  switch (e.type) {
    case 'LINE': {
      const a = e.vertices?.[0]
      const b = e.vertices?.[1]
      if (!a || !b) return null
      const line: LineEntity = {
        id: createEntityId('line'),
        type: 'line',
        layerId,
        style,
        transform: IDENTITY_TRANSFORM,
        version: 1,
        start: { x: s(a.x), y: s(a.y) },
        end: { x: s(b.x), y: s(b.y) },
      }
      return line
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const pts = (e.vertices ?? []).map((v) => ({ x: s(v.x), y: s(v.y) }))
      if (pts.length < 2) return null
      const poly: PolylineEntity = {
        id: createEntityId('polyline'),
        type: 'polyline',
        layerId,
        style,
        transform: IDENTITY_TRANSFORM,
        version: 1,
        points: pts,
        closed: !!e.shape,
      }
      return poly
    }
    case 'CIRCLE': {
      if (!e.center || e.radius == null) return null
      const circle: CircleEntity = {
        id: createEntityId('circle'),
        type: 'circle',
        layerId,
        style,
        transform: IDENTITY_TRANSFORM,
        version: 1,
        center: { x: s(e.center.x), y: s(e.center.y) },
        radius: s(e.radius),
      }
      return circle
    }
    case 'ARC': {
      if (!e.center || e.radius == null || e.startAngle == null || e.endAngle == null) return null
      const arc: ArcEntity = {
        id: createEntityId('arc'),
        type: 'arc',
        layerId,
        style,
        transform: IDENTITY_TRANSFORM,
        version: 1,
        center: { x: s(e.center.x), y: s(e.center.y) },
        radius: s(e.radius),
        // dxf-render already provides radians
        startAngle: e.startAngle,
        endAngle: e.endAngle,
      }
      return arc
    }
    case 'ELLIPSE': {
      if (!e.center || !e.majorAxisEndPoint || e.axisRatio == null) return null
      const mx = e.majorAxisEndPoint.x
      const my = e.majorAxisEndPoint.y
      const radiusX = Math.hypot(mx, my)
      const radiusY = radiusX * e.axisRatio
      const rotation = Math.atan2(my, mx)
      const ellipse: EllipseEntity = {
        id: createEntityId('ellipse'),
        type: 'ellipse',
        layerId,
        style,
        transform: IDENTITY_TRANSFORM,
        version: 1,
        center: { x: s(e.center.x), y: s(e.center.y) },
        radiusX: s(radiusX),
        radiusY: s(radiusY),
        rotation,
        startAngle: e.startParam ?? 0,
        endAngle: e.endParam ?? Math.PI * 2,
      }
      return ellipse
    }
    case 'SPLINE': {
      const cps = (e.controlPoints ?? []).map((p) => ({ x: s(p.x), y: s(p.y) }))
      if (cps.length < 2) return null
      const nurbs: NurbsEntity = {
        id: createEntityId('nurbs'),
        type: 'nurbs',
        layerId,
        style,
        transform: IDENTITY_TRANSFORM,
        version: 1,
        degree: e.degreeOfSplineCurve ?? 3,
        controlPoints: cps,
        knots: e.knotValues ?? [],
      }
      return nurbs
    }
    case 'TEXT':
    case 'MTEXT': {
      const content = e.text ?? e.string ?? ''
      const pos = e.startPoint ?? e.insertionPoint ?? { x: 0, y: 0 }
      const text: TextEntity = {
        id: createEntityId('text'),
        type: 'text',
        layerId,
        style: { ...style, stroke: '#222222' },
        transform: IDENTITY_TRANSFORM,
        version: 1,
        content,
        position: { x: s(pos.x), y: s(pos.y) },
        fontFamily: 'sans-serif',
        fontSize: s(e.height ?? 2.5),
      }
      return text
    }
    case 'INSERT': {
      const pos = e.insertionPoint ?? { x: 0, y: 0 }
      const inst: BlockInstanceEntity = {
        id: createEntityId('insert'),
        type: 'blockInstance',
        layerId,
        style,
        transform: IDENTITY_TRANSFORM,
        version: 1,
        blockId: createBlockId(e.name ?? 'block'),
        insertion: { x: s(pos.x), y: s(pos.y) },
        scale: { x: e.xScale ?? 1, y: e.yScale ?? 1 },
        rotation: ((e.rotation ?? 0) * Math.PI) / 180,
      }
      warnings.push({
        code: 'DXF_INSERT',
        message: `INSERT ${e.name ?? '?'} mapped as blockInstance (definition expand pending)`,
      })
      return inst
    }
    case 'POINT':
    case 'XLINE':
    case 'RAY':
    case 'SOLID':
    case '3DFACE':
    case 'HATCH':
    case 'DIMENSION':
    case 'LEADER':
    case 'MULTILEADER':
    case 'MLINE':
      warnings.push({ code: 'DXF_PARTIAL', message: `Entity ${e.type} recognized; geometry mapping deferred` })
      return null
    default:
      warnings.push({ code: 'DXF_UNKNOWN', message: `Unknown entity ${e.type}` })
      return null
  }
}

function colorToHex(aci?: number): string | undefined {
  if (aci == null || aci === 256 || aci === 0) return undefined
  // Minimal ACI subset
  const table: Record<number, string> = {
    1: '#ff0000',
    2: '#ffff00',
    3: '#00ff00',
    4: '#00ffff',
    5: '#0000ff',
    6: '#ff00ff',
    7: '#ffffff',
    8: '#808080',
  }
  return table[aci]
}

async function readStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    signal?.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

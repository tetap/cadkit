import { describe, expect, it } from 'vitest'
import {
  type Entity,
  type LineEntity,
  createEntityId,
  createLayerId,
  IDENTITY_TRANSFORM,
} from '@cadkit/types'
import { optimizeImportPaths, simplifyCollinear } from './optimize-paths.js'
import { importDxfAll } from './parse.js'

const layerId = createLayerId('0')
const style = { stroke: '#32cd79', strokeWidth: 1 }

function line(x1: number, y1: number, x2: number, y2: number): LineEntity {
  return {
    id: createEntityId('line'),
    type: 'line',
    layerId,
    style,
    transform: IDENTITY_TRANSFORM,
    version: 1,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
  }
}

describe('optimizeImportPaths', () => {
  it('welds collinear fragmented lines into one polyline', () => {
    const input: Entity[] = [line(0, 0, 1, 0), line(1, 0, 2, 0), line(2, 0, 3, 0)]
    const { entities, stats } = optimizeImportPaths(input, { joinTolerance: 1e-6 })
    expect(stats.before).toBe(3)
    expect(stats.after).toBe(1)
    expect(entities).toHaveLength(1)
    const e = entities[0]!
    expect(e.type).toBe('line') // 2 endpoints after collinear simplify
    if (e.type === 'line') {
      expect(e.start).toEqual({ x: 0, y: 0 })
      expect(e.end).toEqual({ x: 3, y: 0 })
    }
  })

  it('closes a square made of four lines', () => {
    const input: Entity[] = [
      line(0, 0, 10, 0),
      line(10, 0, 10, 10),
      line(10, 10, 0, 10),
      line(0, 10, 0, 0),
    ]
    const { entities, stats } = optimizeImportPaths(input, { joinTolerance: 1e-6 })
    expect(stats.closed).toBe(1)
    expect(entities).toHaveLength(1)
    const e = entities[0]!
    expect(e.type).toBe('polyline')
    if (e.type === 'polyline') {
      expect(e.closed).toBe(true)
      expect(e.points.length).toBe(4)
    }
  })

  it('simplifies collinear polyline vertices', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
    ]
    const out = simplifyCollinear(pts, false)
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
    ])
  })

  it('does not weld paths on different layers', () => {
    const a = line(0, 0, 1, 0)
    const b: LineEntity = { ...line(1, 0, 2, 0), layerId: createLayerId('1') }
    const { entities } = optimizeImportPaths([a, b], { joinTolerance: 1e-6 })
    expect(entities).toHaveLength(2)
  })

  it('prefers collinear bar over T-junction stem regardless of entity order', () => {
    const stemFirst = [
      line(10, 0, 10, 10),
      line(0, 0, 10, 0),
      line(10, 0, 20, 0),
    ]
    const barFirst = [
      line(0, 0, 10, 0),
      line(10, 0, 20, 0),
      line(10, 0, 10, 10),
    ]
    for (const input of [stemFirst, barFirst]) {
      const { entities } = optimizeImportPaths(input, { joinTolerance: 1e-6 })
      expect(entities).toHaveLength(2)
      const bar = entities.find(
        (e) =>
          e.type === 'line' &&
          Math.min(e.start.x, e.end.x) <= 1e-9 &&
          Math.max(e.start.x, e.end.x) >= 20 - 1e-9,
      )
      const stem = entities.find(
        (e) =>
          e.type === 'line' &&
          Math.abs(e.start.x - e.end.x) < 1e-9 &&
          Math.abs(e.start.x - 10) < 1e-9,
      )
      expect(bar).toBeTruthy()
      expect(stem).toBeTruthy()
    }
  })
})

describe('dxf optimize integration', () => {
  it('merges consecutive LINE entities from DXF', async () => {
    const dxf = `0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
11
1
21
0
0
LINE
8
0
10
1
20
0
11
2
21
0
0
LINE
8
0
10
2
20
0
11
3
21
0
0
ENDSEC
0
EOF
`
    const { entities, warnings } = await importDxfAll(dxf)
    expect(entities.length).toBe(1)
    expect(warnings.some((w) => w.code === 'DXF_OPTIMIZE')).toBe(true)
    const e = entities[0]!
    if (e.type === 'line') {
      expect(e.start.x).toBeCloseTo(0)
      expect(e.end.x).toBeCloseTo(3)
    } else if (e.type === 'polyline') {
      expect(e.points[0]!.x).toBeCloseTo(0)
      expect(e.points[e.points.length - 1]!.x).toBeCloseTo(3)
    } else {
      throw new Error(`unexpected type ${e.type}`)
    }
  })

  it('can disable optimize', async () => {
    const dxf = `0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
11
1
21
0
0
LINE
8
0
10
1
20
0
11
2
21
0
0
ENDSEC
0
EOF
`
    const { entities } = await importDxfAll(dxf, { optimize: false })
    expect(entities.filter((e) => e.type === 'line')).toHaveLength(2)
  })
})

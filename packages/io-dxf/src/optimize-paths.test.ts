import { describe, expect, it } from 'vitest'
import { importDxfAll } from './parse.js'

describe('importDxfAll + optimize', () => {
  it('runs through importDxfAll by default', async () => {
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

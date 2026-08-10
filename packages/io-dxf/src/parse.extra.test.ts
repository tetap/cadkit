import { describe, expect, it } from 'vitest'
import { importDxfAll } from './parse.js'

describe('dxf extra entities', () => {
  it('parses circle / lwpolyline / arc with mm units', async () => {
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
CIRCLE
10
0
20
0
40
5
0
LWPOLYLINE
90
4
70
1
10
0
20
0
10
10
20
0
10
10
20
10
10
0
20
10
0
ARC
10
20
20
0
40
5
50
0
51
90
0
ENDSEC
0
EOF
`
    const { entities, documentUnit } = await importDxfAll(dxf, { targetUnit: 'mm' })
    expect(documentUnit).toBe('mm')
    expect(entities.some((e) => e.type === 'circle')).toBe(true)
    expect(entities.some((e) => e.type === 'polyline')).toBe(true)
    expect(entities.some((e) => e.type === 'arc')).toBe(true)
  })
})

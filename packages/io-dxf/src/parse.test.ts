import { describe, expect, it } from 'vitest'
import { importDxfAll } from './parse.js'

const SAMPLE = `0
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
10
21
5
0
CIRCLE
10
0
20
0
40
3
0
LWPOLYLINE
90
3
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
0
ENDSEC
0
EOF
`

describe('dxf', () => {
  it('imports line, circle, polyline via dxf-render', async () => {
    const { entities, documentUnit } = await importDxfAll(SAMPLE)
    expect(entities.find((e) => e.type === 'line')).toBeTruthy()
    expect(entities.find((e) => e.type === 'circle')).toBeTruthy()
    expect(entities.find((e) => e.type === 'polyline')).toBeTruthy()
    expect(documentUnit).toBe('mm')
  })
})

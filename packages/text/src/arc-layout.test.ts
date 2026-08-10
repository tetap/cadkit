import { describe, expect, it } from 'vitest'
import { layoutArcText } from './arc-layout.js'

describe('arc-layout re-export', () => {
  it('layouts glyphs for negative sweep', () => {
    const poses = layoutArcText('XY', 10, { x: 0, y: 0 }, {
      kind: 'arc',
      radius: 30,
      startAngle: 0,
      sweep: -Math.PI / 2,
    })
    expect(poses).toHaveLength(2)
    expect(poses[0]!.y).toBeLessThan(0)
  })
})

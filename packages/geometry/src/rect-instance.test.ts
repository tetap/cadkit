import { describe, expect, it } from 'vitest'
import { localAxisAlignedRect, worldAxisAlignedRectInstance } from './rect-instance.js'

describe('rect-instance', () => {
  it('detects a closed axis-aligned square', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ]
    expect(localAxisAlignedRect(pts, true)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 8,
      maxY: 8,
    })
    const inst = worldAxisAlignedRectInstance(pts, true, (x, y) => ({ x, y }))
    expect(Array.from(inst!)).toEqual([0, 0, 8, 8])
  })

  it('rejects non-rect polylines', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 4, y: 8 },
    ]
    expect(localAxisAlignedRect(pts, true)).toBeNull()
  })
})

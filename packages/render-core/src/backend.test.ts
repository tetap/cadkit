import { describe, expect, it } from 'vitest'
import { DirtyRegionTracker, MemoryBudget } from './backend.js'

describe('MemoryBudget', () => {
  it('tracks pressure and eviction threshold', () => {
    const b = new MemoryBudget(10)
    b.track('a', 5 * 1024 * 1024)
    expect(b.usedMB()).toBeCloseTo(5)
    expect(b.pressure()).toBeCloseTo(0.5)
    expect(b.shouldEvict()).toBe(false)
    b.track('a', 9 * 1024 * 1024)
    expect(b.shouldEvict()).toBe(true)
    b.release('a')
    expect(b.usedMB()).toBe(0)
  })
})

describe('DirtyRegionTracker', () => {
  it('merges and consumes', () => {
    const t = new DirtyRegionTracker(2, 0.6, 100)
    t.mark({ minX: 0, minY: 0, maxX: 1, maxY: 1 })
    t.mark({ minX: 2, minY: 2, maxX: 3, maxY: 3 })
    t.mark({ minX: 4, minY: 4, maxX: 5, maxY: 5 })
    const first = t.consume()
    expect(first.rects.length + (first.fullscreen ? 1 : 0)).toBeGreaterThan(0)
    t.markFull()
    const full = t.consume()
    expect(full.fullscreen).toBe(true)
  })
})

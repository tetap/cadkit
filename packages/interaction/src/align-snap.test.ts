import { describe, expect, it } from 'vitest'
import { createAABB, IDENTITY_TRANSFORM, createEntityId, type Entity } from '@cadkit/types'
import { snapAngleDelta, snapSelectionTranslation } from './align-snap.js'

describe('align-snap', () => {
  it('snaps angle delta to step', () => {
    const step = 15
    const almost = (14 * Math.PI) / 180
    const snapped = snapAngleDelta(almost, step)
    expect(snapped).toBeCloseTo((15 * Math.PI) / 180, 6)
  })

  it('aligns selection AABB to neighbor edge', () => {
    const other: Entity = {
      id: createEntityId('line'),
      type: 'line',
      layerId: '0' as Entity['layerId'],
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 200, y: 0 },
      end: { x: 260, y: 0 },
    }
    // neighbor left edge at 200; selection right at 148 — not close
    // move proposed so maxX≈200
    const near = createAABB(150, 0, 198, 20)
    const result = snapSelectionTranslation(near, 0, 0, [other], {
      enabled: true,
      alignEnabled: true,
      showDistances: true,
      pixelTolerance: 8,
      worldPerPixel: 1,
    })
    expect(result.dx).toBeCloseTo(2, 5) // 200 - 198
    expect(result.guides.some((g) => g.axis === 'x')).toBe(true)
  })

  it('dedupes many neighbors on the same axis position to one guide', () => {
    const entities: Entity[] = [20, 40, 60].map((y) => ({
      id: createEntityId('line'),
      type: 'line',
      layerId: '0' as Entity['layerId'],
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 100, y },
      end: { x: 160, y },
    }))
    const result = snapSelectionTranslation(createAABB(52, 0, 102, 10), 0, 0, entities, {
      enabled: true,
      alignEnabled: true,
      showDistances: true,
      pixelTolerance: 8,
      worldPerPixel: 1,
    })
    expect(result.guides).toHaveLength(1)
    expect(result.guides[0]!.axis).toBe('x')
  })

  it('shows both X and Y guides when snapping on both axes', () => {
    const vertical: Entity = {
      id: createEntityId('v'),
      type: 'line',
      layerId: '0' as Entity['layerId'],
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 100, y: 0 },
      end: { x: 100, y: 80 },
    }
    const horizontal: Entity = {
      id: createEntityId('h'),
      type: 'line',
      layerId: '0' as Entity['layerId'],
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 50 },
      end: { x: 80, y: 50 },
    }
    // Selection right≈98, top≈48 → snap to x=100 and y=50
    const result = snapSelectionTranslation(
      createAABB(48, 48, 98, 78),
      0,
      0,
      [vertical, horizontal],
      {
        enabled: true,
        alignEnabled: true,
        showDistances: true,
        pixelTolerance: 8,
        worldPerPixel: 1,
      },
    )
    expect(result.dx).toBeCloseTo(2, 5)
    expect(result.dy).toBeCloseTo(2, 5)
    expect(result.guides.some((g) => g.axis === 'x')).toBe(true)
    expect(result.guides.some((g) => g.axis === 'y')).toBe(true)
    expect(result.guides.length).toBeGreaterThanOrEqual(2)
  })
})

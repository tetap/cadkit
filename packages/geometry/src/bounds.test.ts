import { describe, expect, it } from 'vitest'
import { IDENTITY_TRANSFORM, createEntityId, createLayerId, isValidAABB } from '@cadkit/types'
import {
  aggregateBounds,
  entityLocalBounds,
  entityWorldBounds,
  transformAABB,
} from './bounds.js'
import { estimateTextAdvance } from './text-metrics.js'

const layer = createLayerId('0')

describe('bounds', () => {
  it('computes local bounds for common entities', () => {
    const line = entityLocalBounds({
      id: createEntityId(),
      type: 'line',
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 5 },
    })
    expect(line).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 })

    const square = entityLocalBounds({
      id: createEntityId(),
      type: 'polyline',
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 8 },
        { x: 0, y: 8 },
      ],
      closed: true,
    })
    expect(square).toEqual({ minX: 0, minY: 0, maxX: 8, maxY: 8 })
  })

  it('transformAABB rotates and aggregate skips invalid', () => {
    const box = { minX: 0, minY: 0, maxX: 2, maxY: 0 }
    const rotated = transformAABB(box, [0, 1, -1, 0, 0, 0])
    expect(isValidAABB(rotated)).toBe(true)
    expect(rotated.maxY - rotated.minY).toBeGreaterThan(0)
    expect(isValidAABB(aggregateBounds([entityLocalBounds({
      id: createEntityId(),
      type: 'group',
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      groupId: createEntityId('g') as never,
      children: [],
    })]))).toBe(false)
  })

  it('entityWorldBounds uses identity transform', () => {
    const e = {
      id: createEntityId(),
      type: 'circle' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      center: { x: 5, y: 5 },
      radius: 2,
    }
    const w = entityWorldBounds(e)
    expect(w).toEqual(entityLocalBounds(e))
  })

  it('uses full-width CJK advances and em-box text bounds', () => {
    expect(estimateTextAdvance('A中', 10)).toBeCloseTo(15.5)
    const text = entityLocalBounds({
      id: createEntityId(),
      type: 'text',
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'CADKit 编辑器',
      position: { x: 100, y: 80 },
      fontFamily: 'sans-serif',
      fontSize: 20,
      align: 'center',
    })
    const width = estimateTextAdvance('CADKit 编辑器', 20)
    // Em-box: top = baseline - fontSize, bottom = baseline (matches TextOverlay).
    expect(text.minX).toBeCloseTo(100 - width / 2, 5)
    expect(text.maxX).toBeCloseTo(100 + width / 2, 5)
    expect(text.minY).toBeCloseTo(60, 5)
    expect(text.maxY).toBeCloseTo(80, 5)
  })

  it('uses the longest line and all line heights for multiline text', () => {
    const text = entityLocalBounds({
      id: createEntityId(),
      type: 'text',
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: '短\n更长一行',
      position: { x: 10, y: 20 },
      fontFamily: 'sans-serif',
      fontSize: 10,
    })
    expect(text.minX).toBeCloseTo(10, 5)
    expect(text.minY).toBeCloseTo(10, 5)
    expect(text.maxX - text.minX).toBeGreaterThanOrEqual(40)
    expect(text.maxY).toBeCloseTo(30, 5)
  })

  it('includes rotation so flipped/rotated text stays in the AABB', () => {
    const base = {
      id: createEntityId(),
      type: 'text' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'CAD',
      position: { x: 100, y: 80 },
      fontFamily: 'sans-serif',
      fontSize: 20,
      align: 'left' as const,
    }
    const upright = entityLocalBounds(base)
    // Vertical flip bake: rotation π + widthFactor -1 (CSS decompose).
    const flipped = entityLocalBounds({
      ...base,
      rotation: Math.PI,
      widthFactor: -1,
    })
    expect(isValidAABB(flipped)).toBe(true)
    // Glyphs sit below the baseline after π + scaleX(-1); box must cover that.
    expect(flipped.maxY).toBeGreaterThan(base.position.y + 1)
    expect(flipped.minY).toBeGreaterThanOrEqual(upright.minY - 1)
  })

  it('bounds arc text from glyph quads', () => {
    const text = entityLocalBounds({
      id: createEntityId(),
      type: 'text',
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'Hello',
      position: { x: 0, y: 0 },
      fontFamily: 'sans-serif',
      fontSize: 12,
      path: { kind: 'arc', radius: 40, startAngle: -Math.PI / 2, sweep: Math.PI },
    })
    expect(isValidAABB(text)).toBe(true)
    expect(text.maxX - text.minX).toBeGreaterThan(20)
    expect(text.maxY - text.minY).toBeGreaterThan(20)
  })
})

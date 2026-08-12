import { describe, expect, it } from 'vitest'
import {
  type Entity,
  type LineEntity,
  createEntityId,
  createLayerId,
  IDENTITY_TRANSFORM,
} from '@cadkit/types'
import { optimizeImportPaths, simplifyCollinear } from './optimize-import-paths.js'

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

  it('welds an L-shape into a polyline', () => {
    const input: Entity[] = [line(0, 0, 1, 0), line(1, 0, 1, 1)]
    const { entities } = optimizeImportPaths(input)
    expect(entities).toHaveLength(1)
    expect(entities[0]!.type).toBe('polyline')
    if (entities[0]!.type === 'polyline') {
      expect(entities[0].points).toHaveLength(3)
      expect(entities[0].closed).toBe(false)
    }
  })

  it('closes a square loop', () => {
    const input: Entity[] = [
      line(0, 0, 1, 0),
      line(1, 0, 1, 1),
      line(1, 1, 0, 1),
      line(0, 1, 0, 0),
    ]
    const { entities, stats } = optimizeImportPaths(input)
    expect(stats.closed).toBe(1)
    expect(entities).toHaveLength(1)
    const e = entities[0]!
    expect(e.type).toBe('polyline')
    if (e.type === 'polyline') {
      expect(e.closed).toBe(true)
      expect(e.points.length).toBeGreaterThanOrEqual(4)
    }
  })

  it('leaves disconnected segments alone', () => {
    const input: Entity[] = [line(0, 0, 1, 0), line(5, 5, 6, 5)]
    const { entities } = optimizeImportPaths(input)
    expect(entities).toHaveLength(2)
  })

  it('preserves non-path entities', () => {
    const circle: Entity = {
      id: createEntityId('c'),
      type: 'circle',
      layerId,
      style,
      transform: IDENTITY_TRANSFORM,
      version: 1,
      center: { x: 0, y: 0 },
      radius: 1,
    }
    const input: Entity[] = [line(0, 0, 1, 0), circle, line(1, 0, 2, 0)]
    const { entities, stats } = optimizeImportPaths(input)
    // before/after count open paths only; circle is passthrough.
    expect(stats.before).toBe(2)
    expect(stats.after).toBe(1)
    expect(entities).toHaveLength(2)
    expect(entities.some((e) => e.type === 'circle')).toBe(true)
    expect(entities.filter((e) => e.type === 'line' || e.type === 'polyline')).toHaveLength(1)
  })

  it('simplifyCollinear drops middle points on a straight run', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]
    const out = simplifyCollinear(pts, false)
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ])
  })
})

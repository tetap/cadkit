import { describe, expect, it } from 'vitest'
import { Camera2D } from '@cadkit/geometry'
import {
  IDENTITY_TRANSFORM,
  createAABB,
  createEntityId,
  createLayerId,
} from '@cadkit/types'
import {
  buildTransformHandles,
  oppositeScaleCorner,
  scaleFactorsFromDrag,
  scaleMatrixAbout,
  selectionWorldBounds,
  transformEntityPatch,
} from './selection-transform.js'

const layer = createLayerId()

describe('selection-transform', () => {
  it('builds 8 scale + 1 rotate handles', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const handles = buildTransformHandles(createAABB(0, 0, 100, 50), cam)
    expect(handles.filter((h) => h.kind === 'scale')).toHaveLength(8)
    expect(handles.filter((h) => h.kind === 'rotate')).toHaveLength(1)
  })

  it('rotates handle positions with live OBB angle', () => {
    const cam = new Camera2D()
    cam.setViewport(800, 600)
    cam.setZoom(1)
    const box = createAABB(0, 0, 100, 50)
    const upright = buildTransformHandles(box, cam, 0)
    const turned = buildTransformHandles(box, cam, Math.PI / 2)
    const r0 = upright.find((h) => h.kind === 'rotate')!
    const r1 = turned.find((h) => h.kind === 'rotate')!
    // 90° about center moves the top-side rotate handle onto the right side
    expect(r1.world.x).not.toBeCloseTo(r0.world.x, 1)
    expect(r1.world.y).not.toBeCloseTo(r0.world.y, 1)
    const n0 = upright.find((h) => h.scaleCorner === 'n')!
    const n1 = turned.find((h) => h.scaleCorner === 'n')!
    // 90° CCW about (50,25): (x,y) → (cx-(y-cy), cy+(x-cx))
    expect(n1.world.x).toBeCloseTo(50 - (n0.world.y - 25), 5)
    expect(n1.world.y).toBeCloseTo(25 + (n0.world.x - 50), 5)
  })

  it('scales a line about opposite corner', () => {
    const line = {
      id: createEntityId('line'),
      type: 'line' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    }
    const { sx, sy } = scaleFactorsFromDrag('se', { x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 100 })
    expect(sx).toBeCloseTo(2)
    expect(sy).toBeCloseTo(2)
    expect(oppositeScaleCorner('se')).toBe('nw')
    const patch = transformEntityPatch(line, scaleMatrixAbout({ x: 0, y: 0 }, sx, sy))
    expect(patch).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 200, y: 0 } })
  })

  it('scales text fontSize (and arc radius) about an anchor', () => {
    const text = {
      id: createEntityId('text'),
      type: 'text' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      content: 'Hi',
      position: { x: 50, y: 40 },
      fontFamily: 'sans-serif',
      fontSize: 20,
      path: {
        kind: 'arc' as const,
        radius: 40,
        startAngle: -Math.PI / 2,
        sweep: Math.PI,
      },
    }
    const patch = transformEntityPatch(text, scaleMatrixAbout({ x: 0, y: 0 }, 2, 2))
    expect(patch?.position).toEqual({ x: 100, y: 80 })
    expect(patch?.fontSize).toBeCloseTo(40)
    expect(patch?.path).toMatchObject({ kind: 'arc', radius: 80 })
  })

  it('aggregates selection bounds', () => {
    const a = {
      id: createEntityId(),
      type: 'line' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    }
    const b = {
      id: createEntityId(),
      type: 'line' as const,
      layerId: layer,
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x: 5, y: 5 },
      end: { x: 20, y: 5 },
    }
    const box = selectionWorldBounds([a, b])
    expect(box).toEqual(createAABB(0, 0, 20, 5))
  })
})

import { describe, expect, it } from 'vitest'
import { exportSvg, parseSvg } from './parse.js'

describe('svg io', () => {
  it('parses line and expands cubic path', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <line x1="0" y1="0" x2="10" y2="5" stroke="#fff"/>
      <path d="M0 0 C10 10 20 0 30 10" stroke="#0f0"/>
    </svg>`
    const result = await parseSvg(svg)
    expect(result.entities.some((e) => e.type === 'line')).toBe(true)
    expect(result.entities.some((e) => e.type === 'bezier')).toBe(true)
  })

  it('exports lines', () => {
    const svg = exportSvg([
      {
        id: 'e1' as never,
        type: 'line',
        layerId: 'l1' as never,
        style: { stroke: '#0f0' },
        transform: [1, 0, 0, 1, 0, 0],
        version: 1,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
      },
    ])
    expect(svg).toContain('<line')
  })

  it('exports multiline text as tspans', () => {
    const svg = exportSvg([
      {
        id: 't1' as never,
        type: 'text',
        layerId: 'l1' as never,
        style: { fill: '#111' },
        transform: [1, 0, 0, 1, 0, 0],
        version: 1,
        content: '第一行\n第二行',
        position: { x: 10, y: 20 },
        fontFamily: 'sans-serif',
        fontSize: 12,
      },
    ])
    expect(svg.match(/<tspan/g)).toHaveLength(2)
    expect(svg).toContain('dy="1em"')
  })

  it('exports arc text as per-glyph rotated text nodes', () => {
    const svg = exportSvg([
      {
        id: 't2' as never,
        type: 'text',
        layerId: 'l1' as never,
        style: { fill: '#111' },
        transform: [1, 0, 0, 1, 0, 0],
        version: 1,
        content: 'ARC',
        position: { x: 0, y: 0 },
        fontFamily: 'sans-serif',
        fontSize: 12,
        path: { kind: 'arc', radius: 40, startAngle: -Math.PI / 2, sweep: Math.PI },
      },
    ])
    expect(svg.match(/<text /g)?.length).toBe(3)
    expect(svg).toContain('transform="rotate(')
  })
})

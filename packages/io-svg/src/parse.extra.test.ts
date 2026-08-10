import { describe, expect, it } from 'vitest'
import { parseSvg } from './parse.js'

describe('svg extra shapes', () => {
  it('parses rect/circle/ellipse/polygon/quad path', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="10" height="5"/>
      <circle cx="5" cy="5" r="2"/>
      <ellipse cx="20" cy="5" rx="4" ry="2"/>
      <polygon points="0,0 3,0 3,3"/>
      <path d="M0 0 Q10 10 20 0"/>
    </svg>`
    const { entities } = await parseSvg(svg)
    expect(entities.some((e) => e.type === 'polyline')).toBe(true)
    expect(entities.some((e) => e.type === 'circle')).toBe(true)
    expect(entities.some((e) => e.type === 'ellipse')).toBe(true)
    expect(entities.some((e) => e.type === 'bezier')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { parseSvg, exportSvg } from './parse.js'

describe('SVG image import/export', () => {
  it('parses <image href> in SVG user units (scaled to mm by Editor @ 72 DPI)', async () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100">
  <image href="https://example.com/a.png" x="10" y="20" width="40" height="30" preserveAspectRatio="xMidYMid meet"/>
</svg>`
    const result = await parseSvg(svg)
    const img = result.entities.find((e) => e.type === 'image')
    expect(img).toBeTruthy()
    if (img?.type !== 'image') return
    expect(img.href).toContain('example.com')
    expect(img.origin.x).toBe(10)
    expect(img.origin.y).toBe(20)
    expect(img.width).toBe(40)
    expect(img.height).toBe(30)
    expect(img.preserveAspectRatio).toBe(true)
  })

  it('exports ImageEntity with href and transform', () => {
    const out = exportSvg([
      {
        id: 'img_1' as never,
        type: 'image',
        layerId: '0' as never,
        style: {},
        transform: [1, 0, 0, 1, 5, 6],
        version: 1,
        href: 'pic.png',
        width: 100,
        height: 50,
        origin: { x: 0, y: 0 },
        preserveAspectRatio: true,
      },
    ])
    expect(out).toContain('href="pic.png"')
    expect(out).toContain('width="100"')
    expect(out).toContain('matrix(1 0 0 1 5 6)')
  })
})

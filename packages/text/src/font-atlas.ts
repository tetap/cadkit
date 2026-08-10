/**
 * Canvas-backed glyph atlas for WebGPU text quads.
 * Canvas/OffscreenCanvas is used only to rasterize glyphs into an atlas texture —
 * never as the document canvas renderer.
 */

export interface AtlasGlyph {
  char: string
  u0: number
  v0: number
  u1: number
  v1: number
  width: number
  height: number
  advance: number
}

export interface FontAtlasPack {
  canvas: HTMLCanvasElement | OffscreenCanvas
  width: number
  height: number
  glyphs: Map<string, AtlasGlyph>
  fontKey: string
}

export function createFontAtlas(
  fontFamily: string,
  fontSize: number,
  chars: string,
  atlasSize = 512,
): FontAtlasPack {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(atlasSize, atlasSize)
      : Object.assign(document.createElement('canvas'), { width: atlasSize, height: atlasSize })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('2d context unavailable for font atlas')
  ctx.clearRect(0, 0, atlasSize, atlasSize)
  ctx.font = `${fontSize}px ${fontFamily}`
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'top'

  const glyphs = new Map<string, AtlasGlyph>()
  let x = 1
  let y = 1
  let rowH = 0
  const unique = [...new Set([...chars])]
  for (const ch of unique) {
    if (!ch) continue
    const metrics = ctx.measureText(ch)
    const w = Math.ceil(Math.max(metrics.width, fontSize * 0.3)) + 2
    const h = Math.ceil(fontSize * 1.3) + 2
    if (x + w >= atlasSize) {
      x = 1
      y += rowH + 1
      rowH = 0
    }
    if (y + h >= atlasSize) break
    ctx.fillText(ch, x + 1, y + 1)
    glyphs.set(ch, {
      char: ch,
      u0: x / atlasSize,
      v0: y / atlasSize,
      u1: (x + w) / atlasSize,
      v1: (y + h) / atlasSize,
      width: w,
      height: h,
      advance: metrics.width,
    })
    x += w + 1
    rowH = Math.max(rowH, h)
  }

  return {
    canvas,
    width: atlasSize,
    height: atlasSize,
    glyphs,
    fontKey: `${fontFamily}|${fontSize}`,
  }
}

export async function atlasToImageBitmap(pack: FontAtlasPack): Promise<ImageBitmap> {
  return createImageBitmap(pack.canvas as CanvasImageSource)
}

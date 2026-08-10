export interface GlyphPlacement {
  codePoint: number
  x: number
  y: number
  advance: number
  width: number
  height: number
}

export interface ShapedText {
  text: string
  fontFamily: string
  fontSize: number
  glyphs: GlyphPlacement[]
  width: number
  height: number
}

/**
 * JS fallback shaper. Production path will call HarfBuzz/FreeType WASM via @cadkit/wasm.
 * Uses approximate advances for Latin / CJK so layout & LOD work without native deps.
 */
export function shapeText(text: string, fontFamily: string, fontSize: number, widthFactor = 1): ShapedText {
  const glyphs: GlyphPlacement[] = []
  let x = 0
  let y = 0
  let maxWidth = 0
  let lineCount = 1
  for (const ch of text) {
    if (ch === '\n') {
      maxWidth = Math.max(maxWidth, x)
      x = 0
      y += fontSize
      lineCount++
      continue
    }
    if (ch === '\r') continue
    const code = ch.codePointAt(0) ?? 0
    const isCjk = code >= 0x3000
    const advance = fontSize * widthFactor * (/\s/u.test(ch) ? 0.33 : isCjk ? 1 : 0.55)
    glyphs.push({
      codePoint: code,
      x,
      y,
      advance,
      width: advance,
      height: fontSize,
    })
    x += advance
  }
  maxWidth = Math.max(maxWidth, x)
  return {
    text,
    fontFamily,
    fontSize,
    glyphs,
    width: maxWidth,
    height: fontSize * lineCount,
  }
}

export type TextRenderMode = 'msdf' | 'outline' | 'placeholder'

export function chooseTextMode(screenHeightPx: number): TextRenderMode {
  if (screenHeightPx < 4) return 'placeholder'
  if (screenHeightPx < 48) return 'msdf'
  return 'outline'
}

/** Simple atlas slot tracker with LRU eviction. */
export class GlyphAtlas {
  private readonly map = new Map<string, { x: number; y: number; w: number; h: number; last: number }>()
  private cursorX = 0
  private cursorY = 0
  private rowH = 0
  private tick = 0

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  getOrAlloc(key: string, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
    const existing = this.map.get(key)
    if (existing) {
      existing.last = ++this.tick
      return existing
    }
    if (this.cursorX + w > this.width) {
      this.cursorX = 0
      this.cursorY += this.rowH
      this.rowH = 0
    }
    if (this.cursorY + h > this.height) {
      this.evict(Math.ceil(this.map.size * 0.25))
      if (this.cursorY + h > this.height) return null
    }
    const slot = { x: this.cursorX, y: this.cursorY, w, h, last: ++this.tick }
    this.map.set(key, slot)
    this.cursorX += w
    this.rowH = Math.max(this.rowH, h)
    return slot
  }

  private evict(count: number): void {
    const entries = [...this.map.entries()].sort((a, b) => a[1].last - b[1].last)
    for (let i = 0; i < count && i < entries.length; i++) this.map.delete(entries[i]![0])
    this.cursorX = 0
    this.cursorY = 0
    this.rowH = 0
  }
}

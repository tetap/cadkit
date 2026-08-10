/**
 * Minimal canvas stub for outline self-tests (no real font rasterizer).
 * fillText draws an axis-aligned em-box rectangle in the current transform.
 */

type Mat = { a: number; b: number; c: number; d: number; e: number; f: number }

const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

function multiply(m: Mat, n: Mat): Mat {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  }
}

function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

export class FakeCanvas {
  width = 0
  height = 0
  private pixels: Uint8ClampedArray | null = null
  private readonly ctx = new FakeContext(this)

  getContext(type: string): FakeContext | null {
    if (type !== '2d') return null
    return this.ctx
  }

  ensureBuffer(): Uint8ClampedArray {
    const n = this.width * this.height * 4
    if (!this.pixels || this.pixels.length !== n) {
      this.pixels = new Uint8ClampedArray(n)
    }
    return this.pixels
  }
}

export class FakeContext {
  fillStyle = '#000'
  font = '16px sans-serif'
  textAlign: CanvasTextAlign = 'left'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  private mat: Mat = { ...IDENTITY }
  private stack: Mat[] = []

  constructor(private readonly canvas: FakeCanvas) {}

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.mat = { a, b, c, d, e, f }
  }

  translate(x: number, y: number): void {
    this.mat = multiply(this.mat, { a: 1, b: 0, c: 0, d: 1, e: x, f: y })
  }

  rotate(rad: number): void {
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    this.mat = multiply(this.mat, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 })
  }

  scale(x: number, y: number): void {
    this.mat = multiply(this.mat, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 })
  }

  save(): void {
    this.stack.push({ ...this.mat })
  }

  restore(): void {
    this.mat = this.stack.pop() ?? { ...IDENTITY }
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const buf = this.canvas.ensureBuffer()
    // Ignore transform for clear of full canvas (callers clear in identity).
    if (x <= 0 && y <= 0 && w >= this.canvas.width && h >= this.canvas.height) {
      buf.fill(0)
      return
    }
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue
        const i = (py * this.canvas.width + px) * 4
        buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0
      }
    }
  }

  measureText(text: string): TextMetrics {
    const size = this.fontSize()
    const width = Math.max(size * 0.55 * text.length, size * 0.2)
    return {
      width,
      actualBoundingBoxAscent: size * 0.8,
      actualBoundingBoxDescent: size * 0.2,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
    } as TextMetrics
  }

  fillText(text: string, x: number, y: number): void {
    if (!text) return
    const size = this.fontSize()
    const width = this.measureText(text).width
    let left = x
    if (this.textAlign === 'center') left = x - width / 2
    else if (this.textAlign === 'right') left = x - width

    // Em-box in local space (Y-down): bottom baseline → [y-size, y]
    let top = y - size
    let bottom = y
    if (this.textBaseline === 'alphabetic') {
      top = y - size * 0.8
      bottom = y + size * 0.2
    } else if (this.textBaseline === 'top') {
      top = y
      bottom = y + size
    } else if (this.textBaseline === 'middle') {
      top = y - size / 2
      bottom = y + size / 2
    }

    const corners = [
      apply(this.mat, left, top),
      apply(this.mat, left + width, top),
      apply(this.mat, left + width, bottom),
      apply(this.mat, left, bottom),
    ]
    const minX = Math.floor(Math.min(...corners.map((p) => p.x)))
    const maxX = Math.ceil(Math.max(...corners.map((p) => p.x)))
    const minY = Math.floor(Math.min(...corners.map((p) => p.y)))
    const maxY = Math.ceil(Math.max(...corners.map((p) => p.y)))

    const buf = this.canvas.ensureBuffer()
    const w = this.canvas.width
    const h = this.canvas.height
    // Fill bbox of transformed quad (good enough for axis-aligned / mild rotation tests).
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        if (px < 0 || py < 0 || px >= w || py >= h) continue
        if (!pointInQuad(px + 0.5, py + 0.5, corners)) continue
        const i = (py * w + px) * 4
        buf[i] = buf[i + 1] = buf[i + 2] = 0
        buf[i + 3] = 255
      }
    }
  }

  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData {
    const buf = this.canvas.ensureBuffer()
    const out = new Uint8ClampedArray(sw * sh * 4)
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const px = sx + x
        const py = sy + y
        const di = (y * sw + x) * 4
        if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue
        const si = (py * this.canvas.width + px) * 4
        out[di] = buf[si]!
        out[di + 1] = buf[si + 1]!
        out[di + 2] = buf[si + 2]!
        out[di + 3] = buf[si + 3]!
      }
    }
    return { data: out, width: sw, height: sh, colorSpace: 'srgb' } as ImageData
  }

  private fontSize(): number {
    const m = /(\d+(?:\.\d+)?)\s*px/.exec(this.font)
    return m ? Number(m[1]) : 16
  }
}

function pointInQuad(x: number, y: number, quad: Array<{ x: number; y: number }>): boolean {
  // Ray cast
  let inside = false
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const xi = quad[i]!.x
    const yi = quad[i]!.y
    const xj = quad[j]!.x
    const yj = quad[j]!.y
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-30) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Install FakeCanvas as document.createElement('canvas') / kill OffscreenCanvas. */
export function installFakeCanvas(): () => void {
  const g = globalThis as typeof globalThis & {
    document?: { createElement: (tag: string) => unknown }
    OffscreenCanvas?: unknown
  }
  const prevOffscreen = g.OffscreenCanvas
  const prevDoc = g.document
  // Test-only shims; cast past DOM lib strictness.
  g.OffscreenCanvas = undefined as unknown as typeof OffscreenCanvas
  g.document = {
    createElement(tag: string) {
      if (tag === 'canvas') return new FakeCanvas()
      return prevDoc?.createElement?.(tag) ?? ({} as HTMLElement)
    },
  } as Document
  return () => {
    g.OffscreenCanvas = prevOffscreen
    g.document = prevDoc
  }
}

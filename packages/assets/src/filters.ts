export type BuiltinFilterName =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'grayscale'
  | 'invert'
  | 'opacity'
  | 'blur'
  | 'floydSteinberg'
  | 'threshold'

export interface FilterOp {
  id: string
  type: BuiltinFilterName | 'custom'
  params: Record<string, number>
  /** Custom WGSL function body for type === 'custom' */
  wgslBody?: string
}

export interface FilterValidation {
  ok: boolean
  errors: string[]
}

const FORBIDDEN = [
  /@group\s*\(/i,
  /@binding\s*\(/i,
  /\bvar\s*<\s*storage/i,
  /\batomic/i,
  /\btexture_external\b/i,
  /\bwhile\s*\(\s*true\s*\)/i,
  /\bloop\s*\{/i,
]

/** Validate controlled custom filter body: filter(color, uv, params) -> vec4f */
export function validateCustomFilterBody(body: string): FilterValidation {
  const errors: string[] = []
  if (!body.trim()) errors.push('Empty filter body')
  for (const re of FORBIDDEN) {
    if (re.test(body)) errors.push(`Forbidden construct: ${re}`)
  }
  if (body.includes('@vertex') || body.includes('@fragment')) {
    errors.push('Provide only the function body, not a full shader')
  }
  return { ok: errors.length === 0, errors }
}

export function wrapCustomFilterShader(body: string): string {
  return /* wgsl */ `
struct Params { values: array<vec4f, 4>, }
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;
@group(0) @binding(2) var<uniform> params: Params;

struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var positions = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  var uvs = array<vec2f, 3>(vec2f(0., 1.), vec2f(2., 1.), vec2f(0., -1.));
  var o: VSOut;
  o.pos = vec4f(positions[vi], 0., 1.);
  o.uv = uvs[vi];
  return o;
}

fn filter_fn(color: vec4f, uv: vec2f, p: Params) -> vec4f {
  ${body}
}

@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let color = textureSample(srcTex, srcSamp, i.uv);
  return filter_fn(color, i.uv, params);
}
`
}

/** CPU reference for builtin single-pass filters (unit tests). */
export function applyBuiltinFilterCpu(
  rgba: [number, number, number, number],
  op: FilterOp,
): [number, number, number, number] {
  let [r, g, b, a] = rgba
  const amount = op.params.amount ?? 1
  switch (op.type) {
    case 'brightness':
      return [clamp01(r * amount), clamp01(g * amount), clamp01(b * amount), a]
    case 'contrast': {
      const f = amount
      return [
        clamp01((r - 0.5) * f + 0.5),
        clamp01((g - 0.5) * f + 0.5),
        clamp01((b - 0.5) * f + 0.5),
        a,
      ]
    }
    case 'saturation': {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      return [
        clamp01(l + (r - l) * amount),
        clamp01(l + (g - l) * amount),
        clamp01(l + (b - l) * amount),
        a,
      ]
    }
    case 'grayscale': {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      return [l, l, l, a]
    }
    case 'invert':
      return [1 - r, 1 - g, 1 - b, a]
    case 'opacity':
      return [r, g, b, clamp01(a * amount)]
    case 'threshold': {
      const cutoff = op.params.cutoff ?? op.params.amount ?? 0.5
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const v = l >= cutoff ? 1 : 0
      return [v, v, v, a]
    }
    default:
      return rgba
  }
}

/**
 * Floyd–Steinberg error diffusion on an RGBA buffer (0–255).
 * Grayscale luma → quantized levels, then write RGB equal.
 */
export function applyFloydSteinbergRgba(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  params?: { levels?: number; amount?: number },
): void {
  const levels = Math.max(2, Math.min(16, Math.round(params?.levels ?? 2)))
  const amount = clamp01(params?.amount ?? 1)
  const step = 255 / (levels - 1)
  const err = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i]! / 255
      const g = data[i + 1]! / 255
      const b = data[i + 2]! / 255
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const idx = y * w + x
      const old = clamp01(luma + err[idx]!)
      const q = Math.round(old * (levels - 1)) / (levels - 1)
      const mixed = old * (1 - amount) + q * amount
      const out = Math.round(clamp01(mixed) * 255)
      data[i] = out
      data[i + 1] = out
      data[i + 2] = out
      const e = (old - q) * amount
      if (x + 1 < w) err[idx + 1]! += (e * 7) / 16
      if (y + 1 < h) {
        if (x > 0) err[idx + w - 1]! += (e * 3) / 16
        err[idx + w]! += (e * 5) / 16
        if (x + 1 < w) err[idx + w + 1]! += (e * 1) / 16
      }
    }
  }
  void step
}

/** Binary / multi-level threshold on RGBA buffer (0–255). */
export function applyThresholdRgba(
  data: Uint8ClampedArray | Uint8Array,
  _w: number,
  _h: number,
  params?: { cutoff?: number },
): void {
  const cutoff = clamp01(params?.cutoff ?? 0.5) * 255
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
    const v = l >= cutoff ? 255 : 0
    data[i] = v
    data[i + 1] = v
    data[i + 2] = v
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function createFilterId(): string {
  return `f_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Separable Gaussian blur weights for a 1D pass (normalize to sum=1).
 * Renderer runs horizontal then vertical ping-pong passes.
 */
export function gaussianKernel1D(radiusPx: number): Float32Array {
  const r = Math.max(0, Math.min(32, Math.round(radiusPx)))
  const sigma = Math.max(0.5, r / 2)
  const size = r * 2 + 1
  const k = new Float32Array(size)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + r] = w
    sum += w
  }
  for (let i = 0; i < size; i++) k[i]! /= sum
  return k
}

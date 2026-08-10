export type BuiltinFilterName =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'grayscale'
  | 'invert'
  | 'opacity'
  | 'blur'

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
    default:
      return rgba
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

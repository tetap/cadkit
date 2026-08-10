import {
  gaussianKernel1D,
  hashFilterStack,
  validateCustomFilterBody,
  wrapCustomFilterShader,
  type FilterOp,
} from '@cadkit/assets'

/** Fullscreen triangle; UV matches copyExternalImageToTexture top-left origin. */
const FULLSCREEN_VS = /* wgsl */ `
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var positions = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  var uvs = array<vec2f, 3>(vec2f(0., 1.), vec2f(2., 1.), vec2f(0., -1.));
  var o: VSOut;
  o.pos = vec4f(positions[vi], 0., 1.);
  o.uv = uvs[vi];
  return o;
}
`

function builtinFragment(mode: string): string {
  return /* wgsl */ `
${FULLSCREEN_VS}
// 16-byte uniform (avoid vec3 padding traps)
struct Params { amount: f32, _p0: f32, _p1: f32, _p2: f32 }
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let color = textureSample(srcTex, srcSamp, i.uv);
  let a = params.amount;
  ${mode}
}
`
}

const BUILTIN_BODIES: Record<string, string> = {
  brightness: `return vec4f(color.rgb * a, color.a);`,
  contrast: `return vec4f((color.rgb - vec3f(0.5)) * a + vec3f(0.5), color.a);`,
  saturation: `
    let l = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    return vec4f(mix(vec3f(l), color.rgb, a), color.a);
  `,
  grayscale: `
    let l = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    return vec4f(vec3f(l), color.a);
  `,
  invert: `return vec4f(1.0 - color.rgb, color.a);`,
  opacity: `return vec4f(color.rgb, color.a * clamp(a, 0.0, 1.0));`,
}

const BLUR_SHADER = /* wgsl */ `
${FULLSCREEN_VS}
struct BlurParams {
  dir: vec2f,
  texel: vec2f,
  radius: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
  weights: array<vec4f, 17>,
}
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSamp: sampler;
@group(0) @binding(2) var<uniform> params: BlurParams;
@fragment fn fs(i: VSOut) -> @location(0) vec4f {
  let r = i32(params.radius);
  var acc = vec4f(0.);
  for (var k = -16; k <= 16; k++) {
    if (k < -r || k > r) { continue; }
    let wi = u32(k + 16);
    let w = params.weights[wi / 4u][wi % 4u];
    let uv = i.uv + params.dir * params.texel * f32(k);
    acc += textureSample(srcTex, srcSamp, uv) * w;
  }
  return acc;
}
`

const BLUR_UNIFORM_FLOATS = 8 + 17 * 4

function toBufferSource(data: Float32Array): GPUAllowSharedBufferSource {
  return data as unknown as GPUAllowSharedBufferSource
}

interface CachedFiltered {
  texture: GPUTexture
  width: number
  height: number
}

/**
 * Offscreen ping-pong filter chain for ImageEntity stacks.
 * On any failure, returns the original source texture (never a cleared empty RT).
 */
export class FilterEngine {
  private device: GPUDevice | null = null
  private sampler: GPUSampler | null = null
  private paramBuffer: GPUBuffer | null = null
  private customParamBuffer: GPUBuffer | null = null
  private blurBufferH: GPUBuffer | null = null
  private blurBufferV: GPUBuffer | null = null
  private builtinPipelines = new Map<string, GPURenderPipeline>()
  private blurPipeline: GPURenderPipeline | null = null
  private customPipelines = new Map<string, GPURenderPipeline | null>()
  private cache = new Map<string, CachedFiltered>()
  private ping: GPUTexture | null = null
  private pong: GPUTexture | null = null
  /** Extra RT for separable blur mid-pass (ping/pong may both be in use). */
  private scratch: GPUTexture | null = null
  private rtW = 0
  private rtH = 0

  async initialize(device: GPUDevice): Promise<void> {
    this.device = device
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.paramBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.customParamBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const blurSize = BLUR_UNIFORM_FLOATS * 4
    this.blurBufferH = device.createBuffer({
      size: blurSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.blurBufferV = device.createBuffer({
      size: blurSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    for (const [name, body] of Object.entries(BUILTIN_BODIES)) {
      const pipeline = await this.createPipeline(builtinFragment(body))
      if (pipeline) this.builtinPipelines.set(name, pipeline)
    }
    this.blurPipeline = await this.createPipeline(BLUR_SHADER)
  }

  apply(assetId: string, source: GPUTexture, filters: readonly FilterOp[]): GPUTexture {
    if (!this.device || !filters.length) return source
    const key = `${assetId}|${hashFilterStack(filters)}`
    const hit = this.cache.get(key)
    const w = source.width
    const h = source.height
    if (hit && hit.width === w && hit.height === h) return hit.texture

    try {
      this.ensurePingPong(w, h)
      // Seed ping with the source so a failed first pass cannot leave a cleared RT.
      this.copyTex(source, this.ping!, w, h)
      let read: GPUTexture = this.ping!
      let write: GPUTexture = this.pong!
      let applied = 0

      for (const op of filters) {
        const ok = this.runFilter(op, read, write, w, h)
        if (!ok) continue
        applied++
        const tmp = read
        read = write
        write = tmp
      }

      if (applied === 0) return source

      const out = this.device.createTexture({
        size: [w, h],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      this.copyTex(read, out, w, h)

      const prev = this.cache.get(key)
      prev?.texture.destroy()
      this.cache.set(key, { texture: out, width: w, height: h })
      if (this.cache.size > 32) {
        const first = this.cache.keys().next().value
        if (first) {
          this.cache.get(first)?.texture.destroy()
          this.cache.delete(first)
        }
      }
      return out
    } catch (err) {
      console.warn('[FilterEngine] apply failed, using source', err)
      return source
    }
  }

  dispose(): void {
    for (const v of this.cache.values()) v.texture.destroy()
    this.cache.clear()
    this.ping?.destroy()
    this.pong?.destroy()
    this.scratch?.destroy()
    this.paramBuffer?.destroy()
    this.customParamBuffer?.destroy()
    this.blurBufferH?.destroy()
    this.blurBufferV?.destroy()
    this.builtinPipelines.clear()
    this.customPipelines.clear()
  }

  private copyTex(src: GPUTexture, dst: GPUTexture, w: number, h: number): void {
    const enc = this.device!.createCommandEncoder()
    enc.copyTextureToTexture({ texture: src }, { texture: dst }, [w, h])
    this.device!.queue.submit([enc.finish()])
  }

  private runFilter(
    op: FilterOp,
    src: GPUTexture,
    dst: GPUTexture,
    w: number,
    h: number,
  ): boolean {
    if (!this.device || !this.sampler) return false
    if (op.type === 'blur') {
      return this.runBlur(src, dst, w, h, op.params.amount ?? 2)
    }
    if (op.type === 'custom') {
      const body = op.wgslBody ?? 'return color;'
      if (!validateCustomFilterBody(body).ok) return false
      const pipeline = this.ensureCustom(body)
      if (!pipeline || !this.customParamBuffer) return false
      const u = new Float32Array(16)
      u[0] = op.params.amount ?? op.params.p0 ?? 1
      this.device.queue.writeBuffer(this.customParamBuffer, 0, toBufferSource(u))
      this.submitDraw(pipeline, src, dst, this.customParamBuffer)
      return true
    }
    const pipeline = this.builtinPipelines.get(op.type)
    if (!pipeline || !this.paramBuffer) return false
    const u = new Float32Array(4)
    u[0] = op.params.amount ?? 1
    this.device.queue.writeBuffer(this.paramBuffer, 0, toBufferSource(u))
    this.submitDraw(pipeline, src, dst, this.paramBuffer)
    return true
  }

  private runBlur(
    src: GPUTexture,
    dst: GPUTexture,
    w: number,
    h: number,
    radius: number,
  ): boolean {
    if (
      !this.device ||
      !this.blurPipeline ||
      !this.blurBufferH ||
      !this.blurBufferV ||
      !this.scratch
    ) {
      return false
    }
    const r = Math.max(0, Math.min(16, Math.round(radius)))
    if (r <= 0) {
      this.copyTex(src, dst, w, h)
      return true
    }
    const kernel = gaussianKernel1D(r)
    const weights = new Float32Array(17 * 4)
    for (let i = 0; i < kernel.length; i++) {
      weights[16 - r + i] = kernel[i]!
    }
    const mid = this.scratch

    const pack = (dirX: number, dirY: number): Float32Array => {
      const u = new Float32Array(BLUR_UNIFORM_FLOATS)
      u[0] = dirX
      u[1] = dirY
      u[2] = 1 / w
      u[3] = 1 / h
      u[4] = r
      u.set(weights, 8)
      return u
    }

    this.device.queue.writeBuffer(this.blurBufferH, 0, toBufferSource(pack(1, 0)))
    this.submitDraw(this.blurPipeline, src, mid, this.blurBufferH)
    this.device.queue.writeBuffer(this.blurBufferV, 0, toBufferSource(pack(0, 1)))
    this.submitDraw(this.blurPipeline, mid, dst, this.blurBufferV)
    return true
  }

  private submitDraw(
    pipeline: GPURenderPipeline,
    src: GPUTexture,
    dst: GPUTexture,
    uniform: GPUBuffer,
  ): void {
    const device = this.device!
    const bg = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: this.sampler! },
        { binding: 2, resource: { buffer: uniform } },
      ],
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: dst.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bg)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  private ensureCustom(body: string): GPURenderPipeline | null {
    if (this.customPipelines.has(body)) return this.customPipelines.get(body)!
    // Sync create; compilation errors surface as invalid draws — cache null on throw.
    try {
      const module = this.device!.createShaderModule({ code: wrapCustomFilterShader(body) })
      const pipeline = this.device!.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: {
          module,
          entryPoint: 'fs',
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list' },
      })
      this.customPipelines.set(body, pipeline)
      return pipeline
    } catch {
      this.customPipelines.set(body, null)
      return null
    }
  }

  private async createPipeline(code: string): Promise<GPURenderPipeline | null> {
    const module = this.device!.createShaderModule({ code })
    const info = await module.getCompilationInfo()
    const err = info.messages.find((m) => m.type === 'error')
    if (err) {
      console.warn('[FilterEngine] shader error:', err.message)
      return null
    }
    try {
      return this.device!.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: {
          module,
          entryPoint: 'fs',
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list' },
      })
    } catch (e) {
      console.warn('[FilterEngine] pipeline create failed', e)
      return null
    }
  }

  private ensurePingPong(w: number, h: number): void {
    if (this.ping && this.pong && this.scratch && this.rtW === w && this.rtH === h) return
    this.ping?.destroy()
    this.pong?.destroy()
    this.scratch?.destroy()
    const make = () =>
      this.device!.createTexture({
        size: [w, h],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      })
    this.ping = make()
    this.pong = make()
    this.scratch = make()
    this.rtW = w
    this.rtH = h
  }
}

export { hashFilterStack }

import type { RenderItem } from '@cadkit/scene'
import type { TextureResolver } from '@cadkit/render-core'
import {
  applyFloydSteinbergRgba,
  applyThresholdRgba,
  hashFilterStack,
  type FilterOp,
} from '@cadkit/assets'
import { FilterEngine } from './filter-engine.js'

const IMAGE_SHADER = /* wgsl */ `
struct Uniforms {
  matrix: mat3x3<f32>,
  viewport: vec2f,
  _pad: vec2f,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VSIn {
  @location(0) pos: vec2f,
  @location(1) uv: vec2f,
}
struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vs(input: VSIn) -> VSOut {
  let wp = u.matrix * vec3f(input.pos, 1.0);
  let ndc = vec2f(
    (wp.x / u.viewport.x) * 2.0 - 1.0,
    1.0 - (wp.y / u.viewport.y) * 2.0,
  );
  var out: VSOut;
  out.position = vec4f(ndc, 0.0, 1.0);
  out.uv = input.uv;
  return out;
}

@fragment fn fs(input: VSOut) -> @location(0) vec4f {
  return textureSample(tex, samp, input.uv);
}
`

function toBufferSource(data: Float32Array): GPUAllowSharedBufferSource {
  return data as unknown as GPUAllowSharedBufferSource
}

export class ImagePass {
  private pipeline: GPURenderPipeline | null = null
  private sampler: GPUSampler | null = null
  private uniformBuffer: GPUBuffer | null = null
  private textures = new Map<string, GPUTexture>()
  private bindGroups = new Map<string, GPUBindGroup>()
  private placeholder: GPUTexture | null = null
  private errorTex: GPUTexture | null = null
  private device: GPUDevice | null = null
  private format: GPUTextureFormat = 'bgra8unorm'
  private readonly filters = new FilterEngine()
  /** Per-item filtered texture for the current frame (assetId|hash → tex). */
  private frameFiltered = new Map<string, GPUTexture>()

  async initialize(device: GPUDevice, format: GPUTextureFormat): Promise<void> {
    this.device = device
    this.format = format
    const module = device.createShaderModule({ code: IMAGE_SHADER })
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.uniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.placeholder = this.makeSolidTexture(device, [0.3, 0.3, 0.35, 0.6])
    this.errorTex = this.makeSolidTexture(device, [0.9, 0.2, 0.2, 0.7])
    await this.filters.initialize(device)
  }

  /**
   * Run filter chains before the main scene pass (submits GPU work).
   * Must be called outside an open render pass.
   */
  prepareFilters(items: RenderItem[], textures?: TextureResolver): void {
    this.frameFiltered.clear()
    if (!this.device) return
    for (const item of items) {
      if (item.kind !== 'image' || !item.filters?.length) continue
      const assetId = item.assetId ?? ''
      const bitmap = textures?.getBitmap(assetId)
      if (!bitmap) continue
      try {
        const ops = item.filters as FilterOp[]
        const fkey = `${assetId}|${hashFilterStack(ops)}`
        // Floyd–Steinberg must run on CPU; peel it (and optional CPU threshold) first.
        const cpuTone = ops.find((o) => o.type === 'floydSteinberg')
        let source = this.ensureTexture(assetId, bitmap)
        let gpuOps = ops
        if (cpuTone) {
          source = this.cpuToneTexture(assetId, bitmap, cpuTone)
          gpuOps = ops.filter((o) => o.type !== 'floydSteinberg')
        }
        const filtered =
          gpuOps.length > 0 ? this.filters.apply(assetId, source, gpuOps) : source
        if (filtered !== this.textures.get(assetId)) {
          this.bindGroups.delete(fkey)
          this.frameFiltered.set(fkey, filtered)
        } else if (cpuTone) {
          this.bindGroups.delete(fkey)
          this.frameFiltered.set(fkey, source)
        }
      } catch (err) {
        console.warn('[ImagePass] prepareFilters failed', err)
      }
    }
  }

  /** Rasterize bitmap → CPU tone (FS / threshold) → GPU texture. */
  private cpuToneTexture(assetId: string, bitmap: ImageBitmap, op: FilterOp): GPUTexture {
    const key = `${assetId}|cpu:${op.type}|${op.params.levels ?? ''}|${op.params.cutoff ?? ''}|${op.params.amount ?? ''}`
    const hit = this.textures.get(key)
    if (hit) return hit
    const w = bitmap.width
    const h = bitmap.height
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h })
    const ctx = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null
    if (!ctx) return this.ensureTexture(assetId, bitmap)
    ctx.drawImage(bitmap, 0, 0)
    const img = ctx.getImageData(0, 0, w, h)
    if (op.type === 'floydSteinberg') {
      applyFloydSteinbergRgba(img.data, w, h, op.params)
    } else if (op.type === 'threshold') {
      applyThresholdRgba(img.data, w, h, op.params)
    }
    ctx.putImageData(img, 0, 0)
    const outBitmap =
      typeof createImageBitmap === 'function'
        ? // sync path unavailable — upload from canvas via copyExternalImageToTexture
          null
        : null
    void outBitmap
    const tex = this.device!.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.device!.queue.copyExternalImageToTexture(
      { source: canvas as OffscreenCanvas | HTMLCanvasElement },
      { texture: tex },
      [w, h],
    )
    this.textures.set(key, tex)
    return tex
  }

  draw(
    pass: GPURenderPassEncoder,
    items: RenderItem[],
    cameraMatrix: readonly number[],
    viewport: { w: number; h: number },
    textures?: TextureResolver,
  ): number {
    if (!this.device || !this.pipeline || !this.sampler || !this.uniformBuffer) return 0
    let draws = 0
    const uniform = new Float32Array(16)
    uniform[0] = cameraMatrix[0]!
    uniform[1] = cameraMatrix[1]!
    uniform[2] = 0
    uniform[4] = cameraMatrix[2]!
    uniform[5] = cameraMatrix[3]!
    uniform[6] = 0
    uniform[8] = cameraMatrix[4]!
    uniform[9] = cameraMatrix[5]!
    uniform[10] = 1
    uniform[12] = viewport.w
    uniform[13] = viewport.h
    this.device.queue.writeBuffer(this.uniformBuffer, 0, toBufferSource(uniform))

    for (const item of items) {
      if (item.kind !== 'image' || item.coords.length < 8) continue
      const assetId = item.assetId ?? ''
      const bitmap = textures?.getBitmap(assetId)
      const status = textures?.getStatus?.(assetId)
      let tex = this.placeholder!
      let bgKey = `${assetId}:ph`

      if (bitmap) {
        tex = this.ensureTexture(assetId, bitmap)
        bgKey = `${assetId}:ok`
        if (item.filters?.length) {
          const fkey = `${assetId}|${hashFilterStack(item.filters as FilterOp[])}`
          const filtered = this.frameFiltered.get(fkey)
          if (filtered) {
            tex = filtered
            bgKey = fkey
          }
        }
      } else if (status === 'error') {
        tex = this.errorTex!
        bgKey = `${assetId}:err`
      }

      const bg = this.bindGroupFor(bgKey, tex)
      const verts = this.quadVerts(item)
      const vbo = this.device.createBuffer({
        size: verts.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      })
      this.device.queue.writeBuffer(vbo, 0, toBufferSource(verts))
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, bg)
      pass.setVertexBuffer(0, vbo)
      pass.draw(6)
      draws++
      queueMicrotask(() => vbo.destroy())
    }
    return draws
  }

  dispose(): void {
    this.filters.dispose()
    this.frameFiltered.clear()
    for (const t of this.textures.values()) t.destroy()
    this.textures.clear()
    this.bindGroups.clear()
    this.placeholder?.destroy()
    this.errorTex?.destroy()
    this.uniformBuffer?.destroy()
  }

  private quadVerts(item: RenderItem): Float32Array {
    const c = item.coords
    const uv = item.uv ?? new Float64Array([0, 0, 1, 0, 1, 1, 0, 1])
    const idx = [0, 1, 2, 0, 2, 3]
    const out = new Float32Array(idx.length * 4)
    let o = 0
    for (const i of idx) {
      out[o++] = c[i * 2]!
      out[o++] = c[i * 2 + 1]!
      out[o++] = uv[i * 2]!
      out[o++] = uv[i * 2 + 1]!
    }
    return out
  }

  private ensureTexture(id: string, bitmap: ImageBitmap): GPUTexture {
    const existing = this.textures.get(id)
    if (existing) return existing
    const device = this.device!
    const tex = device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: tex },
      [bitmap.width, bitmap.height],
    )
    this.textures.set(id, tex)
    return tex
  }

  private bindGroupFor(key: string, tex: GPUTexture): GPUBindGroup {
    const hit = this.bindGroups.get(key)
    if (hit) return hit
    const bg = this.device!.createBindGroup({
      layout: this.pipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: tex.createView() },
        { binding: 2, resource: this.sampler! },
      ],
    })
    this.bindGroups.set(key, bg)
    return bg
  }

  private makeSolidTexture(device: GPUDevice, rgba: number[]): GPUTexture {
    const tex = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const data = new Uint8Array(rgba.map((v) => Math.round(v * 255)))
    device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: 4 }, [1, 1])
    return tex
  }
}

import type { RendererKind } from '@cadkit/types'
import {
  MemoryBudget,
  type FrameMetrics,
  type PickResult,
  type RenderFrameInput,
  type RendererBackend,
} from '@cadkit/render-core'
import type { RenderItem } from '@cadkit/scene'
import type { TextureResolver } from '@cadkit/render-core'
import { LINE_SHADER, PICK_SHADER } from './shaders.js'
import { ImagePass } from './image-pass.js'
import { isPaintVisible, parseColor } from './color.js'
import { packEntityFillVertices } from './fill-pack.js'

const PAGE_FLOATS = 256 * 1024 // ~1MB of floats per page

function toBufferSource(data: Float32Array): GPUAllowSharedBufferSource {
  // Prefer the existing buffer when it is already a plain ArrayBuffer view.
  if (data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data as unknown as GPUAllowSharedBufferSource
  }
  return new Float32Array(data) as unknown as GPUAllowSharedBufferSource
}

const IDENTITY_VIEW = [1, 0, 0, 1, 0, 0] as const

const ALPHA_BLEND: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
}

function parseClear(hex: string): [number, number, number] {
  const c = parseColor(hex)
  return [c[0], c[1], c[2]]
}

export class WebGPURenderer implements RendererBackend {
  readonly kind: RendererKind = 'webgpu'
  private canvas: HTMLCanvasElement | null = null
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private format: GPUTextureFormat = 'bgra8unorm'
  private pipeline: GPURenderPipeline | null = null
  private fillPipeline: GPURenderPipeline | null = null
  private pickPipeline: GPURenderPipeline | null = null
  private uniformBuffer: GPUBuffer | null = null
  /** Separate uniforms for screen-space overlays (grid); must not share entity camera matrix. */
  private overlayUniformBuffer: GPUBuffer | null = null
  private bindGroup: GPUBindGroup | null = null
  private overlayBindGroup: GPUBindGroup | null = null
  private fillBindGroup: GPUBindGroup | null = null
  /** Entity fills use camera uniforms (unlike page fill which is screen-space). */
  private entityFillBindGroup: GPUBindGroup | null = null
  private vertexBuffer: GPUBuffer | null = null
  private overlayVertexBuffer: GPUBuffer | null = null
  private fillVertexBuffer: GPUBuffer | null = null
  private entityFillVertexBuffer: GPUBuffer | null = null
  private vertexCapacity = 0
  private overlayVertexCapacity = 0
  private fillVertexCapacity = 0
  private entityFillVertexCapacity = 0
  private pickTexture: GPUTexture | null = null
  private pickBuffer: GPUBuffer | null = null
  private width = 1
  private height = 1
  private dpr = 1
  private gpuLost = false
  private readonly budget = new MemoryBudget(512)
  private lastItems: RenderItem[] = []
  private uploadBytes = 0
  private packScratch: Float32Array = new Float32Array(PAGE_FLOATS)
  private lastVertexCount = 0
  private lastGeometryUploadBytes = 0
  private lastGridVertexCount = 0
  private lastFillVertexCount = 0
  private lastEntityFillVertexCount = 0
  private readonly imagePass = new ImagePass()
  private textureResolver: TextureResolver | null = null

  static async isSupported(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false
    try {
      const adapter = await navigator.gpu.requestAdapter()
      return !!adapter
    } catch {
      return false
    }
  }

  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    if (!('gpu' in navigator)) throw new Error('WebGPU not available')
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('No GPU adapter')
    this.device = await adapter.requestDevice()
    this.device.lost.then(() => {
      this.gpuLost = true
    })
    this.canvas = canvas
    this.context = canvas.getContext('webgpu')
    if (!this.context) throw new Error('webgpu context failed')
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    })

    const module = this.device.createShaderModule({ code: LINE_SHADER })
    const colorVertexBuffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: 24,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32x4' },
        ],
      },
    ]
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsMain', buffers: colorVertexBuffers },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'line-list' },
    })
    this.fillPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsMain', buffers: colorVertexBuffers },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [{ format: this.format, blend: ALPHA_BLEND }],
      },
      primitive: { topology: 'triangle-list' },
    })

    const pickModule = this.device.createShaderModule({ code: PICK_SHADER })
    this.pickPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: pickModule,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 12,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'uint32' },
            ],
          },
        ],
      },
      fragment: {
        module: pickModule,
        entryPoint: 'fsMain',
        targets: [{ format: 'r32uint' }],
      },
      primitive: { topology: 'line-list' },
    })

    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.overlayUniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const layout = this.pipeline.getBindGroupLayout(0)
    this.bindGroup = this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    })
    this.overlayBindGroup = this.device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: this.overlayUniformBuffer } }],
    })
    this.fillBindGroup = this.device.createBindGroup({
      layout: this.fillPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.overlayUniformBuffer } }],
    })
    this.entityFillBindGroup = this.device.createBindGroup({
      layout: this.fillPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    })
    await this.imagePass.initialize(this.device, this.format)
  }

  resize(width: number, height: number, dpr: number): void {
    if (!this.canvas || !this.context || !this.device) return
    // Only resize the drawing buffer. CSS box is owned by Editor.layoutChrome
    // (absolute + gutter); writing style.width/height here collapses the layout.
    const nextW = Math.max(1, Math.floor(width * dpr))
    const nextH = Math.max(1, Math.floor(height * dpr))
    this.width = width
    this.height = height
    this.dpr = dpr
    // Assigning canvas.width clears the buffer — skip when nothing changed.
    if (this.canvas.width === nextW && this.canvas.height === nextH) return
    this.canvas.width = nextW
    this.canvas.height = nextH
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    })
    this.pickTexture?.destroy()
    this.pickTexture = this.device.createTexture({
      size: { width: this.canvas.width, height: this.canvas.height },
      format: 'r32uint',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    this.pickBuffer?.destroy()
    this.pickBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
  }

  setMemoryBudget(budgetMB: number): void {
    this.budget.setBudget(budgetMB)
  }

  setTextureResolver(resolver: TextureResolver | null): void {
    this.textureResolver = resolver
  }

  render(input: RenderFrameInput): FrameMetrics {
    const t0 = performance.now()
    if (
      !this.device ||
      !this.context ||
      !this.pipeline ||
      !this.fillPipeline ||
      !this.uniformBuffer ||
      !this.overlayUniformBuffer ||
      !this.bindGroup ||
      !this.overlayBindGroup ||
      !this.fillBindGroup ||
      !this.entityFillBindGroup
    ) {
      return this.emptyMetrics(0)
    }
    if (this.gpuLost) return { ...this.emptyMetrics(0), gpuLost: true }

    this.lastItems = input.items
    const tPack0 = performance.now()
    let vertexData: Float32Array
    let vertexCount: number
    let geometryUploadBytes = 0
    let entityFillData: Float32Array = new Float32Array(0)
    let entityFillCount = 0
    let entityFillBytes = 0
    if (input.skipGeometryUpload && this.lastVertexCount > 0 && this.vertexBuffer) {
      vertexCount = this.lastVertexCount
      vertexData = this.packScratch.subarray(0, 0)
      geometryUploadBytes = 0
      entityFillCount = this.lastEntityFillVertexCount
    } else {
      const packed = this.packVertices(input.items)
      vertexData = packed.vertexData
      vertexCount = packed.vertexCount
      geometryUploadBytes = packed.uploadBytes
      this.lastVertexCount = vertexCount
      this.lastGeometryUploadBytes = geometryUploadBytes
      const fills = packEntityFillVertices(input.items)
      entityFillData = fills.vertexData
      entityFillCount = fills.vertexCount
      entityFillBytes = fills.uploadBytes
      this.lastEntityFillVertexCount = entityFillCount
    }
    const packMs = performance.now() - tPack0

    const grid = input.grid
    const gridBytes = !input.skipGridUpload && grid ? grid.vertices.byteLength : 0
    const fillBytes = !input.skipGridUpload && grid?.fillVertices ? grid.fillVertices.byteLength : 0
    this.uploadBytes = geometryUploadBytes + gridBytes + fillBytes + entityFillBytes

    const tUpload0 = performance.now()
    // Separate vertex + uniform buffers: queue.writeBuffer runs before the submitted
    // command buffer, so sharing one buffer would let the last upload win for every draw.
    const needOverlayUniforms =
      (grid && grid.vertexCount > 0) || (grid && (grid.fillVertexCount ?? 0) > 0)
    if (needOverlayUniforms) {
      this.writeUniforms(this.overlayUniformBuffer, IDENTITY_VIEW)
    }
    if (!input.skipGridUpload && grid && (grid.fillVertexCount ?? 0) > 0 && grid.fillVertices) {
      this.ensureFillVertexBuffer(Math.max(fillBytes, 24))
      this.device.queue.writeBuffer(this.fillVertexBuffer!, 0, toBufferSource(grid.fillVertices))
      this.lastFillVertexCount = grid.fillVertexCount ?? 0
    }
    if (!input.skipGridUpload && grid && grid.vertexCount > 0) {
      this.ensureOverlayVertexBuffer(Math.max(gridBytes, 24))
      this.device.queue.writeBuffer(this.overlayVertexBuffer!, 0, toBufferSource(grid.vertices))
      this.lastGridVertexCount = grid.vertexCount
    }
    const drawGridCount = input.skipGridUpload ? this.lastGridVertexCount : (grid?.vertexCount ?? 0)
    const drawFillCount = input.skipGridUpload
      ? this.lastFillVertexCount
      : (grid?.fillVertexCount ?? 0)
    // Camera uniform always updates (pan-only path).
    if (vertexCount > 0 || entityFillCount > 0 || this.vertexBuffer || this.entityFillVertexBuffer) {
      if (!input.skipGeometryUpload && vertexCount > 0) {
        this.ensureVertexBuffer(Math.max(vertexData.byteLength, 24))
        this.device.queue.writeBuffer(this.vertexBuffer!, 0, toBufferSource(vertexData))
      }
      if (!input.skipGeometryUpload && entityFillCount > 0) {
        this.ensureEntityFillVertexBuffer(Math.max(entityFillData.byteLength, 24))
        this.device.queue.writeBuffer(
          this.entityFillVertexBuffer!,
          0,
          toBufferSource(entityFillData),
        )
      }
      this.writeUniforms(this.uniformBuffer!, input.camera.getWorldToScreen())
    }
    const uploadMs = performance.now() - tUpload0

    const textures = input.textures ?? this.textureResolver ?? undefined
    // Filter chains submit their own command buffers; must run before the scene pass.
    this.imagePass.prepareFilters(input.items, textures)

    const clear = parseClear(input.clearColor ?? '#ffffff')
    const encoder = this.device.createCommandEncoder()
    const view = this.context.getCurrentTexture().createView()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: clear[0], g: clear[1], b: clear[2], a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })

    let drawCalls = 0

    // Page fill under grid (screen-space)
    if (drawFillCount > 0 && this.fillVertexBuffer) {
      pass.setPipeline(this.fillPipeline)
      pass.setBindGroup(0, this.fillBindGroup)
      pass.setVertexBuffer(0, this.fillVertexBuffer)
      pass.draw(drawFillCount)
      drawCalls++
    }

    if (drawGridCount > 0 && this.overlayVertexBuffer) {
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, this.overlayBindGroup)
      pass.setVertexBuffer(0, this.overlayVertexBuffer)
      pass.draw(drawGridCount)
      drawCalls++
    }

    // Entity fills (world-space) under strokes
    if (entityFillCount > 0 && this.entityFillVertexBuffer && this.entityFillBindGroup) {
      pass.setPipeline(this.fillPipeline)
      pass.setBindGroup(0, this.entityFillBindGroup)
      pass.setVertexBuffer(0, this.entityFillVertexBuffer)
      pass.draw(entityFillCount)
      drawCalls++
    }

    if (vertexCount > 0 && this.vertexBuffer) {
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, this.bindGroup)
      pass.setVertexBuffer(0, this.vertexBuffer)
      pass.draw(vertexCount)
      drawCalls++
    }

    drawCalls += this.imagePass.draw(
      pass,
      input.items,
      input.camera.getWorldToScreen(),
      { w: this.width, h: this.height },
      textures,
    )

    pass.end()
    const tSubmit0 = performance.now()
    this.device.queue.submit([encoder.finish()])
    const submitMs = performance.now() - tSubmit0
    this.budget.track(
      'vertices',
      (this.lastGeometryUploadBytes || vertexData.byteLength) +
        gridBytes +
        fillBytes +
        entityFillBytes,
    )

    return {
      frameMs: performance.now() - t0,
      drawCalls,
      visibleCount: input.items.length,
      uploadBytes: this.uploadBytes,
      geometryUploadBytes,
      memoryMB: this.budget.usedMB(),
      backend: 'webgpu',
      gpuLost: this.gpuLost,
      packMs,
      uploadMs,
      submitMs,
      sceneBuildMs: input.stats?.buildMs,
      mode: input.mode,
    }
  }

  private writeUniforms(buffer: GPUBuffer, m: readonly number[]): void {
    if (!this.device) return
    const uniform = new Float32Array(16)
    uniform[0] = m[0]!
    uniform[1] = m[1]!
    uniform[2] = 0
    uniform[3] = 0
    uniform[4] = m[2]!
    uniform[5] = m[3]!
    uniform[6] = 0
    uniform[7] = 0
    uniform[8] = m[4]!
    uniform[9] = m[5]!
    uniform[10] = 1
    uniform[11] = 0
    // Camera / grid use CSS pixels; pass CSS size (not device buffer size)
    uniform[12] = this.width
    uniform[13] = this.height
    this.device.queue.writeBuffer(buffer, 0, toBufferSource(uniform))
  }

  async pick(x: number, y: number): Promise<PickResult | null> {
    if (!this.device || !this.pickPipeline || !this.pickTexture || !this.pickBuffer || !this.uniformBuffer) {
      return null
    }
    const { pickData, vertexCount } = this.packPickVertices(this.lastItems)
    if (vertexCount === 0) return null
    const buf = this.device.createBuffer({
      size: pickData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(buf, 0, pickData)

    const bindGroup = this.device.createBindGroup({
      layout: this.pickPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    })

    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.pickTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.pickPipeline)
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, buf)
    pass.draw(vertexCount)
    pass.end()

    const px = Math.min(this.pickTexture.width - 1, Math.max(0, Math.floor(x * this.dpr)))
    const py = Math.min(this.pickTexture.height - 1, Math.max(0, Math.floor(y * this.dpr)))
    encoder.copyTextureToBuffer(
      { texture: this.pickTexture, origin: { x: px, y: py } },
      { buffer: this.pickBuffer, bytesPerRow: 256 },
      { width: 1, height: 1 },
    )
    this.device.queue.submit([encoder.finish()])
    await this.pickBuffer.mapAsync(GPUMapMode.READ)
    const id = new Uint32Array(this.pickBuffer.getMappedRange())[0] ?? 0
    this.pickBuffer.unmap()
    buf.destroy()
    if (!id) return null
    const entity = this.lastItems.find((i) => i.pickId === id)
    return { pickId: id, entityId: entity?.id }
  }

  dispose(): void {
    this.imagePass.dispose()
    this.vertexBuffer?.destroy()
    this.overlayVertexBuffer?.destroy()
    this.fillVertexBuffer?.destroy()
    this.entityFillVertexBuffer?.destroy()
    this.uniformBuffer?.destroy()
    this.overlayUniformBuffer?.destroy()
    this.pickTexture?.destroy()
    this.pickBuffer?.destroy()
    this.device?.destroy()
    this.device = null
    this.context = null
    this.canvas = null
    this.bindGroup = null
    this.overlayBindGroup = null
    this.fillBindGroup = null
    this.entityFillBindGroup = null
  }

  private packVertices(items: RenderItem[]): {
    vertexData: Float32Array
    vertexCount: number
    uploadBytes: number
  } {
    // Each line segment → 2 vertices * (x,y,r,g,b,a)
    let segments = 0
    for (const item of items) {
      if (item.kind === 'image' || item.kind === 'text') continue
      if (item.kind === 'line') segments += 1
      else if (item.coords.length >= 4) segments += item.coords.length / 2 - 1
    }
    const floats = Math.max(segments * 2 * 6, 6)
    if (this.packScratch.length < floats) {
      this.packScratch = new Float32Array(Math.max(floats, this.packScratch.length * 2))
    }
    const data = this.packScratch
    let o = 0
    for (const item of items) {
      if (item.kind === 'image' || item.kind === 'text') continue
      if (!isPaintVisible(item.stroke)) continue
      const [r, g, b, a] = parseColor(item.stroke)
      const c = item.coords
      if (item.kind === 'line' && c.length >= 4) {
        data[o++] = c[0]!; data[o++] = c[1]!; data[o++] = r; data[o++] = g; data[o++] = b; data[o++] = a
        data[o++] = c[2]!; data[o++] = c[3]!; data[o++] = r; data[o++] = g; data[o++] = b; data[o++] = a
        continue
      }
      for (let i = 0; i + 3 < c.length; i += 2) {
        data[o++] = c[i]!; data[o++] = c[i + 1]!; data[o++] = r; data[o++] = g; data[o++] = b; data[o++] = a
        data[o++] = c[i + 2]!; data[o++] = c[i + 3]!; data[o++] = r; data[o++] = g; data[o++] = b; data[o++] = a
      }
    }
    return { vertexData: data.subarray(0, o), vertexCount: o / 6, uploadBytes: o * 4 }
  }

  private packPickVertices(items: RenderItem[]): { pickData: ArrayBuffer; vertexCount: number } {
    let segments = 0
    for (const item of items) {
      if (item.kind === 'line') segments += 1
      else if (item.coords.length >= 4) segments += item.coords.length / 2 - 1
    }
    const buffer = new ArrayBuffer(Math.max(segments * 2 * 12, 12))
    const f32 = new Float32Array(buffer)
    const u32 = new Uint32Array(buffer)
    let fi = 0
    let ui = 0
    for (const item of items) {
      const c = item.coords
      const write = (x0: number, y0: number, x1: number, y1: number) => {
        f32[fi++] = x0; f32[fi++] = y0; u32[ui + 2] = item.pickId; fi++; ui = fi
        f32[fi++] = x1; f32[fi++] = y1; u32[ui + 2] = item.pickId; fi++; ui = fi
      }
      if (item.kind === 'line' && c.length >= 4) write(c[0]!, c[1]!, c[2]!, c[3]!)
      else {
        for (let i = 0; i + 3 < c.length; i += 2) write(c[i]!, c[i + 1]!, c[i + 2]!, c[i + 3]!)
      }
    }
    return { pickData: buffer.slice(0, fi * 4), vertexCount: fi / 3 }
  }

  private ensureVertexBuffer(bytes: number): void {
    if (!this.device) return
    const needed = Math.max(bytes, PAGE_FLOATS * 4)
    if (this.vertexBuffer && this.vertexCapacity >= needed) return
    this.vertexBuffer?.destroy()
    this.vertexCapacity = needed
    this.vertexBuffer = this.device.createBuffer({
      size: needed,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
  }

  private ensureOverlayVertexBuffer(bytes: number): void {
    if (!this.device) return
    const needed = Math.max(bytes, 64 * 1024)
    if (this.overlayVertexBuffer && this.overlayVertexCapacity >= needed) return
    this.overlayVertexBuffer?.destroy()
    this.overlayVertexCapacity = needed
    this.overlayVertexBuffer = this.device.createBuffer({
      size: needed,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
  }

  private ensureFillVertexBuffer(bytes: number): void {
    if (!this.device) return
    const needed = Math.max(bytes, 256)
    if (this.fillVertexBuffer && this.fillVertexCapacity >= needed) return
    this.fillVertexBuffer?.destroy()
    this.fillVertexCapacity = needed
    this.fillVertexBuffer = this.device.createBuffer({
      size: needed,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
  }

  private ensureEntityFillVertexBuffer(bytes: number): void {
    if (!this.device) return
    const needed = Math.max(bytes, 256)
    if (this.entityFillVertexBuffer && this.entityFillVertexCapacity >= needed) return
    this.entityFillVertexBuffer?.destroy()
    this.entityFillVertexCapacity = needed
    this.entityFillVertexBuffer = this.device.createBuffer({
      size: needed,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
  }

  private emptyMetrics(frameMs: number): FrameMetrics {
    return {
      frameMs,
      drawCalls: 0,
      visibleCount: 0,
      uploadBytes: this.uploadBytes,
      memoryMB: this.budget.usedMB(),
      backend: 'webgpu',
    }
  }
}


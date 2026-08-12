import type { RendererKind } from '@cadkit/types'
import {
  MemoryBudget,
  type FrameMetrics,
  type PickResult,
  type RenderFrameInput,
  type RendererBackend,
  type TextureResolver,
} from '@cadkit/render-core'
import type { RenderItem } from '@cadkit/scene'
import { LINE_SHADER, PICK_SHADER, RECT_STROKE_INSTANCE_SHADER } from './shaders.js'
import { ImagePass } from './image-pass.js'
import { parseColor } from './color.js'
import { packDrawOrder, type DrawOp } from './draw-order.js'
import { cssRectToScissor, panStripRects } from './incremental.js'

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

type GpuRedraw = NonNullable<FrameMetrics['gpuRedraw']>

export class WebGPURenderer implements RendererBackend {
  readonly kind: RendererKind = 'webgpu'
  private canvas: HTMLCanvasElement | null = null
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private format: GPUTextureFormat = 'bgra8unorm'
  private pipeline: GPURenderPipeline | null = null
  private fillPipeline: GPURenderPipeline | null = null
  private rectInstancePipeline: GPURenderPipeline | null = null
  private pickPipeline: GPURenderPipeline | null = null
  private rectInstanceBindGroup: GPUBindGroup | null = null
  private instanceBuffer: GPUBuffer | null = null
  private instanceCapacity = 0
  private lastInstanceCount = 0
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
  private lastDrawOps: DrawOp[] = []
  private readonly imagePass = new ImagePass()
  private textureResolver: TextureResolver | null = null
  /** Ping-pong persistent scene color targets (device pixels). */
  private sceneTextures: [GPUTexture | null, GPUTexture | null] = [null, null]
  private sceneIndex = 0
  private sceneValid = false
  private clearQuadBuffer: GPUBuffer | null = null
  private clearQuadCapacity = 0
  private lastClearColorKey = ''

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
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
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

    const rectModule = this.device.createShaderModule({ code: RECT_STROKE_INSTANCE_SHADER })
    this.rectInstancePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: rectModule,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 32,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              { shaderLocation: 1, offset: 16, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: rectModule,
        entryPoint: 'fsMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'line-list' },
    })
    this.rectInstanceBindGroup = this.device.createBindGroup({
      layout: this.rectInstancePipeline.getBindGroupLayout(0),
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
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
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
    this.destroySceneTextures()
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

    const bufW = this.canvas?.width ?? 1
    const bufH = this.canvas?.height ?? 1
    this.ensureSceneTextures(bufW, bufH)

    const panDxCss = input.panPixelDelta?.dx ?? 0
    const panDyCss = input.panPixelDelta?.dy ?? 0
    const panDx = Math.round(panDxCss * this.dpr)
    const panDy = Math.round(panDyCss * this.dpr)
    const panOk =
      this.sceneValid &&
      (panDx !== 0 || panDy !== 0) &&
      Math.abs(panDx) < bufW &&
      Math.abs(panDy) < bufH

    let gpuRedraw: GpuRedraw = 'full'
    if (input.dirtyFullscreen === false && this.sceneValid) {
      const hasDirty = !!(input.dirtyScreenRects && input.dirtyScreenRects.length > 0)
      const wantsPan =
        !!input.panPixelDelta &&
        (input.panPixelDelta.dx !== 0 || input.panPixelDelta.dy !== 0)
      if (wantsPan && !hasDirty) {
        gpuRedraw = panOk ? 'pan-blit' : 'full'
      } else if (hasDirty) {
        gpuRedraw = 'dirty'
      } else {
        gpuRedraw = 'present'
      }
    }

    this.lastItems = input.items
    const tPack0 = performance.now()
    let vertexData: Float32Array
    let vertexCount: number
    let geometryUploadBytes = 0
    let entityFillData: Float32Array = new Float32Array(0)
    let entityFillCount = 0
    let instanceData: Float32Array = new Float32Array(0)
    let instanceCount = 0
    let drawOps: DrawOp[] = this.lastDrawOps
    const skipAllGpuWork = gpuRedraw === 'present'
    const canSkipGeom =
      !skipAllGpuWork &&
      input.skipGeometryUpload &&
      this.lastDrawOps.length > 0 &&
      (this.vertexBuffer != null ||
        this.entityFillVertexBuffer != null ||
        this.instanceBuffer != null)
    if (skipAllGpuWork) {
      vertexCount = this.lastVertexCount
      vertexData = this.packScratch.subarray(0, 0)
      entityFillCount = this.lastEntityFillVertexCount
      instanceCount = this.lastInstanceCount
    } else if (canSkipGeom) {
      vertexCount = this.lastVertexCount
      vertexData = this.packScratch.subarray(0, 0)
      geometryUploadBytes = 0
      entityFillCount = this.lastEntityFillVertexCount
      instanceCount = this.lastInstanceCount
    } else {
      const packed = packDrawOrder(input.items, this.packScratch)
      this.packScratch = packed.strokeScratch
      vertexData = packed.strokeData
      vertexCount = packed.strokeVertexCount
      entityFillData = packed.fillData
      entityFillCount = packed.fillVertexCount
      instanceData = packed.instanceData
      instanceCount = packed.instanceCount
      geometryUploadBytes = packed.uploadBytes
      drawOps = packed.ops
      this.lastVertexCount = vertexCount
      this.lastGeometryUploadBytes = geometryUploadBytes
      this.lastEntityFillVertexCount = entityFillCount
      this.lastInstanceCount = instanceCount
      this.lastDrawOps = drawOps
    }
    const packMs = performance.now() - tPack0

    const grid = input.grid
    const gridBytes = !skipAllGpuWork && !input.skipGridUpload && grid ? grid.vertices.byteLength : 0
    const fillBytes =
      !skipAllGpuWork && !input.skipGridUpload && grid?.fillVertices
        ? grid.fillVertices.byteLength
        : 0
    this.uploadBytes = geometryUploadBytes + gridBytes + fillBytes

    const tUpload0 = performance.now()
    const drawGridCount = input.skipGridUpload ? this.lastGridVertexCount : (grid?.vertexCount ?? 0)
    const drawFillCount = input.skipGridUpload
      ? this.lastFillVertexCount
      : (grid?.fillVertexCount ?? 0)

    if (!skipAllGpuWork) {
      // Separate vertex + uniform buffers: queue.writeBuffer runs before the submitted
      // command buffer, so sharing one buffer would let the last upload win for every draw.
      const needOverlayUniforms = drawGridCount > 0 || drawFillCount > 0
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
      if (
        vertexCount > 0 ||
        entityFillCount > 0 ||
        instanceCount > 0 ||
        this.vertexBuffer ||
        this.entityFillVertexBuffer ||
        this.instanceBuffer
      ) {
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
        if (!input.skipGeometryUpload && instanceCount > 0) {
          this.ensureInstanceBuffer(Math.max(instanceData.byteLength, 32))
          this.device.queue.writeBuffer(this.instanceBuffer!, 0, toBufferSource(instanceData))
        }
        this.writeUniforms(this.uniformBuffer!, input.camera.getWorldToScreen())
      }
    }
    const uploadMs = performance.now() - tUpload0

    const textures = input.textures ?? this.textureResolver ?? undefined
    if (!skipAllGpuWork) {
      // Filter chains submit their own command buffers; must run before the scene pass.
      this.imagePass.prepareFilters(input.items, textures)
    }

    const clear = parseClear(input.clearColor ?? '#ffffff')
    const encoder = this.device.createCommandEncoder()
    let drawCalls = 0

    if (gpuRedraw === 'present') {
      this.copySceneToSwapchain(encoder)
    } else if (gpuRedraw === 'pan-blit') {
      const src = this.sceneTextures[this.sceneIndex]!
      const dstIndex = 1 - this.sceneIndex
      const dst = this.sceneTextures[dstIndex]!
      // Clear destination, copy shifted previous frame, redraw uncovered strips.
      {
        const clearPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: dst.createView(),
              clearValue: { r: clear[0], g: clear[1], b: clear[2], a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        clearPass.end()
      }
      const copyW = bufW - Math.abs(panDx)
      const copyH = bufH - Math.abs(panDy)
      if (copyW > 0 && copyH > 0) {
        encoder.copyTextureToTexture(
          {
            texture: src,
            origin: { x: Math.max(0, -panDx), y: Math.max(0, -panDy) },
          },
          {
            texture: dst,
            origin: { x: Math.max(0, panDx), y: Math.max(0, panDy) },
          },
          { width: copyW, height: copyH },
        )
      }
      this.sceneIndex = dstIndex
      const strips = panStripRects(this.width, this.height, panDxCss, panDyCss)
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: dst.createView(),
            loadOp: 'load',
            storeOp: 'store',
          },
        ],
      })
      for (const strip of strips) {
        const sc = cssRectToScissor(strip, this.dpr, bufW, bufH)
        if (!sc) continue
        pass.setScissorRect(sc.x, sc.y, sc.w, sc.h)
        drawCalls += this.drawSceneContents(
          pass,
          input,
          drawOps,
          drawFillCount,
          drawGridCount,
          textures,
          clear,
          true,
        )
      }
      pass.end()
      this.sceneValid = true
      this.copySceneToSwapchain(encoder)
    } else if (gpuRedraw === 'dirty') {
      const target = this.sceneTextures[this.sceneIndex]!
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target.createView(),
            loadOp: 'load',
            storeOp: 'store',
          },
        ],
      })
      for (const rect of input.dirtyScreenRects ?? []) {
        const sc = cssRectToScissor(rect, this.dpr, bufW, bufH)
        if (!sc) continue
        pass.setScissorRect(sc.x, sc.y, sc.w, sc.h)
        drawCalls += this.drawSceneContents(
          pass,
          input,
          drawOps,
          drawFillCount,
          drawGridCount,
          textures,
          clear,
          true,
        )
      }
      pass.end()
      this.sceneValid = true
      this.copySceneToSwapchain(encoder)
    } else {
      const target = this.sceneTextures[this.sceneIndex]!
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target.createView(),
            clearValue: { r: clear[0], g: clear[1], b: clear[2], a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      drawCalls += this.drawSceneContents(
        pass,
        input,
        drawOps,
        drawFillCount,
        drawGridCount,
        textures,
        clear,
        false,
      )
      pass.end()
      this.sceneValid = true
      this.copySceneToSwapchain(encoder)
    }

    const tSubmit0 = performance.now()
    this.device.queue.submit([encoder.finish()])
    const submitMs = performance.now() - tSubmit0
    this.budget.track(
      'vertices',
      (this.lastGeometryUploadBytes || vertexData.byteLength) + gridBytes + fillBytes,
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
      gpuRedraw,
    }
  }

  private drawSceneContents(
    pass: GPURenderPassEncoder,
    input: RenderFrameInput,
    drawOps: DrawOp[],
    drawFillCount: number,
    drawGridCount: number,
    textures: TextureResolver | undefined,
    clear: [number, number, number],
    clearScissorFirst: boolean,
  ): number {
    let drawCalls = 0
    if (clearScissorFirst) {
      drawCalls += this.drawClearQuad(pass, clear)
    }

    // Page fill under grid (screen-space)
    if (drawFillCount > 0 && this.fillVertexBuffer) {
      pass.setPipeline(this.fillPipeline!)
      pass.setBindGroup(0, this.fillBindGroup!)
      pass.setVertexBuffer(0, this.fillVertexBuffer)
      pass.draw(drawFillCount)
      drawCalls++
    }

    if (drawGridCount > 0 && this.overlayVertexBuffer) {
      pass.setPipeline(this.pipeline!)
      pass.setBindGroup(0, this.overlayBindGroup!)
      pass.setVertexBuffer(0, this.overlayVertexBuffer)
      pass.draw(drawGridCount)
      drawCalls++
    }

    // Entities: interleaved fill / stroke / image in zOrder (layer stack).
    const camMatrix = input.camera.getWorldToScreen()
    const viewport = { w: this.width, h: this.height }
    for (const op of drawOps) {
      if (op.kind === 'fill') {
        if (
          op.vertexCount <= 0 ||
          !this.entityFillVertexBuffer ||
          !this.entityFillBindGroup ||
          !this.fillPipeline
        ) {
          continue
        }
        pass.setPipeline(this.fillPipeline)
        pass.setBindGroup(0, this.entityFillBindGroup)
        pass.setVertexBuffer(0, this.entityFillVertexBuffer)
        pass.draw(op.vertexCount, 1, op.firstVertex)
        drawCalls++
      } else if (op.kind === 'stroke') {
        if (op.vertexCount <= 0 || !this.vertexBuffer || !this.bindGroup || !this.pipeline) continue
        pass.setPipeline(this.pipeline)
        pass.setBindGroup(0, this.bindGroup)
        pass.setVertexBuffer(0, this.vertexBuffer)
        pass.draw(op.vertexCount, 1, op.firstVertex)
        drawCalls++
      } else if (op.kind === 'rectStroke') {
        if (
          op.instanceCount <= 0 ||
          !this.instanceBuffer ||
          !this.rectInstancePipeline ||
          !this.rectInstanceBindGroup
        ) {
          continue
        }
        pass.setPipeline(this.rectInstancePipeline)
        pass.setBindGroup(0, this.rectInstanceBindGroup)
        pass.setVertexBuffer(0, this.instanceBuffer)
        pass.draw(8, op.instanceCount, 0, op.firstInstance)
        drawCalls++
      } else {
        const item = input.items[op.itemIndex]
        if (!item) continue
        drawCalls += this.imagePass.draw(pass, [item], camMatrix, viewport, textures)
      }
    }
    return drawCalls
  }

  private drawClearQuad(pass: GPURenderPassEncoder, clear: [number, number, number]): number {
    if (!this.device || !this.fillPipeline || !this.fillBindGroup) return 0
    this.ensureClearQuad(clear)
    if (!this.clearQuadBuffer) return 0
    this.writeUniforms(this.overlayUniformBuffer!, IDENTITY_VIEW)
    pass.setPipeline(this.fillPipeline)
    pass.setBindGroup(0, this.fillBindGroup)
    pass.setVertexBuffer(0, this.clearQuadBuffer)
    pass.draw(6)
    return 1
  }

  private ensureClearQuad(clear: [number, number, number]): void {
    if (!this.device) return
    const key = `${this.width}|${this.height}|${clear[0]}|${clear[1]}|${clear[2]}`
    if (this.clearQuadBuffer && this.lastClearColorKey === key) return
    const w = this.width
    const h = this.height
    const [r, g, b] = clear
    const data = new Float32Array([
      0, 0, r, g, b, 1,
      w, 0, r, g, b, 1,
      w, h, r, g, b, 1,
      0, 0, r, g, b, 1,
      w, h, r, g, b, 1,
      0, h, r, g, b, 1,
    ])
    const bytes = data.byteLength
    if (!this.clearQuadBuffer || this.clearQuadCapacity < bytes) {
      this.clearQuadBuffer?.destroy()
      this.clearQuadCapacity = bytes
      this.clearQuadBuffer = this.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      })
    }
    this.device.queue.writeBuffer(this.clearQuadBuffer, 0, toBufferSource(data))
    this.lastClearColorKey = key
  }

  private ensureSceneTextures(bufW: number, bufH: number): void {
    if (!this.device) return
    const w = Math.max(1, bufW)
    const h = Math.max(1, bufH)
    for (let i = 0; i < 2; i++) {
      const tex = this.sceneTextures[i]
      if (tex && tex.width === w && tex.height === h) continue
      tex?.destroy()
      this.sceneTextures[i] = this.device.createTexture({
        size: { width: w, height: h },
        format: this.format,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      })
      this.sceneValid = false
    }
  }

  private destroySceneTextures(): void {
    for (let i = 0; i < 2; i++) {
      this.sceneTextures[i]?.destroy()
      this.sceneTextures[i] = null
    }
    this.sceneIndex = 0
    this.sceneValid = false
  }

  private copySceneToSwapchain(encoder: GPUCommandEncoder): void {
    if (!this.context || !this.canvas) return
    const src = this.sceneTextures[this.sceneIndex]
    if (!src) return
    const dst = this.context.getCurrentTexture()
    const w = Math.min(src.width, dst.width)
    const h = Math.min(src.height, dst.height)
    if (w <= 0 || h <= 0) return
    encoder.copyTextureToTexture({ texture: src }, { texture: dst }, { width: w, height: h })
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
    this.instanceBuffer?.destroy()
    this.clearQuadBuffer?.destroy()
    this.clearQuadBuffer = null
    this.destroySceneTextures()
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
    this.rectInstanceBindGroup = null
  }

  private packPickVertices(items: RenderItem[]): { pickData: ArrayBuffer; vertexCount: number } {
    let segments = 0
    for (const item of items) {
      if (item.kind === 'image' || item.kind === 'text') continue
      if (item.kind === 'instance' && item.coords.length >= 4) segments += 4
      else if (item.kind === 'line') segments += 1
      else if (item.coords.length >= 4) segments += item.coords.length / 2 - 1
    }
    const buffer = new ArrayBuffer(Math.max(segments * 2 * 12, 12))
    const f32 = new Float32Array(buffer)
    const u32 = new Uint32Array(buffer)
    let fi = 0
    let ui = 0
    for (const item of items) {
      if (item.kind === 'image' || item.kind === 'text') continue
      const c = item.coords
      const write = (x0: number, y0: number, x1: number, y1: number) => {
        f32[fi++] = x0; f32[fi++] = y0; u32[ui + 2] = item.pickId; fi++; ui = fi
        f32[fi++] = x1; f32[fi++] = y1; u32[ui + 2] = item.pickId; fi++; ui = fi
      }
      if (item.kind === 'instance' && c.length >= 4) {
        const x = c[0]!
        const y = c[1]!
        const w = c[2]!
        const h = c[3]!
        write(x, y, x + w, y)
        write(x + w, y, x + w, y + h)
        write(x + w, y + h, x, y + h)
        write(x, y + h, x, y)
        continue
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

  private ensureInstanceBuffer(bytes: number): void {
    if (!this.device) return
    const needed = Math.max(bytes, 256)
    if (this.instanceBuffer && this.instanceCapacity >= needed) return
    this.instanceBuffer?.destroy()
    this.instanceCapacity = needed
    this.instanceBuffer = this.device.createBuffer({
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


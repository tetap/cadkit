import {
  type AABB,
  type CapabilityReport,
  type Disposer,
  type EditorConfig,
  type EditorConfigPatch,
  type EditorLifecycle,
  type Entity,
  type EntityId,
  type EventName,
  type EditorEvents,
  type FramePhase,
  type GroupEntity,
  type InteractionConfig,
  type LengthUnit,
  type LayerId,
  type ScreenPoint,
  type SelectionHitMode,
  type TextEntity,
  type ImageEntity,
  createEntityId,
  createEventBus,
  createGroupId,
  isValidAABB,
  mergeEditorConfig,
  screenPoint,
  worldPoint,
  IDENTITY_TRANSFORM,
} from '@cadkit/types'
import {
  Camera2D,
  applyAffineToEntity,
  booleanEntities,
  entitySupportsBoolean,
  entityWorldBounds,
  offsetEntities,
  RASTER_DPI,
  SVG_DPI,
  rasterPixelsToWorld,
  resolveWorldMatrix,
  scale as scaleMatrix,
  svgUserUnitsToWorld,
  transformPoint,
  type BooleanOp,
  type BooleanOptions,
  type LengthUnit as GeomUnit,
  type OffsetOptions,
  clearTextOutlineCache,
} from '@cadkit/geometry'
import {
  CadDocument,
  ChunkStore,
  DEFAULT_LAYER_GCODE,
  isImageLayer,
  layerAcceptsEntity,
  layerFillFromStroke,
  resolveLayerGcode,
  type Layer,
} from '@cadkit/document'
import {
  AddEntityCommand,
  BatchCommand,
  GroupCommand,
  HistoryStack,
  MutateEntitiesCommand,
  RemoveEntityCommand,
  ReorderEntitiesCommand,
  UngroupCommand,
  UpdateEntityCommand,
} from '@cadkit/commands'
import type { DocumentChange } from '@cadkit/document'
import { SceneProjector } from '@cadkit/scene'
import {
  DirtyRegionTracker,
  type FrameMetrics,
  type RendererBackend,
  type ScreenRect,
} from '@cadkit/render-core'
import { WebGPURenderer } from '@cadkit/render-webgpu'
import {
  HandleOverlay,
  SelectionSet,
  TextOverlay,
  ToolManager,
  buildTransformHandles,
  anchorsToCubicPoints,
  createBuiltinTools,
  aabbCenter,
  patchesFromMatrix,
  pickEntity,
  scaleMatrixAbout,
  selectionWorldBounds,
  type AlignGuide,
  type PreviewPrimitive,
  type TextDraftState,
  type ToolName,
} from '@cadkit/interaction'
import { ImeTextEditor } from '@cadkit/text'
import {
  AssetRegistry,
  applyFilterStackRgba,
  createFilterId,
  type FilterOp,
} from '@cadkit/assets'
import { parseSvg, exportSvgDocument } from '@cadkit/io-svg'
import { importDxf } from '@cadkit/io-dxf'
import {
  buildToolpaths,
  emitGrbl,
  importGcode,
  type GcodeExportOptions,
  type GcodeToolpathPlan,
  type ImageRasterSample,
} from '@cadkit/io-gcode'
import { detectCapabilities, ensureEditorHost, resolveView } from '@cadkit/platform-web'
import { WORKER_ABI } from '@cadkit/worker-runtime'
import {
  DARK_RULER_THEME,
  DARK_GRID_STYLE,
  DEFAULT_GRID_STYLE,
  LIGHT_RULER_THEME,
  RulerOverlay,
  ScrollbarOverlay,
  buildGridGeometry,
} from '@cadkit/guides'
import { PluginHost, type EditorPlugin } from './plugin.js'

export interface CreateEditorOptions extends EditorConfigPatch {}

export class Editor {
  readonly config: EditorConfig
  readonly events = createEventBus()
  readonly document: CadDocument
  readonly camera = new Camera2D()
  readonly selection = new SelectionSet()
  readonly history: HistoryStack
  readonly scene: SceneProjector
  readonly chunks = new ChunkStore()
  readonly assets = new AssetRegistry()
  readonly tools: ToolManager
  readonly import: {
    svg: (source: string, opts?: { signal?: AbortSignal }) => Promise<void>
    dxf: (source: string | File, opts?: { signal?: AbortSignal }) => Promise<void>
    gcode: (source: string | File, opts?: { signal?: AbortSignal }) => Promise<void>
    image: (source: File | Blob | string) => Promise<EntityId | null>
  }
  readonly export: {
    /** SVG matching canvas paint (world space + layer line/fill mode). */
    svg: () => string
    json: () => string
    /**
     * GRBL laser G-code using per-layer engraver params.
     * Includes image raster scan engraving (Floyd dither → serpentine burns).
     */
    gcode: (opts?: GcodeExportOptions) => Promise<string>
    /** Optimized toolpath plan (CAD space) for preview / scrubbing. */
    toolpaths: (opts?: GcodeExportOptions) => Promise<GcodeToolpathPlan>
  }

  private lifecycle: EditorLifecycle = 'created'
  private host: HTMLElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private renderer: RendererBackend | null = null
  private rulers: RulerOverlay | null = null
  private scrollbars: ScrollbarOverlay | null = null
  private handleOverlay: HandleOverlay | null = null
  private capabilities: CapabilityReport | null = null
  private raf = 0
  private resizeRaf = 0
  private disposed = false
  private readonly plugins = new PluginHost(this)
  private lastMetrics: FrameMetrics | null = null
  private resizeObserver: ResizeObserver | null = null
  private displayUnit: LengthUnit
  private worldUnit: LengthUnit
  private gridVisible: boolean
  /** Raster import DPI (CSS default 96). */
  private rasterDpi = RASTER_DPI
  /** SVG unitless user-unit DPI (default 72). */
  private svgDpi = SVG_DPI
  private alignGuides: AlignGuide[] = []
  private preview: PreviewPrimitive = { kind: 'none' }
  private previewLayer: HTMLDivElement | null = null
  /**
   * While set, offset preview is rebuilt from the live selection whenever
   * geometry moves (so the dashed result tracks drag / transform).
   */
  private liveOffsetOptions: OffsetOptions | null = null
  private textOverlay: TextOverlay | null = null
  private ime: ImeTextEditor | null = null
  private placeImageHandler: ((world: { x: number; y: number }) => void) | null = null
  private readonly onFontsSettled = (): void => {
    // Drop fallback-face outlines; rebuild GPU text paths + live offset preview.
    clearTextOutlineCache()
    this.scene.invalidateGeometryCache()
    if (this.liveOffsetOptions) this.rebuildLiveOffsetPreview()
    this.refreshTextOverlay()
    this.requestRender()
  }

  private constructor(config: EditorConfig) {
    this.config = config
    this.worldUnit = config.document.unit
    this.displayUnit = config.document.displayUnit
    this.gridVisible = config.guides.grid
    this.document = new CadDocument(config.document)
    this.history = new HistoryStack(this.document)
    this.scene = new SceneProjector(this.document, config.performance)
    const ix = config.interaction
    this.tools = new ToolManager({
      doc: this.document,
      camera: this.camera,
      scene: this.scene,
      selection: this.selection,
      selectionHitMode: ix.selectionHitMode,
      snap: {
        enabled: ix.snapEnabled,
        pixelTolerance: ix.pixelTolerance,
        worldPerPixel: 1,
        gridSize: ix.gridSize,
        alignEnabled: ix.alignEnabled,
        showDistances: ix.showDistances,
        angleStepDeg: ix.angleStepDeg,
        panDamping: ix.panDamping,
      },
      ortho: false,
      commitChange: (change) => this.commitSceneChange(change),
      addEntity: (entity) => {
        const change = this.history.execute(new AddEntityCommand(entity))
        this.commitSceneChange(change)
      },
      applyPatches: (patches, coalesceKey) => {
        const change = this.history.execute(new MutateEntitiesCommand(patches, coalesceKey))
        this.commitSceneChange(change)
      },
      removeEntities: (ids) => {
        const cmds = ids.map((id) => new RemoveEntityCommand(id))
        const change = this.history.execute(new BatchCommand(cmds))
        this.commitSceneChange(change)
        for (const id of ids) this.selection.remove(id)
        this.events.emit('selection:change', { ids: this.selection.toArray() })
      },
      onEntityCreated: () => {
        this.requestRender()
        // Drawing tools are one-shot: return to Select (V) after placing.
        if (this.tools.getActive() !== 'select') {
          this.setTool('select')
        }
      },
      onSelectionEdited: () => {
        this.events.emit('selection:change', { ids: this.selection.toArray() })
        this.refreshHandles()
        // Keep offset dialog preview glued to the moving selection.
        if (this.liveOffsetOptions) this.rebuildLiveOffsetPreview()
        this.requestRender()
      },
      onCameraChanged: () => {
        this.notifyCameraChanged()
      },
      onToolChanged: (tool) => {
        this.events.emit('tool:change', { tool })
        this.syncToolCursor()
      },
      onAlignGuides: (guides) => {
        this.alignGuides = guides
        this.refreshHandles()
      },
      onPreview: (preview) => {
        // Drawing-tool rubber bands replace any live offset preview session.
        if (preview.kind !== 'none') this.liveOffsetOptions = null
        this.preview = preview
        this.refreshPreview()
      },
      beginTextEdit: (opts) => {
        this.ime?.dispose()
        const zoom = this.camera.getState().zoom
        const worldFontSize = opts.worldFontSize ?? opts.fontSize / Math.max(zoom, 1e-6)
        const applyDraft = (content: string, selStart: number, selEnd: number) => {
          const a = Math.max(0, Math.min(selStart, content.length))
          const b = Math.max(0, Math.min(selEnd, content.length))
          this.textOverlay?.setDraft({
            entityId: opts.entityId ?? null,
            layerId: opts.layerId,
            content,
            caret: b,
            selStart: a,
            selEnd: b,
            world: { x: opts.world.x, y: opts.world.y },
            fontSize: worldFontSize,
            fontFamily: opts.fontFamily ?? 'ui-sans-serif, system-ui, sans-serif',
            color: opts.color ?? '#111827',
            align: opts.align,
            widthFactor: opts.widthFactor,
            rotation: opts.rotation,
            path: opts.path,
          })
          this.refreshTextOverlay()
          // Selection frame tracks draft metrics while IME is live.
          this.refreshHandles()
          const caretScreen = this.textOverlay?.getCaretScreen(this.camera)
          if (caretScreen && this.ime?.isActive()) {
            const rect = this.canvas?.getBoundingClientRect()
            this.ime.moveTo(
              (rect?.left ?? 0) + caretScreen.x,
              (rect?.top ?? 0) + caretScreen.y + caretScreen.fontSizePx,
              caretScreen.fontSizePx,
            )
          }
          this.syncToolCursor()
        }
        // Seed draft so click→caret hit-testing can run before IME starts.
        applyDraft(opts.initial, opts.initial.length, opts.initial.length)
        let caret = opts.initial.length
        if (opts.clickScreen && this.textOverlay) {
          caret = this.textOverlay.caretIndexAt(opts.clickScreen, this.camera)
        }
        applyDraft(opts.initial, caret, caret)
        const caretScreen = this.textOverlay?.getCaretScreen(this.camera)
        const rect = this.canvas?.getBoundingClientRect()
        const clientX = (rect?.left ?? 0) + (caretScreen?.x ?? opts.screenX)
        const clientY =
          (rect?.top ?? 0) +
          (caretScreen ? caretScreen.y + caretScreen.fontSizePx : opts.screenY)
        this.ime = new ImeTextEditor({
          container: document.body,
          onChange: (text) => {
            const sel = this.ime?.getSelection()
            applyDraft(text, sel?.start ?? text.length, sel?.end ?? text.length)
          },
          onSelectionChange: (sel) => {
            applyDraft(sel.text, sel.start, sel.end)
          },
          onCommit: (text) => {
            this.textOverlay?.setDraft(null)
            opts.onCommit(text)
            this.refreshTextOverlay()
            this.syncToolCursor()
            this.requestRender()
          },
          onCancel: () => {
            this.textOverlay?.setDraft(null)
            opts.onCancel()
            this.refreshTextOverlay()
            this.syncToolCursor()
            this.requestRender()
          },
        })
        this.ime.start(
          opts.initial,
          clientX,
          clientY,
          caretScreen?.fontSizePx ?? opts.fontSize,
          {
            fontFamily: opts.fontFamily,
            color: opts.color,
            width: opts.widthPx,
            textAlign: opts.align,
          },
          { start: caret, end: caret },
        )
      },
      cancelTextEdit: () => this.ime?.stop(false),
      commitTextEdit: () => this.ime?.stop(true),
      isTextEditing: () => this.ime?.isActive() ?? false,
      retainTextEditFocus: () => this.ime?.retainFocus(),
      hitTestTextEdit: (screen) =>
        this.textOverlay?.hitTestDraft(screen, this.camera) ?? false,
      textCaretIndexAt: (screen) =>
        this.textOverlay?.caretIndexAt(screen, this.camera) ?? 0,
      setTextSelection: (start, end) => this.ime?.setSelection(start, end),
      getTextSelection: () => this.ime?.getSelection() ?? { start: 0, end: 0 },
      placeImageAt: (world) => this.placeImageHandler?.(world),
    })
    this.tools.registerBuiltinShapes(createBuiltinTools())
    this.import = {
      svg: (source, opts) => this.importSvg(source, opts),
      dxf: (source, opts) => this.importDxf(source, opts),
      gcode: (source, opts) => this.importGcode(source, opts),
      image: async (source: File | Blob | string) => this.importImage(source),
    }
    this.export = {
      svg: () =>
        exportSvgDocument({
          entities: this.document.getEntities(),
          layers: this.document.getLayers(),
          getEntity: (id) => this.document.getEntity(id),
        }),
      json: () => JSON.stringify(this.document.toJSON(), null, 2),
      gcode: async (opts) => {
        const plan = await this.export.toolpaths(opts)
        return emitGrbl(plan)
      },
      toolpaths: async (opts) =>
        buildToolpaths(
          {
            entities: this.document.getEntities(),
            layers: this.document.getLayers(),
            getEntity: (id) => this.document.getEntity(id),
            imageRasters: await this.prepareImageRasters(),
          },
          opts,
        ),
    }
  }

  /**
   * Sample visible image entities into continuous luma grids for PWM engraving.
   * Resolution follows the image layer's `lineSpacing` (scanline pitch in mm).
   */
  private async prepareImageRasters(): Promise<Map<EntityId, ImageRasterSample>> {
    const out = new Map<EntityId, ImageRasterSample>()
    const lookup = (id: EntityId) => this.document.getEntity(id)
    // Cap keeps G-code size bounded; 4096² ≈ fine photo at ~0.05–0.1 mm pitch on A5.
    const maxDim = 4096

    for (const e of this.document.getEntities()) {
      if (e.type !== 'image' || e.style.visible === false) continue
      const layer = this.document.getLayer(e.layerId)
      if (layer && layer.visible === false) continue
      const assetId = e.assetId
      if (!assetId) continue
      const bitmap = this.assets.get(assetId as never)?.bitmap
      if (!bitmap) continue

      const g = resolveLayerGcode(layer)
      const spacing = Math.max(1e-4, g.lineSpacing)
      let cols = Math.max(1, Math.round(e.width / spacing))
      let rows = Math.max(1, Math.round(e.height / spacing))
      if (cols > maxDim || rows > maxDim) {
        const s = Math.max(cols / maxDim, rows / maxDim)
        cols = Math.max(1, Math.round(cols / s))
        rows = Math.max(1, Math.round(rows / s))
      }

      const rgba = await sampleBitmapRgba(bitmap, cols, rows)
      // Match canvas: apply the same filter stack before sampling luma for G-code.
      const filters = (e.filters ?? []) as FilterOp[]
      if (filters.length) applyFilterStackRgba(rgba, cols, rows, filters)
      const { luma, alpha } = rgbaToLumaAlpha(rgba, cols, rows)

      const world = resolveWorldMatrix(e, lookup)
      out.set(e.id, {
        origin: { ...e.origin },
        width: e.width,
        height: e.height,
        cols,
        rows,
        luma,
        alpha,
        engraveMode: 'grayscale',
        localToWorld: (p: { x: number; y: number }) => transformPoint(world, p),
      })
    }
    return out
  }

  static async create(options: CreateEditorOptions = {}): Promise<Editor> {
    const config = mergeEditorConfig(options)
    const editor = new Editor(config)
    await editor.initialize()
    return editor
  }

  getLifecycle(): EditorLifecycle {
    return this.lifecycle
  }

  getCapabilities(): CapabilityReport | null {
    return this.capabilities
  }

  getWorkerAbi() {
    return WORKER_ABI
  }

  getMetrics(): FrameMetrics | null {
    return this.lastMetrics
  }

  getDisplayUnit(): LengthUnit {
    return this.displayUnit
  }

  getWorldUnit(): LengthUnit {
    return this.worldUnit
  }

  /** Switch ruler/grid display unit without rewriting geometry. */
  setDisplayUnit(unit: LengthUnit): void {
    this.displayUnit = unit
    this.config.document.displayUnit = unit
    this.rulers?.setUnits(this.worldUnit as GeomUnit, unit as GeomUnit)
    this.events.emit('camera:change', {
      zoom: this.camera.getState().zoom,
      center: { x: this.camera.getState().x, y: this.camera.getState().y, __space: 'world' },
    })
    this.requestRender()
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible
    this.config.guides.grid = visible
    this.requestRender()
  }

  setRulersVisible(visible: boolean): void {
    this.config.guides.rulers = visible
    this.rulers?.setVisible(visible)
    this.layoutChrome()
    this.requestRender()
  }

  getGridVisible(): boolean {
    return this.gridVisible
  }

  getRulersVisible(): boolean {
    return this.config.guides.rulers
  }

  /** DPI used when placing imported bitmaps into world units. */
  getRasterDpi(): number {
    return this.rasterDpi
  }

  setRasterDpi(dpi: number): void {
    if (!(dpi > 0) || !Number.isFinite(dpi)) return
    this.rasterDpi = dpi
  }

  /** DPI used when converting unitless SVG user units into world units. */
  getSvgDpi(): number {
    return this.svgDpi
  }

  setSvgDpi(dpi: number): void {
    if (!(dpi > 0) || !Number.isFinite(dpi)) return
    this.svgDpi = dpi
  }

  /** `unbounded` = infinite viewport grid; `page` = finite work area. */
  setWorkAreaMode(mode: 'unbounded' | 'page'): void {
    this.config.guides.workArea.mode = mode
    this.gridCacheKey = ''
    this.cachedGrid = null
    this.layoutChrome()
    if (mode === 'page') this.fitView()
    else this.requestRender()
  }

  /** Page size in document/storage units (used when mode is `page`). */
  setWorkAreaSize(width: number, height: number, originX = 0, originY = 0): void {
    const wa = this.config.guides.workArea
    wa.width = Math.max(1e-6, width)
    wa.height = Math.max(1e-6, height)
    wa.originX = originX
    wa.originY = originY
    this.gridCacheKey = ''
    this.cachedGrid = null
    if (wa.mode === 'page') this.fitView()
    else this.requestRender()
  }

  getWorkArea() {
    return { ...this.config.guides.workArea }
  }

  // —— Layers ——————————————————————————————————————————————————————————————

  getLayers(): Layer[] {
    return this.document.getLayers()
  }

  getActiveLayerId(): LayerId {
    return this.document.getDefaultLayerId()
  }

  setActiveLayer(id: LayerId): boolean {
    const ok = this.document.setDefaultLayerId(id)
    if (ok) this.requestRender()
    return ok
  }

  addLayer(input?: { name?: string; color?: string }): Layer {
    const layer = this.document.addLayer(input)
    this.document.setDefaultLayerId(layer.id)
    this.scene.notifyLayersChanged()
    this.requestRender()
    return layer
  }

  updateLayer(
    id: LayerId,
    patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'color' | 'gcode'>>,
  ): Layer | null {
    const prev = this.document.getLayer(id)
    const layer = this.document.updateLayer(id, patch)
    if (!layer) return null
    if (patch.color && patch.color !== prev?.color) {
      this.recolorLayerEntities(id, patch.color)
    }
    // `gcode.mode` changes canvas paint (line = stroke only / fill = fill + stroke).
    const modeChanged =
      patch.gcode?.mode !== undefined && patch.gcode.mode !== resolveLayerGcode(prev).mode
    const visualChange =
      patch.visible !== undefined ||
      patch.color !== undefined ||
      patch.name !== undefined ||
      patch.locked !== undefined ||
      modeChanged
    if (visualChange) {
      this.scene.notifyLayersChanged()
      this.refreshTextOverlay()
      this.requestRender()
    }
    return layer
  }

  removeLayer(id: LayerId): boolean {
    const ok = this.document.removeLayer(id)
    if (!ok) return false
    this.scene.rebuildIndex()
    this.requestRender()
    return true
  }

  /** Reorder layers (panel top = front). Returns the applied order. */
  reorderLayers(orderedIds: readonly LayerId[]): LayerId[] {
    const next = this.document.reorderLayers(orderedIds)
    this.scene.notifyLayersChanged()
    this.requestRender()
    return next
  }

  /** Front-to-back entity ids on a layer (index 0 = front). */
  getEntityOrder(layerId: LayerId): EntityId[] {
    return this.document.getEntityOrder(layerId)
  }

  /** Reorder entities on one layer (undoable). Panel top = front. */
  reorderEntitiesInLayer(layerId: LayerId, orderedIds: readonly EntityId[]): EntityId[] {
    const change = this.history.execute(
      new ReorderEntitiesCommand('reorder', [], layerId, orderedIds),
    )
    if (change) {
      this.scene.notifyStackChanged()
      this.requestRender()
    }
    return this.document.getEntityOrder(layerId)
  }

  bringSelectionToFront(): boolean {
    return this.applyStackOp('front')
  }

  sendSelectionToBack(): boolean {
    return this.applyStackOp('back')
  }

  bringSelectionForward(): boolean {
    return this.applyStackOp('forward')
  }

  sendSelectionBackward(): boolean {
    return this.applyStackOp('backward')
  }

  bringEntitiesToFront(ids: readonly EntityId[]): boolean {
    return this.applyStackOp('front', ids)
  }

  sendEntitiesToBack(ids: readonly EntityId[]): boolean {
    return this.applyStackOp('back', ids)
  }

  bringEntitiesForward(ids: readonly EntityId[]): boolean {
    return this.applyStackOp('forward', ids)
  }

  sendEntitiesBackward(ids: readonly EntityId[]): boolean {
    return this.applyStackOp('backward', ids)
  }

  private applyStackOp(
    op: 'front' | 'back' | 'forward' | 'backward',
    ids?: readonly EntityId[],
  ): boolean {
    const targets = ids ?? this.selection.toArray()
    if (!targets.length) return false
    const change = this.history.execute(new ReorderEntitiesCommand(op, targets))
    if (!change) return false
    this.scene.notifyStackChanged()
    this.requestRender()
    return true
  }

  /** Hit-test at a client (viewport) point; used by context menus. */
  pickAtClient(clientX: number, clientY: number): EntityId | null {
    if (!this.canvas) return null
    const screen = this.toScreen({ clientX, clientY })
    const world = this.camera.screenToWorld(screen)
    return pickEntity(
      { doc: this.document, camera: this.camera, scene: this.scene },
      world,
      screen,
    )
  }

  /** Move current selection onto a layer and tint with that layer's color. */
  moveSelectionToLayer(layerId: LayerId): void {
    this.moveEntitiesToLayer(this.selection.toArray(), layerId)
  }

  /** Move entities onto a layer and tint with that layer's color. */
  moveEntitiesToLayer(ids: readonly EntityId[], layerId: LayerId): void {
    const layer = this.document.getLayer(layerId)
    if (!layer || !ids.length) return
    const color = layer.color ?? '#32cd79'
    let moved = false
    for (const id of ids) {
      const e = this.document.getEntity(id)
      if (!e || e.type === 'group') continue
      // Image layers are raster-only; vector engraver layers reject images.
      if (!layerAcceptsEntity(layer, e)) continue
      if (e.type === 'image') {
        this.updateEntity(id, { layerId } as Partial<Entity>, 'layer-move')
        moved = true
        continue
      }
      const hasFill =
        !!e.style.fill &&
        e.style.fill !== 'none' &&
        e.style.fill !== 'transparent' &&
        !/00$/i.test(e.style.fill)
      let fill = e.style.fill
      if (e.type === 'text') fill = color
      else if (hasFill) fill = layerFillFromStroke(color)
      this.updateEntity(
        id,
        {
          layerId,
          style: { ...e.style, stroke: color, fill },
        } as Partial<Entity>,
        'layer-move',
      )
      moved = true
    }
    if (!moved) return
    this.events.emit('selection:change', { ids: this.selection.toArray() })
    this.requestRender()
  }

  /** Find or create a dedicated image layer (does not steal the active vector layer). */
  ensureImageLayer(): Layer {
    for (const layer of this.document.getLayers()) {
      if (isImageLayer(layer)) return layer
    }
    const activeId = this.document.getDefaultLayerId()
    const layer = this.document.addLayer({ name: 'Image', color: '#64748b' })
    this.document.updateLayer(layer.id, {
      gcode: {
        ...DEFAULT_LAYER_GCODE,
        mode: 'image',
        // Photo engraving defaults: spacing balances detail vs file size.
        lineSpacing: 0.1,
        power: 800,
        speed: 1800,
      },
    })
    // Keep the previous active layer so drawing tools stay on vector layers.
    this.document.setDefaultLayerId(activeId)
    this.scene.notifyLayersChanged()
    this.requestRender()
    return this.document.getLayer(layer.id) ?? layer
  }

  private recolorLayerEntities(layerId: LayerId, color: string): void {
    for (const e of this.document.getEntities()) {
      if (e.layerId !== layerId || e.type === 'image' || e.type === 'group') continue
      const hasFill =
        !!e.style.fill &&
        e.style.fill !== 'none' &&
        e.style.fill !== 'transparent' &&
        !/00$/i.test(e.style.fill)
      const fill =
        e.type === 'text' ? color : hasFill ? layerFillFromStroke(color) : e.style.fill
      this.document.update(e.id, {
        style: { ...e.style, stroke: color, fill },
      } as Partial<Entity>)
    }
    this.scene.rebuildIndex()
  }

  on<K extends EventName>(name: K, handler: (payload: EditorEvents[K]) => void): Disposer {
    return this.events.on(name, handler)
  }

  use(plugin: EditorPlugin): void {
    this.plugins.use(plugin)
  }

  add(entity: Entity): EntityId {
    const change = this.history.execute(new AddEntityCommand(entity))
    if (change && !Array.isArray(change)) this.scene.applyChange(change)
    this.requestRender()
    return entity.id
  }

  remove(id: EntityId): void {
    const change = this.history.execute(new RemoveEntityCommand(id))
    if (change && !Array.isArray(change)) this.scene.applyChange(change)
    this.selection.remove(id)
    this.requestRender()
  }

  group(ids: EntityId[]): EntityId {
    const groupId = createGroupId()
    const group: GroupEntity = {
      id: groupId as unknown as EntityId,
      type: 'group',
      groupId,
      layerId: this.document.getDefaultLayerId(),
      style: {},
      transform: IDENTITY_TRANSFORM,
      version: 1,
      children: [...ids],
    }
    const change = this.history.execute(new GroupCommand(ids, group))
    this.commitSceneChange(change)
    this.selection.set([group.id])
    this.events.emit('selection:change', { ids: this.selection.toArray() })
    this.refreshHandles()
    this.requestRender()
    return group.id
  }

  ungroup(groupId: EntityId): EntityId[] {
    const group = this.document.getEntity(groupId)
    const children = group?.type === 'group' ? [...group.children] : []
    const change = this.history.execute(new UngroupCommand(groupId))
    this.commitSceneChange(change)
    this.selection.set(children.filter((id) => !!this.document.getEntity(id)))
    this.events.emit('selection:change', { ids: this.selection.toArray() })
    this.refreshHandles()
    this.requestRender()
    return children
  }

  setSelectionHitMode(mode: SelectionHitMode): void {
    this.config.interaction.selectionHitMode = mode
    this.tools.setSelectionHitMode(mode)
  }

  getSelectionHitMode(): SelectionHitMode {
    return this.tools.getSelectionHitMode()
  }

  setInteraction(patch: Partial<InteractionConfig>): void {
    Object.assign(this.config.interaction, patch)
    const ix = this.config.interaction
    this.tools.context.selectionHitMode = ix.selectionHitMode
    this.tools.context.snap = {
      ...this.tools.context.snap,
      enabled: ix.snapEnabled,
      pixelTolerance: ix.pixelTolerance,
      gridSize: ix.gridSize,
      alignEnabled: ix.alignEnabled,
      showDistances: ix.showDistances,
      angleStepDeg: ix.angleStepDeg,
      panDamping: ix.panDamping,
    }
  }

  getInteraction(): InteractionConfig {
    return { ...this.config.interaction }
  }

  select(ids: EntityId[]): void {
    this.selection.set(ids)
    this.events.emit('selection:change', { ids: this.selection.toArray() })
    this.refreshHandles()
    this.requestRender()
  }

  /** Activate a sticky tool (`select` | `pan` | `line` | …). */
  setTool(name: ToolName): void {
    this.tools.activate(name)
  }

  getTool(): ToolName {
    return this.tools.getActive()
  }

  fitView(): void {
    const wa = this.config.guides.workArea
    const bounds =
      wa.mode === 'page'
        ? {
            minX: wa.originX,
            minY: wa.originY,
            maxX: wa.originX + wa.width,
            maxY: wa.originY + wa.height,
          }
        : this.document.getDocumentBounds()
    this.camera.fitBounds(bounds)
    this.notifyCameraChanged()
  }

  undo(): void {
    if (this.history.undo()) {
      this.syncSelectionAfterHistory()
      this.scene.rebuildIndex()
      this.refreshHandles()
      this.requestRender()
    }
  }

  redo(): void {
    if (this.history.redo()) {
      this.syncSelectionAfterHistory()
      this.scene.rebuildIndex()
      this.refreshHandles()
      this.requestRender()
    }
  }

  canUndo(): boolean {
    return this.history.canUndo()
  }

  canRedo(): boolean {
    return this.history.canRedo()
  }

  updateEntity(id: EntityId, patch: Partial<Entity>, coalesceKey?: string): void {
    const change = this.history.execute(new UpdateEntityCommand(id, patch, coalesceKey))
    this.commitSceneChange(change)
    this.refreshHandles()
    this.requestRender()
  }

  /**
   * Mirror the current selection about its AABB center (horizontal = flip X,
   * vertical = flip Y). Groups accumulate on transform; leaves bake geometry.
   */
  mirrorSelection(axis: 'horizontal' | 'vertical'): void {
    const ids = this.selection.toArray()
    if (!ids.length) return
    const lookup = (id: EntityId) => this.document.getEntity(id)
    const entities = ids
      .map((id) => lookup(id))
      .filter((e): e is Entity => !!e && !e.style.locked)
    if (!entities.length) return
    const box = selectionWorldBounds(entities, lookup)
    if (!box || !isValidAABB(box)) return
    const center = aabbCenter(box)
    const sx = axis === 'horizontal' ? -1 : 1
    const sy = axis === 'vertical' ? -1 : 1
    const m = scaleMatrixAbout(center, sx, sy)
    const snapshots = new Map(entities.map((e) => [e.id, e] as const))
    const patches = patchesFromMatrix(snapshots, m, lookup)
    if (!patches.size) return
    // Mirror rect corner radii order when present.
    for (const [id, patch] of patches) {
      const src = snapshots.get(id)
      if (src?.type !== 'polyline' || !src.shape || src.shape.kind !== 'rect') continue
      const radii = src.shape.cornerRadii
      if (radii == null || typeof radii === 'number') continue
      const [tl, tr, br, bl] = radii
      const next =
        axis === 'horizontal' ? ([tr, tl, bl, br] as const) : ([bl, br, tr, tl] as const)
      const shape = { ...src.shape, cornerRadii: next }
      ;(patch as Partial<Entity> & { shape?: unknown }).shape = shape
    }
    const change = this.history.execute(
      new MutateEntitiesCommand(patches, `mirror:${axis}:${Date.now()}`),
    )
    this.commitSceneChange(change)
    this.refreshHandles()
    this.requestRender()
  }

  applyStyle(id: EntityId, style: Entity['style']): void {
    const prev = this.document.getEntity(id)
    if (!prev) return
    this.updateEntity(id, { style: { ...prev.style, ...style } })
  }

  zoomTo(factor: number, screen?: ScreenPoint): void {
    const s =
      screen ??
      screenPoint(this.camera.getState().viewportWidth / 2, this.camera.getState().viewportHeight / 2)
    this.camera.zoomAt(s, factor)
    this.notifyCameraChanged()
  }

  /** Show a transient geometry preview (tools / offset dialog). */
  setPreview(preview: PreviewPrimitive): void {
    this.preview = preview
    this.refreshPreview()
  }

  /** Whether an offset dialog is driving a live preview session. */
  hasLiveOffsetPreview(): boolean {
    return this.liveOffsetOptions != null
  }

  /**
   * Clear drawn preview geometry. Does **not** end a live offset session, so
   * moving the selection can still rebuild the offset outline.
   */
  clearPreviewGeometry(): void {
    this.preview = { kind: 'none' }
    this.refreshPreview()
  }

  /** Clear preview and end any live offset / boolean preview session. */
  clearPreview(): void {
    this.liveOffsetOptions = null
    this.preview = { kind: 'none' }
    this.refreshPreview()
  }

  /** Recompute live offset preview from the current document selection. */
  refreshLiveOffsetPreview(): number {
    return this.rebuildLiveOffsetPreview()
  }

  /**
   * Offset selected entities into new closed polylines (undoable batch).
   * Returns created entity ids.
   */
  offsetSelection(options: OffsetOptions): EntityId[] {
    const ids = this.selection.toArray()
    if (!ids.length) return []
    const lookup = (id: EntityId) => this.document.getEntity(id)
    const entities = ids
      .map((id) => this.document.getEntity(id))
      .filter((e): e is Entity => !!e)
    const contours = offsetEntities(entities, options, lookup)
    if (!contours.length) return []

    const created: Entity[] = contours.map((c) => ({
      id: createEntityId('polyline'),
      type: 'polyline' as const,
      layerId: this.document.getDefaultLayerId(),
      style: { stroke: '#2563eb', strokeWidth: 1, fill: 'none' },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: c.points,
      closed: c.closed,
      ...(c.holes?.length ? { holes: c.holes } : {}),
    }))
    const change = this.history.execute(
      new BatchCommand(created.map((entity) => new AddEntityCommand(entity))),
    )
    this.commitSceneChange(change)
    const newIds = created.map((e) => e.id)
    this.selection.set(newIds)
    this.events.emit('selection:change', { ids: newIds })
    this.clearPreview()
    this.refreshHandles()
    this.requestRender()
    return newIds
  }

  /** Preview offset contours for the current selection without committing. */
  previewOffsetSelection(options: OffsetOptions): number {
    this.liveOffsetOptions = { ...options }
    return this.rebuildLiveOffsetPreview()
  }

  /**
   * Recompute offset preview from the current selection + {@link liveOffsetOptions}.
   * Called while dragging/transforming so the preview tracks the sources.
   */
  private rebuildLiveOffsetPreview(): number {
    const options = this.liveOffsetOptions
    if (!options) return 0
    const ids = this.selection.toArray()
    if (!ids.length) {
      this.preview = { kind: 'none' }
      this.refreshPreview()
      return 0
    }
    const lookup = (id: EntityId) => this.document.getEntity(id)
    const entities = ids
      .map((id) => this.document.getEntity(id))
      .filter((e): e is Entity => !!e)
    const contours = offsetEntities(entities, options, lookup)
    if (!contours.length) {
      this.preview = { kind: 'none' }
      this.refreshPreview()
      return 0
    }
    // Flatten compound contours (outer + holes) into preview path rings.
    const paths: Array<{ points: ReturnType<typeof worldPoint>[]; closed?: boolean }> = []
    for (const c of contours) {
      paths.push({
        points: c.points.map((p) => worldPoint(p.x, p.y)),
        closed: c.closed,
      })
      for (const hole of c.holes ?? []) {
        paths.push({
          points: hole.map((p) => worldPoint(p.x, p.y)),
          closed: true,
        })
      }
    }
    this.preview = { kind: 'paths', paths }
    this.refreshPreview()
    return contours.length
  }

  /** Closed shapes in the current selection that can participate in boolean ops. */
  getBooleanSelection(): Entity[] {
    const lookup = (id: EntityId) => this.document.getEntity(id)
    return this.selection
      .toArray()
      .map((id) => this.document.getEntity(id))
      .filter((e): e is Entity => !!e && entitySupportsBoolean(e, lookup))
  }

  /**
   * Boolean-combine selected closed shapes (undoable).
   * Removes sources and creates result polylines. Subtract: first − rest.
   */
  booleanSelection(op: BooleanOp, options?: BooleanOptions): EntityId[] {
    const entities = this.getBooleanSelection()
    if (entities.length < 2) return []
    const lookup = (id: EntityId) => this.document.getEntity(id)
    const contours = booleanEntities(entities, op, lookup, options)
    if (!contours.length) return []

    const style = {
      stroke: entities[0]!.style.stroke ?? '#2563eb',
      strokeWidth: entities[0]!.style.strokeWidth ?? 1,
      fill: entities[0]!.style.fill ?? 'none',
      opacity: entities[0]!.style.opacity,
    }
    const layerId = entities[0]!.layerId || this.document.getDefaultLayerId()
    const created: Entity[] = contours.map((c) => ({
      id: createEntityId('polyline'),
      type: 'polyline' as const,
      layerId,
      style: { ...style },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: c.points,
      closed: true,
      ...(c.holes?.length ? { holes: c.holes } : {}),
    }))

    const cmds = [
      ...entities.map((e) => new RemoveEntityCommand(e.id)),
      ...created.map((entity) => new AddEntityCommand(entity)),
    ]
    const change = this.history.execute(new BatchCommand(cmds))
    this.commitSceneChange(change)
    const newIds = created.map((e) => e.id)
    this.selection.set(newIds)
    this.events.emit('selection:change', { ids: newIds })
    this.clearPreview()
    this.refreshHandles()
    this.requestRender()
    return newIds
  }

  /** Preview boolean result for the current selection without committing. */
  previewBooleanSelection(op: BooleanOp, options?: BooleanOptions): number {
    const entities = this.getBooleanSelection()
    if (entities.length < 2) {
      this.clearPreview()
      return 0
    }
    const lookup = (id: EntityId) => this.document.getEntity(id)
    const contours = booleanEntities(entities, op, lookup, options)
    if (!contours.length) {
      this.clearPreview()
      return 0
    }
    const paths: Array<{ points: ReturnType<typeof worldPoint>[]; closed?: boolean }> = []
    for (const c of contours) {
      paths.push({
        points: c.points.map((p) => worldPoint(p.x, p.y)),
        closed: true,
      })
      for (const hole of c.holes ?? []) {
        paths.push({
          points: hole.map((p) => worldPoint(p.x, p.y)),
          closed: true,
        })
      }
    }
    this.setPreview({ kind: 'paths', paths })
    return contours.length
  }

  /** Platform / playground binds file picker & drag-drop here. */
  setPlaceImageHandler(handler: ((world: { x: number; y: number }) => void) | null): void {
    this.placeImageHandler = handler
  }

  /** Drop selection ids that no longer exist after undo/redo. */
  private syncSelectionAfterHistory(): void {
    const next = this.selection.toArray().filter((id) => !!this.document.getEntity(id))
    this.selection.set(next)
    this.events.emit('selection:change', { ids: next })
  }

  requestRender(): void {
    if (this.disposed || this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      const coasting = this.tools.tick()
      this.renderFrame()
      if (coasting) this.requestRender()
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.setLifecycle('disposing')
    this.disposed = true
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf)
    this.resizeObserver?.disconnect()
    this.canvas?.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas?.removeEventListener('pointermove', this.onPointerMove)
    this.canvas?.removeEventListener('pointerup', this.onPointerUp)
    this.canvas?.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas?.removeEventListener('dblclick', this.onDoubleClick)
    this.canvas?.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.removeEventListener('loadingdone', this.onFontsSettled)
    }
    clearTextOutlineCache()
    this.plugins.dispose()
    this.handleOverlay?.dispose()
    this.handleOverlay = null
    this.textOverlay?.dispose()
    this.textOverlay = null
    this.previewLayer?.remove()
    this.previewLayer = null
    this.ime?.dispose()
    this.ime = null
    this.rulers?.dispose()
    this.rulers = null
    this.scrollbars?.dispose()
    this.scrollbars = null
    this.renderer?.dispose()
    this.renderer = null
    this.setLifecycle('disposed')
  }

  private async initialize(): Promise<void> {
    this.setLifecycle('initializing')
    this.capabilities = await detectCapabilities()
    if (!this.capabilities.webgpu) {
      throw new Error('WebGPU is required. CADKit no longer ships a Canvas2D renderer.')
    }

    const canvas = resolveView(this.config.view)
    this.canvas = canvas
    this.host = ensureEditorHost(canvas)
    this.layoutChrome()

    if (this.config.guides.rulers) {
      this.rulers = new RulerOverlay(this.host, {
        size: this.config.guides.rulerSize,
        worldUnit: this.worldUnit as GeomUnit,
        displayUnit: this.displayUnit as GeomUnit,
        theme: this.config.theme === 'dark' ? DARK_RULER_THEME : LIGHT_RULER_THEME,
        visible: true,
      })
    }

    this.scrollbars = new ScrollbarOverlay(this.host, {
      theme: this.config.theme === 'dark' ? 'dark' : 'light',
      onNavigate: (minX, minY) => {
        this.camera.setTopLeft(worldPoint(minX, minY))
        this.notifyCameraChanged()
      },
    })
    this.syncScrollbars()

    this.renderer = new WebGPURenderer()
    await this.renderer.initialize(canvas)
    this.lastPresentCam = null
    this.renderer.setTextureResolver?.({
      getBitmap: (id) => this.assets.get(id as never)?.bitmap ?? null,
      getStatus: (id) => this.assets.get(id as never)?.status,
    })
    this.renderer.setMemoryBudget?.(this.config.performance.memoryBudgetMB)
    this.handleOverlay = new HandleOverlay(this.host)
    this.textOverlay = new TextOverlay(this.host)
    this.bindInput()
    this.bindResize()
    this.bindFontLoading()
    this.syncToolCursor()
    this.setLifecycle('ready')
    this.setLifecycle('running')
    this.requestRender()
  }

  private bindFontLoading(): void {
    if (typeof document === 'undefined' || !document.fonts) return
    document.fonts.addEventListener('loadingdone', this.onFontsSettled)
    void document.fonts.ready.then(() => this.onFontsSettled())
  }

  private layoutChrome(): void {
    if (!this.canvas || !this.host) return
    const gutter = this.config.guides.rulers ? this.config.guides.rulerSize : 0
    const pageMode = this.config.guides.workArea.mode === 'page'
    const canvasBg =
      this.config.theme === 'dark'
        ? pageMode
          ? '#0a0d11'
          : '#0f1419'
        : pageMode
          ? '#e8eaed'
          : '#ffffff'
    Object.assign(this.canvas.style, {
      position: 'absolute',
      left: `${gutter}px`,
      top: `${gutter}px`,
      right: 'auto',
      bottom: 'auto',
      // A canvas is a replaced element: width/height:auto keeps its 300×150
      // intrinsic size even with left/right set. Give it an explicit CSS box.
      width: `calc(100% - ${gutter}px)`,
      height: `calc(100% - ${gutter}px)`,
      display: 'block',
      background: canvasBg,
    } as Partial<CSSStyleDeclaration>)
    // Preview/handles/text share canvas space (not full host including ruler gutters).
    if (this.previewLayer) {
      this.alignOverlayToCanvas(this.previewLayer)
    }
    this.alignTextOverlayToCanvas()
    this.scrollbars?.setCanvasBox(this.getCanvasBoxInHost())
    this.syncScrollbars()
  }

  /** Canvas position relative to the overlay host, including borders/fractional layout. */
  private getCanvasBoxInHost(): {
    left: number
    top: number
    right: number
    bottom: number
  } {
    if (!this.canvas || !this.host) return { left: 0, top: 0, right: 0, bottom: 0 }
    const host = this.host.getBoundingClientRect()
    const canvas = this.canvas.getBoundingClientRect()
    return {
      left: canvas.left - host.left,
      top: canvas.top - host.top,
      right: host.right - canvas.right,
      bottom: host.bottom - canvas.bottom,
    }
  }

  private alignOverlayToCanvas(el: HTMLElement): void {
    const box = this.getCanvasBoxInHost()
    el.style.inset = `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`
  }

  private alignTextOverlayToCanvas(): void {
    const box = this.getCanvasBoxInHost()
    this.textOverlay?.setCanvasBounds(box.left, box.top, box.right, box.bottom)
  }

  private bindInput(): void {
    if (!this.canvas) return
    this.canvas.style.touchAction = 'none'
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)
    this.canvas.addEventListener('dblclick', this.onDoubleClick)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  private commitSceneChange(change: DocumentChange | DocumentChange[] | null): void {
    if (!change) return
    if (Array.isArray(change)) {
      for (const c of change) this.scene.applyChange(c)
    } else {
      this.scene.applyChange(change)
    }
    this.refreshHandles()
    this.requestRender()
  }

  private refreshHandles(): void {
    if (!this.handleOverlay || !this.canvas || !this.host) return
    const box = this.getCanvasBoxInHost()
    const offset = { left: box.left, top: box.top }
    const draft = this.textOverlay?.getDraft() ?? null
    const draftBox = draft ? this.boundsForTextDraft(draft) : null
    let handles = this.tools.getSelectionHandles()
    let frameBox = this.tools.getSelectionFrame()?.box ?? null
    let frameRotation = this.tools.getSelectionFrame()?.rotation ?? 0
    if (draft && draftBox) {
      // draftBox is already a world AABB with rotation baked into corners
      // (entityWorldBounds). Do NOT apply draft.rotation again — that double-
      // rotates the selection frame away from the glyph outlines.
      frameBox = draftBox
      frameRotation = 0
      handles = buildTransformHandles(draftBox, this.camera, 0)
    }
    this.handleOverlay.update(handles, this.camera, offset, frameBox, frameRotation)
    this.handleOverlay.updateHover(this.tools.getHoverFrame(), this.camera, offset)
    this.handleOverlay.updateMarquee(this.tools.getMarqueeAABB(), this.camera, offset)
    this.handleOverlay.updateAlignGuides(this.alignGuides, this.camera, offset)
    // Mirror selection AABB onto rulers (X/Y span highlights).
    this.rulers?.setSelectionBounds(frameBox)
    this.rulers?.update(this.camera)
  }

  /** World AABB for the in-progress text draft (selection frame while editing). */
  private boundsForTextDraft(draft: TextDraftState): AABB | null {
    const live = draft.entityId ? this.document.getEntity(draft.entityId) : undefined
    const fake: TextEntity = {
      id: (draft.entityId ?? ('__text_draft__' as EntityId)) as EntityId,
      type: 'text',
      layerId: live && live.type === 'text' ? live.layerId : this.document.getDefaultLayerId(),
      parentId: live?.parentId,
      style: live?.style ?? { fill: draft.color },
      transform: live?.transform ?? IDENTITY_TRANSFORM,
      version: 1,
      content: draft.content,
      position: { x: draft.world.x, y: draft.world.y },
      fontFamily: draft.fontFamily,
      fontSize: draft.fontSize,
      align: draft.align,
      widthFactor: draft.widthFactor,
      rotation: draft.rotation,
      path: draft.path,
    }
    const lookup = (id: EntityId) => {
      if (draft.entityId && id === draft.entityId) return fake
      return this.document.getEntity(id)
    }
    const box = entityWorldBounds(fake, resolveWorldMatrix(fake, lookup))
    return isValidAABB(box) ? box : null
  }

  private bindResize(): void {
    if (!this.host) return
    let didInitialPageFit = false
    const apply = () => {
      this.resizeRaf = 0
      if (!this.canvas || !this.host || this.disposed) return
      this.layoutChrome()
      const hostRect = this.host.getBoundingClientRect()
      // Camera / picking must match the canvas CSS box (pointer uses the same rect).
      const canvasRect = this.canvas.getBoundingClientRect()
      const width = Math.max(1, canvasRect.width)
      const height = Math.max(1, canvasRect.height)
      const dpr = this.config.dpr ?? window.devicePixelRatio ?? 1
      this.camera.setViewport(width, height)
      this.renderer?.resize(width, height, dpr)
      this.rulers?.resize(hostRect.width, hostRect.height, dpr)
      // Page mode needs a real viewport before fit — otherwise 100×100 stays ~100 CSS px.
      if (
        !didInitialPageFit &&
        this.config.guides.workArea.mode === 'page' &&
        width > 32 &&
        height > 32
      ) {
        this.fitView()
        didInitialPageFit = true
      }
      this.refreshHandles()
      this.refreshPreview()
      this.refreshTextOverlay()
      // Paint in this same frame. Setting canvas.width clears the buffer; delaying
      // via requestRender leaves a visible blank flash while the window resizes.
      if (this.raf) {
        cancelAnimationFrame(this.raf)
        this.raf = 0
      }
      this.tools.tick()
      this.renderFrame()
    }
    const schedule = () => {
      if (this.disposed || this.resizeRaf) return
      this.resizeRaf = requestAnimationFrame(apply)
    }
    apply()
    this.resizeObserver = new ResizeObserver(schedule)
    this.resizeObserver.observe(this.host)
  }

  private readonly onPointerDown = (ev: PointerEvent) => {
    this.tools.setModifierKeys({ shiftKey: ev.shiftKey })
    const screen = this.toScreen(ev)
    const world = this.camera.screenToWorld(screen)
    this.tools.pointerDown(screen, world, ev.button)
    // Keep capture for drag tools; release when IME text editing starts.
    if (this.ime?.isActive()) {
      try {
        this.canvas?.releasePointerCapture?.(ev.pointerId)
      } catch {
        /* ignore */
      }
    } else {
      this.canvas?.setPointerCapture?.(ev.pointerId)
    }
    this.events.emit('pointer:down', { screen, world, button: ev.button })
    this.syncToolCursor()
    this.refreshHandles()
    this.requestRender()
  }

  private readonly onPointerMove = (ev: PointerEvent) => {
    this.tools.setModifierKeys({ shiftKey: ev.shiftKey })
    const screen = this.toScreen(ev)
    const world = this.camera.screenToWorld(screen)
    this.tools.pointerMove(screen, world)
    this.events.emit('pointer:move', { screen, world })
    this.syncToolCursor()
    this.refreshHandles()
    this.requestRender()
  }

  private readonly onPointerLeave = () => {
    this.tools.clearHover()
    this.syncToolCursor()
    this.refreshHandles()
  }

  private readonly onPointerUp = (ev: PointerEvent) => {
    try {
      this.canvas?.releasePointerCapture?.(ev.pointerId)
    } catch {
      /* ignore */
    }
    this.tools.setModifierKeys({ shiftKey: ev.shiftKey })
    const screen = this.toScreen(ev)
    const world = this.camera.screenToWorld(screen)
    this.tools.pointerUp(screen, world, ev.button)
    this.events.emit('pointer:up', { screen, world, button: ev.button })
    this.events.emit('selection:change', { ids: this.selection.toArray() })
    this.syncToolCursor()
    this.refreshHandles()
    this.requestRender()
  }

  private readonly onDoubleClick = (ev: MouseEvent) => {
    ev.preventDefault()
    const screen = this.toScreen(ev)
    const world = this.camera.screenToWorld(screen)
    this.tools.doubleClick(screen, world)
    this.refreshHandles()
    this.requestRender()
  }

  private readonly onWheel = (ev: WheelEvent) => {
    ev.preventDefault()
    // Ctrl / ⌘ + wheel (and trackpad pinch, which browsers report as ctrl+wheel) → zoom.
    if (ev.ctrlKey || ev.metaKey) {
      const screen = this.toScreen(ev)
      const intensity = Math.min(Math.abs(ev.deltaY) / 100, 3)
      const step = Math.pow(1.1, intensity)
      const factor = ev.deltaY > 0 ? 1 / step : step
      this.camera.zoomAt(screen, factor)
      this.notifyCameraChanged()
      return
    }

    // Default: scroll / pan the canvas. Shift + vertical wheel → horizontal pan.
    let dx = ev.deltaX
    let dy = ev.deltaY
    if (ev.shiftKey && Math.abs(dy) >= Math.abs(dx)) {
      dx = dy
      dy = 0
    }
    if (ev.deltaMode === 1 /* DOM_DELTA_LINE */) {
      dx *= 16
      dy *= 16
    } else if (ev.deltaMode === 2 /* DOM_DELTA_PAGE */) {
      const s = this.camera.getState()
      dx *= s.viewportWidth
      dy *= s.viewportHeight
    }
    if (dx === 0 && dy === 0) return
    // Natural scroll: wheel down reveals content below.
    this.camera.pan(-dx, -dy)
    this.notifyCameraChanged()
  }

  /** Sync overlay scrollbars to document bounds + camera viewport. */
  private syncScrollbars(): void {
    if (!this.scrollbars) return
    const bounds = this.document.getDocumentBounds()
    this.scrollbars.setContentBounds(isValidAABB(bounds) ? bounds : null)
    this.scrollbars.setCanvasBox(this.getCanvasBoxInHost())
    this.scrollbars.update(this.camera)
  }

  /** Emit camera event and refresh overlays that bake world→screen (handles / preview / text). */
  private notifyCameraChanged(): void {
    const s = this.camera.getState()
    this.events.emit('camera:change', {
      zoom: s.zoom,
      center: { x: s.x, y: s.y, __space: 'world' },
    })
    this.refreshHandles()
    // Live offset paths are in world space — just reproject to screen.
    this.refreshPreview()
    this.refreshTextOverlay()
    this.syncScrollbars()
    this.requestRender()
  }

  private readonly onKeyDown = (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null
    // IME / form fields must receive keys (including Space) without tool shortcuts.
    if (
      this.ime?.isActive() ||
      (target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.classList?.contains('cadkit-ime')))
    ) {
      return
    }
    if (ev.key === ' ' || ev.code === 'Space') {
      if (!ev.repeat) {
        ev.preventDefault()
        this.tools.setModifierKeys({ spaceKey: true })
        this.syncToolCursor()
      }
      return
    }
    if (ev.key === 'Shift') {
      this.tools.setModifierKeys({ shiftKey: true })
      return
    }
    // Tool shortcuts (Figma-like): V select, H pan, L line
    if (!ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      const k = ev.key.toLowerCase()
      if (k === 'v') {
        ev.preventDefault()
        this.setTool('select')
        return
      }
      if (k === 'h') {
        ev.preventDefault()
        this.setTool('pan')
        return
      }
      const toolMap: Record<string, ToolName> = {
        v: 'select',
        h: 'pan',
        l: 'line',
        r: 'rectangle',
        o: 'ellipse',
        c: 'circle',
        p: 'polyline',
        b: 'pen',
        w: 'brush',
        t: 'text',
        i: 'image',
      }
      const tool = toolMap[k]
      if (tool) {
        try {
          this.setTool(tool)
          ev.preventDefault()
          return
        } catch {
          /* tool not registered */
        }
      }
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault()
      if (ev.shiftKey) this.redo()
      else this.undo()
      return
    }
    this.tools.setModifierKeys({ shiftKey: ev.shiftKey })
    this.tools.keyDown(ev.key)
    if (ev.key === 'Delete' || ev.key === 'Backspace') ev.preventDefault()
    this.refreshHandles()
    this.requestRender()
  }

  private readonly onKeyUp = (ev: KeyboardEvent) => {
    if (this.ime?.isActive()) return
    const target = ev.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }
    if (ev.key === ' ' || ev.code === 'Space') {
      this.tools.setModifierKeys({ spaceKey: false })
      this.syncToolCursor()
      return
    }
    if (ev.key === 'Shift') {
      this.tools.setModifierKeys({ shiftKey: false })
    }
  }

  private refreshTextOverlay(): void {
    if (!this.textOverlay) return
    this.alignTextOverlayToCanvas()
    this.textOverlay.update(
      this.document.getEntities(),
      this.camera,
      (layerId) => this.document.getLayer(layerId),
    )
  }

  private syncToolCursor(): void {
    if (!this.canvas) return
    if (this.ime?.isActive()) {
      this.canvas.style.cursor = 'text'
      return
    }
    const effective = this.tools.getEffectiveTool()
    if (effective === 'pan') {
      this.canvas.style.cursor = this.tools.isPanning() ? 'grabbing' : 'grab'
      return
    }
    const cross: ToolName[] = [
      'line',
      'rectangle',
      'ellipse',
      'circle',
      'polyline',
      'pen',
      'brush',
      'text',
      'image',
    ]
    if (cross.includes(effective)) {
      this.canvas.style.cursor = 'crosshair'
      return
    }
    // Select tool: pointer when hovering a pickable element.
    this.canvas.style.cursor = this.tools.getHoverId() ? 'pointer' : 'default'
  }

  private refreshPreview(): void {
    if (!this.host) return
    if (!this.previewLayer) {
      this.previewLayer = document.createElement('div')
      this.previewLayer.className = 'cadkit-preview'
      Object.assign(this.previewLayer.style, {
        position: 'absolute',
        pointerEvents: 'none',
        zIndex: '2',
        overflow: 'hidden',
      } as Partial<CSSStyleDeclaration>)
      this.host.appendChild(this.previewLayer)
    }
    this.alignOverlayToCanvas(this.previewLayer)
    const layer = this.previewLayer
    layer.innerHTML = ''
    const p = this.preview
    if (p.kind === 'none') return
    // worldToScreen is canvas-local; previewLayer is aligned to the canvas (not host/rulers).
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
    const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    stroke.setAttribute('fill', 'none')
    stroke.setAttribute('stroke', '#60a5fa')
    stroke.setAttribute('stroke-width', '1')
    stroke.setAttribute('stroke-dasharray', '4 3')
    const toS = (x: number, y: number) => {
      const s = this.camera.worldToScreen({ x, y, __space: 'world' })
      return `${s.x},${s.y}`
    }
    if (p.kind === 'line') {
      stroke.setAttribute('d', `M ${toS(p.a.x, p.a.y)} L ${toS(p.b.x, p.b.y)}`)
    } else if (p.kind === 'rect') {
      const a = toS(p.minX, p.minY)
      const b = toS(p.maxX, p.minY)
      const c = toS(p.maxX, p.maxY)
      const d = toS(p.minX, p.maxY)
      stroke.setAttribute('d', `M ${a} L ${b} L ${c} L ${d} Z`)
    } else if (p.kind === 'ellipse') {
      const c = this.camera.worldToScreen({ x: p.cx, y: p.cy, __space: 'world' })
      const rx = p.rx * this.camera.getState().zoom
      const ry = p.ry * this.camera.getState().zoom
      const ell = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
      ell.setAttribute('cx', String(c.x))
      ell.setAttribute('cy', String(c.y))
      ell.setAttribute('rx', String(Math.max(0.5, rx)))
      ell.setAttribute('ry', String(Math.max(0.5, ry)))
      ell.setAttribute('fill', 'none')
      ell.setAttribute('stroke', '#60a5fa')
      ell.setAttribute('stroke-width', '1')
      ell.setAttribute('stroke-dasharray', '4 3')
      svg.appendChild(ell)
      layer.appendChild(svg)
      return
    } else if (p.kind === 'polyline' && p.points.length) {
      if (p.points.length === 1) {
        const a = p.points[0]!
        const s = this.camera.worldToScreen({ x: a.x, y: a.y, __space: 'world' })
        const mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        mark.setAttribute('cx', String(s.x))
        mark.setAttribute('cy', String(s.y))
        mark.setAttribute('r', '3.5')
        mark.setAttribute('fill', '#60a5fa')
        mark.setAttribute('stroke', '#2563eb')
        mark.setAttribute('stroke-width', '1')
        svg.appendChild(mark)
        layer.appendChild(svg)
        return
      }
      const d = p.points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toS(pt.x, pt.y)}`).join(' ')
      stroke.setAttribute('d', d + (p.closed ? ' Z' : ''))
      // Keep last vertex visible while drawing freehand.
      const last = p.points[p.points.length - 1]!
      const tip = this.camera.worldToScreen({ x: last.x, y: last.y, __space: 'world' })
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      mark.setAttribute('cx', String(tip.x))
      mark.setAttribute('cy', String(tip.y))
      mark.setAttribute('r', '2.5')
      mark.setAttribute('fill', '#60a5fa')
      svg.appendChild(mark)
    } else if (p.kind === 'paths') {
      // Match WebGPU hairlines: 1 framebuffer pixel ≈ 1/dpr CSS px.
      const dpr = Math.max(1, this.config.dpr ?? window.devicePixelRatio ?? 1)
      const pathStroke = 1 / dpr
      for (const path of p.paths) {
        if (!path.points.length) continue
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        el.setAttribute('fill', 'none')
        el.setAttribute('stroke', '#2563eb')
        el.setAttribute('stroke-width', String(pathStroke))
        el.setAttribute('stroke-linejoin', 'round')
        el.setAttribute('stroke-linecap', 'round')
        el.setAttribute('vector-effect', 'non-scaling-stroke')
        const d =
          path.points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toS(pt.x, pt.y)}`).join(' ') +
          (path.closed !== false ? ' Z' : '')
        el.setAttribute('d', d)
        svg.appendChild(el)
      }
      layer.appendChild(svg)
      return
    } else if (p.kind === 'pen') {
      this.paintPenPreview(svg, p, toS)
      layer.appendChild(svg)
      return
    }
    svg.appendChild(stroke)
    layer.appendChild(svg)
  }

  private paintPenPreview(
    svg: SVGSVGElement,
    p: Extract<PreviewPrimitive, { kind: 'pen' }>,
    toS: (x: number, y: number) => string,
  ): void {
    const anchors = p.placing ? [...p.anchors, p.placing] : [...p.anchors]
    if (p.cursor && anchors.length) {
      anchors.push({
        point: p.cursor,
        handleIn: null,
        handleOut: null,
      })
    }
    const cubic = anchorsToCubicPoints(anchors, false)
    if (cubic.length >= 4) {
      let d = `M ${toS(cubic[0]!.x, cubic[0]!.y)}`
      for (let i = 1; i + 2 < cubic.length; i += 3) {
        d += ` C ${toS(cubic[i]!.x, cubic[i]!.y)} ${toS(cubic[i + 1]!.x, cubic[i + 1]!.y)} ${toS(cubic[i + 2]!.x, cubic[i + 2]!.y)}`
      }
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', d)
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', '#60a5fa')
      path.setAttribute('stroke-width', '1.25')
      path.setAttribute('stroke-dasharray', p.cursor || p.placing ? '4 3' : 'none')
      svg.appendChild(path)
    } else if (anchors.length === 1) {
      // Single anchor — no segment yet.
    }

    const drawHandle = (anchor: { x: number; y: number }, tip: { x: number; y: number }) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      const a = this.camera.worldToScreen({ x: anchor.x, y: anchor.y, __space: 'world' })
      const b = this.camera.worldToScreen({ x: tip.x, y: tip.y, __space: 'world' })
      line.setAttribute('x1', String(a.x))
      line.setAttribute('y1', String(a.y))
      line.setAttribute('x2', String(b.x))
      line.setAttribute('y2', String(b.y))
      line.setAttribute('stroke', '#93c5fd')
      line.setAttribute('stroke-width', '1')
      svg.appendChild(line)
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      dot.setAttribute('cx', String(b.x))
      dot.setAttribute('cy', String(b.y))
      dot.setAttribute('r', '2.5')
      dot.setAttribute('fill', '#fff')
      dot.setAttribute('stroke', '#2563eb')
      dot.setAttribute('stroke-width', '1')
      svg.appendChild(dot)
    }

    const show = p.placing ? [...p.anchors, p.placing] : p.anchors
    for (const a of show) {
      if (a.handleIn) drawHandle(a.point, a.handleIn)
      if (a.handleOut) drawHandle(a.point, a.handleOut)
      const s = this.camera.worldToScreen({ x: a.point.x, y: a.point.y, __space: 'world' })
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      mark.setAttribute('cx', String(s.x))
      mark.setAttribute('cy', String(s.y))
      mark.setAttribute('r', p.closedHint && a === p.anchors[0] ? '5' : '3.5')
      mark.setAttribute('fill', '#60a5fa')
      mark.setAttribute('stroke', '#2563eb')
      mark.setAttribute('stroke-width', '1')
      svg.appendChild(mark)
    }
  }

  private toScreen(ev: Pick<MouseEvent, 'clientX' | 'clientY'>): ScreenPoint {
    const rect = this.canvas!.getBoundingClientRect()
    return screenPoint(ev.clientX - rect.left, ev.clientY - rect.top)
  }

  private gridCacheKey = ''
  private cachedGrid:
    | {
        vertices: Float32Array
        vertexCount: number
        fillVertices?: Float32Array
        fillVertexCount?: number
        camX: number
        camY: number
        zoom: number
      }
    | null = null
  /** Camera snapshot after last GPU present (for dirty / pan-blit). */
  private lastPresentCam: {
    x: number
    y: number
    zoom: number
    vw: number
    vh: number
  } | null = null

  private renderFrame(): void {
    if (!this.renderer) return
    this.emitPhase('beforeUpdate')
    this.emitPhase('update')
    this.emitPhase('bounds')
    this.emitPhase('index')
    this.emitPhase('cull')
    const built = this.scene.build(this.camera, this.selection.asReadonly())
    const { items, stats, skipGeometryUpload, mode, revision, lodBin } = built
    const dirtyMeta = this.scene.consumeDirtyMeta()
    const state = this.camera.getState()
    const workArea = this.config.guides.workArea
    const pageMode = workArea.mode === 'page'
    const gridStyle = {
      ...(this.config.theme === 'dark' ? DARK_GRID_STYLE : DEFAULT_GRID_STYLE),
      visible: this.gridVisible,
    }
    const pageFill: [number, number, number, number] =
      this.config.theme === 'dark' ? [0.12, 0.14, 0.18, 1] : [1, 1, 1, 1]
    // Cache key excludes camera x/y — screen-space grid rebuilds when the view moves.
    const key = [
      Math.round(state.viewportWidth),
      Math.round(state.viewportHeight),
      lodBin,
      this.worldUnit,
      this.displayUnit,
      this.config.theme,
      workArea.mode,
      workArea.width,
      workArea.height,
      workArea.originX,
      workArea.originY,
      this.gridVisible ? 1 : 0,
    ].join('|')

    let skipGridUpload = false
    let grid = this.cachedGrid
    if (this.gridVisible || pageMode) {
      // Rebuild grid only after ~1 CSS-pixel of camera drift (not every pan tick).
      const camMoved =
        !grid ||
        grid.zoom !== state.zoom ||
        Math.hypot((grid.camX - state.x) * state.zoom, (grid.camY - state.y) * state.zoom) > 1
      if (grid && this.gridCacheKey === key && !camMoved) {
        skipGridUpload = true
      } else {
        const builtGrid = buildGridGeometry(
          this.camera,
          state.viewportWidth,
          state.viewportHeight,
          this.worldUnit as GeomUnit,
          this.displayUnit as GeomUnit,
          gridStyle,
          workArea,
          pageFill,
        )
        // Copy out of subarray views so later mutations / uploads own the bytes.
        grid = {
          vertices: new Float32Array(builtGrid.vertices),
          vertexCount: builtGrid.vertexCount,
          fillVertices: builtGrid.fillVertices
            ? new Float32Array(builtGrid.fillVertices)
            : undefined,
          fillVertexCount: builtGrid.fillVertexCount,
          camX: state.x,
          camY: state.y,
          zoom: state.zoom,
        }
        this.cachedGrid = grid
        this.gridCacheKey = key
        skipGridUpload = false
      }
    } else {
      grid = null
      this.cachedGrid = null
      this.gridCacheKey = ''
    }

    this.rulers?.update(this.camera)
    this.syncScrollbars()
    this.refreshTextOverlay()

    this.emitPhase('prepare')
    this.emitPhase('render')
    const outsideClear =
      this.config.theme === 'dark'
        ? pageMode
          ? '#0a0d11'
          : '#0f1419'
        : pageMode
          ? '#e8eaed'
          : '#ffffff'

    const prevCam = this.lastPresentCam
    const zoomOrResize =
      !prevCam ||
      prevCam.zoom !== state.zoom ||
      prevCam.vw !== state.viewportWidth ||
      prevCam.vh !== state.viewportHeight
    const camPanOnly =
      !!prevCam &&
      !zoomOrResize &&
      (prevCam.x !== state.x || prevCam.y !== state.y)
    const camStatic = !!prevCam && !zoomOrResize && !camPanOnly

    let dirtyFullscreen = dirtyMeta.fullscreen || zoomOrResize || !prevCam
    let dirtyScreenRects: ScreenRect[] | undefined
    let panPixelDelta: { dx: number; dy: number } | undefined

    if (!dirtyFullscreen && camStatic && dirtyMeta.rects.length > 0) {
      const view = this.camera.getVisibleWorldBounds()
      const viewArea = Math.max(
        1,
        (view.maxX - view.minX) * (view.maxY - view.minY),
      )
      const tracker = new DirtyRegionTracker(
        this.config.performance.maxDirtyRects,
        this.config.performance.dirtyMergeAreaRatio,
        viewArea,
      )
      for (const r of dirtyMeta.rects) tracker.mark(r)
      const merged = tracker.consume()
      if (merged.fullscreen) {
        dirtyFullscreen = true
      } else {
        const padPx = 4
        dirtyScreenRects = []
        for (const { bounds } of merged.rects) {
          const a = this.camera.worldToScreen({
            x: bounds.minX,
            y: bounds.minY,
            __space: 'world',
          })
          const b = this.camera.worldToScreen({
            x: bounds.maxX,
            y: bounds.maxY,
            __space: 'world',
          })
          const minX = Math.min(a.x, b.x) - padPx
          const minY = Math.min(a.y, b.y) - padPx
          const maxX = Math.max(a.x, b.x) + padPx
          const maxY = Math.max(a.y, b.y) + padPx
          const w = maxX - minX
          const h = maxY - minY
          if (w > 0 && h > 0) dirtyScreenRects.push({ x: minX, y: minY, w, h })
        }
        if (dirtyScreenRects.length === 0) dirtyFullscreen = true
      }
    } else if (
      !dirtyFullscreen &&
      camPanOnly &&
      mode === 'pan-reuse' &&
      skipGeometryUpload
    ) {
      panPixelDelta = {
        dx: (prevCam!.x - state.x) * state.zoom,
        dy: (prevCam!.y - state.y) * state.zoom,
      }
    } else if (!dirtyFullscreen && camStatic && dirtyMeta.rects.length === 0) {
      // No scene/pixel invalidation — present previous target (handles/rulers are DOM).
      if (skipGeometryUpload && skipGridUpload) {
        dirtyScreenRects = []
      } else {
        dirtyFullscreen = true
      }
    } else if (!dirtyFullscreen && camPanOnly && mode !== 'pan-reuse') {
      dirtyFullscreen = true
    }

    this.lastMetrics = this.renderer.render({
      camera: this.camera,
      items,
      selected: this.selection.asReadonly(),
      stats,
      clearColor: outsideClear,
      skipGeometryUpload,
      skipGridUpload,
      sceneRevision: revision,
      lodBin,
      mode,
      dirtyFullscreen,
      dirtyScreenRects,
      panPixelDelta,
      textures: {
        getBitmap: (id) => this.assets.get(id as never)?.bitmap ?? null,
        getStatus: (id) => this.assets.get(id as never)?.status,
      },
      grid:
        grid && (grid.vertexCount > 0 || (grid.fillVertexCount ?? 0) > 0)
          ? {
              vertices: grid.vertices,
              vertexCount: grid.vertexCount,
              fillVertices: grid.fillVertices,
              fillVertexCount: grid.fillVertexCount,
            }
          : undefined,
    })
    this.lastPresentCam = {
      x: state.x,
      y: state.y,
      zoom: state.zoom,
      vw: state.viewportWidth,
      vh: state.viewportHeight,
    }
    this.emitPhase('afterRender')
    this.events.emit('metrics', {
      frameMs: this.lastMetrics.frameMs,
      drawCalls: this.lastMetrics.drawCalls,
      visibleCount: this.lastMetrics.visibleCount,
      uploadBytes: this.lastMetrics.uploadBytes,
      memoryMB: this.lastMetrics.memoryMB,
    })
  }

  private emitPhase(phase: FramePhase): void {
    this.events.emit('frame:phase', { phase, dt: 0 })
  }

  private setLifecycle(next: EditorLifecycle): void {
    const from = this.lifecycle
    this.lifecycle = next
    this.events.emit('lifecycle:change', { from, to: next })
  }

  private async importSvg(source: string, opts?: { signal?: AbortSignal }): Promise<void> {
    this.events.emit('document:session', { state: 'loading' })
    const result = await parseSvg(source, { signal: opts?.signal })
    // Unitless SVG user units → inches via svgDpi (default 72), then into world units.
    const uuScale = svgUserUnitsToWorld(1, this.worldUnit as GeomUnit, this.svgDpi)
    const entities = result.entities.map((e) => scaleImportedEntity(e, uuScale))
    const change = this.document.addMany(entities)
    this.scene.applyChange(change)
    this.events.emit('import:progress', {
      loaded: entities.length,
      warnings: result.warnings.length,
    })
    this.events.emit('document:session', { state: 'active' })
    this.fitView()
  }

  private async importImage(source: File | Blob | string): Promise<EntityId | null> {
    try {
      const asset =
        typeof source === 'string'
          ? await this.assets.importUrl(source)
          : await this.assets.importFile(source)
      const cam = this.camera.getState()
      // Raster pixels → physical size at rasterDpi (default 96), then into world units.
      const worldW = rasterPixelsToWorld(asset.width, this.worldUnit as GeomUnit, this.rasterDpi)
      const worldH = rasterPixelsToWorld(asset.height, this.worldUnit as GeomUnit, this.rasterDpi)
      const imageLayer = this.ensureImageLayer()
      const entity: ImageEntity = {
        id: createEntityId('image'),
        type: 'image',
        layerId: imageLayer.id,
        style: {},
        transform: IDENTITY_TRANSFORM,
        version: 1,
        assetId: asset.id,
        href: asset.href,
        naturalWidth: asset.width,
        naturalHeight: asset.height,
        width: worldW,
        height: worldH,
        origin: { x: cam.x - worldW / 2, y: cam.y - worldH / 2 },
        preserveAspectRatio: true,
        filters: [],
      }
      this.add(entity)
      this.select([entity.id])
      return entity.id
    } catch (err) {
      console.error(err)
      return null
    }
  }

  /** Mutate image filter stack (undoable). */
  setImageFilters(id: EntityId, filters: FilterOp[]): void {
    this.updateEntity(id, { filters } as Partial<Entity>)
  }

  addImageFilter(id: EntityId, filter: Omit<FilterOp, 'id'> & { id?: string }): void {
    const e = this.document.getEntity(id)
    if (!e || e.type !== 'image') return
    const next = [...(e.filters ?? []), { ...filter, id: filter.id ?? createFilterId() }]
    this.setImageFilters(id, next as FilterOp[])
  }

  private async importDxf(source: string | File, opts?: { signal?: AbortSignal }): Promise<void> {
    this.events.emit('document:session', { state: 'loading' })
    const text = typeof source === 'string' ? source : await source.text()
    let loaded = 0
    let warnings = 0
    for await (const chunk of importDxf(text, {
      signal: opts?.signal,
      chunkSize: 5000,
      targetUnit: this.worldUnit,
    })) {
      if (chunk.documentUnit) {
        // Keep storage unit; expose detected unit via progress consumer if needed
      }
      const change = this.document.addMany(chunk.entities)
      this.scene.applyChange(change)
      loaded += chunk.entities.length
      warnings += chunk.warnings.length
      if (loaded > 100_000) {
        for (const part of ChunkStore.partition(chunk.entities, 10_000)) this.chunks.put(part)
      }
      this.events.emit('import:progress', { loaded, warnings })
      this.requestRender()
    }
    this.events.emit('document:session', { state: 'active' })
    this.fitView()
  }

  private async importGcode(source: string | File, opts?: { signal?: AbortSignal }): Promise<void> {
    this.events.emit('document:session', { state: 'loading' })
    const text = typeof source === 'string' ? source : await source.text()
    const result = importGcode(text, {
      signal: opts?.signal,
      layerId: this.document.getDefaultLayerId(),
      flipY: true,
      optimize: true,
    })
    const change = this.document.addMany(result.entities)
    this.scene.applyChange(change)
    this.events.emit('import:progress', {
      loaded: result.entities.length,
      warnings: result.warnings.length,
    })
    this.events.emit('document:session', { state: 'active' })
    this.fitView()
  }
}

/** Draw bitmap into a cols×rows canvas and return RGBA (for grayscale PWM G-code). */
async function sampleBitmapRgba(
  bitmap: ImageBitmap,
  cols: number,
  rows: number,
): Promise<Uint8ClampedArray> {
  const w = Math.max(1, cols)
  const h = Math.max(1, rows)
  // High-quality downsample when shrinking; nearest when enlarging (avoid soft mush).
  const shrink = w < bitmap.width || h < bitmap.height
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('OffscreenCanvas 2d unavailable')
    ctx.imageSmoothingEnabled = shrink
    if (shrink) ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    return ctx.getImageData(0, 0, w, h).data
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d unavailable')
  ctx.imageSmoothingEnabled = shrink
  if (shrink) ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h).data
}

/**
 * Rec.709 luma + alpha. Soft percentile stretch (2%–98%) on opaque pixels only.
 * Transparency is preserved so G-code can travel only through clear pixels.
 */
function rgbaToLumaAlpha(
  rgba: Uint8ClampedArray,
  cols: number,
  rows: number,
): { luma: Uint8Array; alpha: Uint8Array } {
  const n = cols * rows
  const luma = new Uint8Array(n)
  const alpha = new Uint8Array(n)
  const hist = new Uint32Array(256)
  let opaqueCount = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const a = rgba[o + 3]!
    alpha[i] = a
    const y = Math.round(0.2126 * rgba[o]! + 0.7152 * rgba[o + 1]! + 0.0722 * rgba[o + 2]!)
    luma[i] = y
    if (a >= 8) {
      hist[y]!++
      opaqueCount++
    }
  }
  if (opaqueCount < 16) return { luma, alpha }
  const loTarget = Math.max(1, Math.floor(opaqueCount * 0.02))
  const hiTarget = Math.max(loTarget + 1, Math.ceil(opaqueCount * 0.98))
  let acc = 0
  let lo = 0
  let hi = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!
    if (acc >= loTarget) {
      lo = v
      break
    }
  }
  acc = 0
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]!
    if (acc >= opaqueCount - hiTarget) {
      hi = v
      break
    }
  }
  if (hi - lo >= 24) {
    const scale = 255 / (hi - lo)
    for (let i = 0; i < n; i++) {
      if (alpha[i]! < 8) continue
      const y = Math.min(hi, Math.max(lo, luma[i]!))
      luma[i] = Math.round((y - lo) * scale)
    }
  }
  return { luma, alpha }
}

/**
 * Uniformly scale an imported entity from source units into world units.
 * Geometry / fontSize / arc radius come from applyAffineToEntity; strokeWidth
 * is style metadata and must be scaled separately.
 */
function scaleImportedEntity(entity: Entity, factor: number): Entity {
  if (!(factor > 0) || Math.abs(factor - 1) < 1e-12) return entity
  let next = applyAffineToEntity(entity, scaleMatrix(factor, factor))
  if (next.style.strokeWidth != null) {
    next = {
      ...next,
      style: { ...next.style, strokeWidth: next.style.strokeWidth * factor },
    }
  }
  return next
}

export async function createEditor(options?: CreateEditorOptions): Promise<Editor> {
  return Editor.create(options)
}

export type { ToolName }

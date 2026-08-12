import type { Editor, ToolName } from '@cadkit/editor'
import type { Entity, EntityId, ImageEntity, TextEntity } from '@cadkit/types'
import { screenPoint } from '@cadkit/types'
import type { AppStore, HotProps } from './app/store.js'
import { DEFAULT_HOT } from './app/store.js'
import { t } from './i18n/index.js'
import { pickImageFile } from './pick-file.js'

function selectionHotBounds(editor: Editor, ids: EntityId[]): Pick<HotProps, 'x' | 'y' | 'width' | 'height'> {
  const box = editor.tools.getSelectionFrameAABB()
  if (box) {
    return {
      x: box.minX,
      y: box.minY,
      width: box.maxX - box.minX,
      height: box.maxY - box.minY,
    }
  }
  // Fallback if the tool frame is unavailable during a store sync.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of ids) {
    const b = editor.document.getBounds(id)
    if (!b) continue
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function readHot(editor: Editor, ids: EntityId[]): HotProps {
  if (ids.length === 0) {
    return { ...DEFAULT_HOT, entityType: null }
  }
  if (ids.length !== 1) {
    return {
      ...DEFAULT_HOT,
      ...selectionHotBounds(editor, ids),
      entityType: 'multi',
    }
  }
  const e = editor.document.getEntity(ids[0]!)
  if (!e) return { ...DEFAULT_HOT }

  const hot: HotProps = {
    ...DEFAULT_HOT,
    stroke: e.style.stroke ?? DEFAULT_HOT.stroke,
    fill: e.style.fill ?? DEFAULT_HOT.fill,
    opacity: e.style.opacity ?? 1,
    strokeWidth: e.style.strokeWidth ?? 1,
    entityType: e.type,
  }

  if (e.type === 'text') {
    const te = e as TextEntity
    hot.text = te.content
    hot.fontSize = te.fontSize
    hot.x = te.position.x
    hot.y = te.position.y
    hot.arcText = te.path?.kind === 'arc'
  } else if (e.type === 'image') {
    const img = e as ImageEntity
    hot.x = img.origin.x
    hot.y = img.origin.y
    hot.width = img.width
    hot.height = img.height
  } else if (e.type === 'line') {
    hot.x = Math.min(e.start.x, e.end.x)
    hot.y = Math.min(e.start.y, e.end.y)
    hot.width = Math.abs(e.end.x - e.start.x)
    hot.height = Math.abs(e.end.y - e.start.y)
  } else if (e.type === 'circle') {
    hot.x = e.center.x - e.radius
    hot.y = e.center.y - e.radius
    hot.width = e.radius * 2
    hot.height = e.radius * 2
  } else if (e.type === 'ellipse') {
    hot.x = e.center.x - e.radiusX
    hot.y = e.center.y - e.radiusY
    hot.width = e.radiusX * 2
    hot.height = e.radiusY * 2
  } else if (e.type === 'polyline' || e.type === 'bezier') {
    const xs = e.points.map((p) => p.x)
    const ys = e.points.map((p) => p.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    hot.x = minX
    hot.y = minY
    hot.width = maxX - minX
    hot.height = maxY - minY
  }

  return hot
}

function syncHistory(editor: Editor, store: AppStore): void {
  store.set({
    canUndo: editor.canUndo(),
    canRedo: editor.canRedo(),
  })
}

export async function placeImageAt(
  editor: Editor,
  source: File | Blob | string,
  world?: { x: number; y: number },
): Promise<EntityId | null> {
  const id = await editor.import.image(source)
  if (!id) return null
  if (world) {
    const e = editor.document.getEntity(id)
    if (e?.type === 'image') {
      editor.updateEntity(id, {
        origin: { x: world.x - e.width / 2, y: world.y - e.height / 2 },
      } as Partial<Entity>)
    }
  }
  return id
}

export function bindEditorEvents(
  editor: Editor,
  store: AppStore,
  canvasHost: HTMLElement,
): () => void {
  const disposers: Array<() => void> = []
  /** File chosen when activating the image tool; placed on the next canvas click. */
  let pendingImageFile: File | null = null
  let imagePickInFlight = false

  const syncSelection = () => {
    const ids = editor.selection.toArray()
    store.set({
      selectionIds: ids,
      hot: readHot(editor, ids),
      ...{ canUndo: editor.canUndo(), canRedo: editor.canRedo() },
    })
  }

  const chooseImageFile = async (): Promise<File | null> => {
    if (imagePickInFlight) return null
    imagePickInFlight = true
    try {
      return await pickImageFile()
    } finally {
      imagePickInFlight = false
    }
  }

  disposers.push(
    editor.on('tool:change', ({ tool }) => {
      store.set({ tool: tool as ToolName })
      if (tool !== 'image') {
        pendingImageFile = null
        return
      }
      // Open the file dialog as soon as the image tool is selected (same user gesture).
      void (async () => {
        store.set({ status: 'Choose image…' })
        const file = await chooseImageFile()
        if (editor.getTool() !== 'image') return
        if (!file) {
          pendingImageFile = null
          store.set({ status: 'Ready' })
          editor.setTool('select')
          return
        }
        pendingImageFile = file
        store.set({ status: 'Click canvas to place image' })
      })()
    }),
  )
  disposers.push(
    editor.on('selection:change', () => {
      syncSelection()
      syncHistory(editor, store)
    }),
  )
  disposers.push(
    editor.on('camera:change', ({ zoom }) => {
      store.set({ zoom })
    }),
  )
  disposers.push(
    editor.on('metrics', (m) => {
      store.set({
        metrics: {
          frameMs: m.frameMs,
          visibleCount: m.visibleCount,
          drawCalls: m.drawCalls,
          uploadBytes: m.uploadBytes,
        },
      })
    }),
  )
  disposers.push(
    editor.on('document:session', ({ state }) => {
      if (state === 'loading') store.set({ status: 'Loading…' })
      else if (state === 'active') {
        store.set({ status: 'Ready' })
        syncHistory(editor, store)
        syncSelection()
      }
    }),
  )

  editor.setPlaceImageHandler(async (world) => {
    let file = pendingImageFile
    if (!file) {
      store.set({ status: 'Choose image…' })
      file = await chooseImageFile()
    }
    if (!file) {
      store.set({ status: 'Ready' })
      return
    }
    pendingImageFile = null
    store.set({ status: 'Importing image…' })
    const id = await placeImageAt(editor, file, world)
    store.set({ status: id ? 'Image placed' : 'Image import failed' })
    editor.setTool('select')
    syncHistory(editor, store)
    syncSelection()
  })

  const onDragOver = (ev: DragEvent) => {
    if (ev.dataTransfer?.types.includes('Files')) {
      ev.preventDefault()
      ev.dataTransfer.dropEffect = 'copy'
    }
  }

  const onDrop = async (ev: DragEvent) => {
    const file = ev.dataTransfer?.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    const isSvg = name.endsWith('.svg') || file.type === 'image/svg+xml'
    const isDxf = name.endsWith('.dxf') || file.type.includes('dxf')
    const isGcode = /\.(nc|gcode|ngc)$/i.test(name)
    const isImage =
      (!isSvg && file.type.startsWith('image/')) ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)
    if (!isSvg && !isDxf && !isGcode && !isImage) return
    ev.preventDefault()
    store.set({ status: t('importing') })
    try {
      if (isSvg) {
        await editor.import.svg(await file.text())
      } else if (isDxf) {
        await editor.import.dxf(file)
      } else if (isGcode) {
        await editor.import.gcode(file)
      } else {
        const canvas = canvasHost.querySelector('canvas')
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const screen = screenPoint(ev.clientX - rect.left, ev.clientY - rect.top)
        const world = editor.camera.screenToWorld(screen)
        const id = await placeImageAt(editor, file, world)
        if (!id) {
          store.set({ status: t('importFailed') })
          return
        }
        editor.setTool('select')
      }
      store.set({ status: t('ready') })
      syncHistory(editor, store)
      syncSelection()
    } catch (err) {
      console.error(err)
      store.set({ status: t('importFailed') })
    }
  }

  canvasHost.addEventListener('dragover', onDragOver)
  canvasHost.addEventListener('drop', onDrop)
  disposers.push(() => {
    canvasHost.removeEventListener('dragover', onDragOver)
    canvasHost.removeEventListener('drop', onDrop)
  })

  // Initial sync
  store.set({
    tool: editor.getTool(),
    zoom: editor.camera.getState().zoom,
    displayUnit: editor.getDisplayUnit(),
  })
  syncSelection()
  syncHistory(editor, store)

  return () => {
    editor.setPlaceImageHandler(null)
    for (const d of disposers) d()
  }
}

export function refreshHotFromSelection(editor: Editor, store: AppStore): void {
  const ids = store.get().selectionIds
  store.set({
    hot: readHot(editor, ids),
    canUndo: editor.canUndo(),
    canRedo: editor.canRedo(),
    uiEpoch: store.get().uiEpoch + 1,
  })
}

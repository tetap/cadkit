import type { Editor } from '@cadkit/editor'
import { asEntityId, createEntityId, IDENTITY_TRANSFORM } from '@cadkit/types'
import { shapeText } from '@cadkit/text'
import { getLocale } from '../i18n/index.js'

export type SeedProgress = (done: number, total: number) => void

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Fast wipe for seed / stress tools — bypasses per-entity history. */
export function clearDocument(editor: Editor): void {
  editor.selection.clear()
  editor.document.clearEntities()
  editor.history.clear()
  editor.scene.rebuildIndex()
  editor.requestRender()
}

/**
 * Generate squares in chunks, yielding to the event loop so the UI stays responsive.
 * Spatial index is rebuilt once at the end (avoids O(n²) compact during bulk insert).
 */
export async function seedSquares(
  editor: Editor,
  count: number,
  onProgress?: SeedProgress,
): Promise<void> {
  const layer = editor.document.getDefaultLayerId()
  const cols = Math.ceil(Math.sqrt(count))
  const batchSize = 8_000
  const batch = []
  for (let i = 0; i < count; i++) {
    const x = (i % cols) * 10
    const y = Math.floor(i / cols) * 10
    batch.push({
      id: asEntityId(`sq_${i}`),
      type: 'polyline' as const,
      layerId: layer,
      style: { stroke: '#32cd79', strokeWidth: 1 },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      points: [
        { x, y },
        { x: x + 8, y },
        { x: x + 8, y: y + 8 },
        { x, y: y + 8 },
      ],
      closed: true,
    })
    if (batch.length >= batchSize) {
      editor.document.addMany(batch.splice(0, batch.length))
      onProgress?.(i + 1, count)
      await yieldToUi()
    }
  }
  if (batch.length) {
    editor.document.addMany(batch)
  }
  onProgress?.(count, count)
  editor.scene.rebuildIndex()
  editor.requestRender()
}

export async function seedGrid(
  editor: Editor,
  n: number,
  origin = 0,
  million = false,
  onProgress?: SeedProgress,
): Promise<ReturnType<typeof createEntityId>[]> {
  const sampleIds: ReturnType<typeof createEntityId>[] = []
  const count = million ? 1_000_000 : n * n
  const layer = editor.document.getDefaultLayerId()
  const cols = million ? 1000 : n
  const batchSize = million ? 8_000 : Math.max(n * n, 1)
  const batch = []
  for (let i = 0; i < count; i++) {
    const x = origin + (i % cols) * 10
    const y = origin + Math.floor(i / cols) * 10
    const id = asEntityId(`line_${i}`)
    if (sampleIds.length < 64) sampleIds.push(id)
    batch.push({
      id,
      type: 'line' as const,
      layerId: layer,
      style: { stroke: '#32cd79', strokeWidth: 1 },
      transform: IDENTITY_TRANSFORM,
      version: 1,
      start: { x, y },
      end: { x: x + 8, y: y + 4 },
    })
    if (batch.length >= batchSize) {
      editor.document.addMany(batch.splice(0, batch.length))
      if (million) {
        onProgress?.(i + 1, count)
        await yieldToUi()
      }
    }
  }
  if (batch.length) {
    editor.document.addMany(batch)
  }
  if (million) onProgress?.(count, count)
  editor.scene.rebuildIndex()
  editor.requestRender()
  return sampleIds
}

/** Quiet demo: sample shapes on colored layers. */
export function seedDemoContent(editor: Editor): void {
  const base = editor.document.getDefaultLayerId()
  editor.updateLayer(base, { name: getLocale() === 'zh-CN' ? '轮廓' : 'Outline', color: '#2563eb' })
  const textLayer = editor.addLayer({
    name: getLocale() === 'zh-CN' ? '文字' : 'Text',
    color: '#f59e0b',
  })
  editor.setActiveLayer(base)

  const wa = editor.getWorkArea()
  const margin = Math.min(wa.width, wa.height) * 0.12
  const x0 = wa.originX + margin
  const y0 = wa.originY + margin
  const x1 = wa.originX + wa.width - margin
  const y1 = wa.originY + wa.height * 0.55

  editor.add({
    id: createEntityId('demo-rect'),
    type: 'polyline',
    layerId: base,
    style: { stroke: '#2563eb', strokeWidth: 1.25, fill: '#2563eb' },
    transform: IDENTITY_TRANSFORM,
    version: 1,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    closed: true,
  })

  const shaped = shapeText(
    getLocale() === 'zh-CN' ? 'CADKit 编辑器' : 'CADKit Editor',
    'sans-serif',
    Math.max(8, Math.min(wa.height, wa.width) * 0.08),
  )
  editor.add({
    id: createEntityId('text'),
    type: 'text',
    layerId: textLayer.id,
    style: { stroke: '#f59e0b', fill: '#f59e0b' },
    transform: IDENTITY_TRANSFORM,
    version: 1,
    content: shaped.text,
    position: { x: x0, y: y1 + margin * 0.35 },
    fontFamily: shaped.fontFamily,
    fontSize: shaped.fontSize,
  })

  // Demo curve text (arc) — outline style like CAD lettering.
  const arcFont = Math.max(6, Math.min(wa.height, wa.width) * 0.1)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2 + wa.height * 0.05
  editor.add({
    id: createEntityId('text-arc'),
    type: 'text',
    layerId: textLayer.id,
    style: { stroke: '#f59e0b', fill: '#f59e0b' },
    transform: IDENTITY_TRANSFORM,
    version: 1,
    content: 'HELLO',
    position: { x: cx, y: cy },
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: arcFont,
    path: {
      kind: 'arc',
      radius: Math.max(20, Math.min(wa.width, wa.height) * 0.28),
      startAngle: -Math.PI * 0.85,
      sweep: Math.PI * 1.7,
      baseline: 'outer',
    },
  })

  editor.setActiveLayer(base)
  editor.fitView()
}

export { Editor, createEditor, type CreateEditorOptions } from './Editor.js'
export type { EditorPlugin } from './plugin.js'
export type { ToolName } from '@cadkit/interaction'

// Re-export commonly used types for Fabric-like DX
export {
  createEntityId,
  createLayerId,
  worldPoint,
  screenPoint,
  IDENTITY_TRANSFORM,
  type Entity,
  type LineEntity,
  type EditorConfig,
  type LengthUnit,
} from '@cadkit/types'
export { CadDocument, layerFillFromStroke, type Layer } from '@cadkit/document'
export {
  Camera2D,
  convertLength,
  rasterPixelsToWorld,
  svgUserUnitsToWorld,
  RASTER_DPI,
  SVG_DPI,
  UNIT_LABEL,
  type OffsetOptions,
  type OffsetDirection,
  type OffsetJoin,
} from '@cadkit/geometry'

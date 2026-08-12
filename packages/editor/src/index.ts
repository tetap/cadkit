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
export {
  CadDocument,
  DEFAULT_LAYER_GCODE,
  isImageLayer,
  layerAcceptsEntity,
  layerFillFromStroke,
  resolveLayerAwarePaint,
  resolveLayerGcode,
  type Layer,
  type LayerAwarePaint,
  type LayerEngraveMode,
  type LayerFillStyle,
  type LayerGcodeParams,
} from '@cadkit/document'
export {
  Camera2D,
  convertLength,
  rasterPixelsToWorld,
  svgUserUnitsToWorld,
  RASTER_DPI,
  SVG_DPI,
  UNIT_LABEL,
  booleanOpsAvailable,
  type OffsetOptions,
  type OffsetDirection,
  type OffsetJoin,
  type BooleanOp,
  type BooleanOptions,
} from '@cadkit/geometry'

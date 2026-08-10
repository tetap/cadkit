# Concepts

## Entity

Discriminated union: `line | polyline | arc | circle | text | group | blockInstance | ...`

## Group vs SelectionSet

- `Group`: persistent semantic container, written to the document, undoable.
- `SelectionSet`: temporary multi-select, not persisted.

## Camera2D

Maintains a Float64 world camera; `zoomAt` / `pan` / `fitBounds`; never rewrites entity coordinates.

## SceneProjector

Document → visible `RenderItem[]` with LOD, culling and batch hints.

## Command / History

All edits go through command transactions; drag updates may coalesce via `coalesceKey`.

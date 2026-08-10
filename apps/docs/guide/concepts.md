# 核心概念

## Entity

判别联合：`line | polyline | arc | circle | text | group | blockInstance | ...`

## Group vs SelectionSet

- `Group`：持久语义容器，写入文档，可撤销。
- `SelectionSet`：临时多选，不写回文档。

## Camera2D

维护 Float64 世界相机；`zoomAt` / `pan` / `fitBounds`；永不回写实体坐标。

## SceneProjector

文档 → 可见 `RenderItem[]`，附带 LOD、裁剪与批次提示。

## Command / History

所有编辑走命令事务；拖拽更新可按 `coalesceKey` 合并。

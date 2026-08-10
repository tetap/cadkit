# 坐标与相机

品牌类型：`world` / `local` / `view` / `screen` / `device`。

```ts
const world = editor.camera.screenToWorld(screenPoint)
const screen = editor.camera.worldToScreen(world)
```

GPU 侧使用「块原点 + Float32 相对坐标」；捕捉、测量、导出始终在 Float64。

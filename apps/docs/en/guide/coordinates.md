# Coordinates & Camera

Branded spaces: `world` / `local` / `view` / `screen` / `device`.

```ts
const world = editor.camera.screenToWorld(screenPoint)
const screen = editor.camera.worldToScreen(world)
```

GPU uses “chunk origin + Float32 relative coords”; snap, measure and export always stay on Float64.

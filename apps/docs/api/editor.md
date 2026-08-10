# createEditor

```ts
const editor = await createEditor(options)
```

## 主要方法

- `add` / `remove` / `group` / `ungroup` / `select` / `fitView` / `undo` / `redo` / `dispose`
- `setTool('select' | 'pan' | 'line' | …)` / `getTool()`
- `setSelectionHitMode('bounds' | 'geometry')` / `getSelectionHitMode()`
- `setInteraction(partial)` / `getInteraction()`
- `setDisplayUnit` / `setGridVisible` / `setRulersVisible`
- `setWorkAreaMode` / `setWorkAreaSize` / `getWorkArea`
- `import.svg` / `import.dxf`
- `export.svg` / `export.json`
- `on(event, handler) => disposer`
- `use(plugin)`
- `getMetrics()` / `getCapabilities()` / `getWorkerAbi()`

## interaction 配置

```ts
await createEditor({
  interaction: {
    selectionHitMode: 'bounds',
    snapEnabled: true,
    alignEnabled: true,
    showDistances: true,
    angleStepDeg: 15,
    gridSize: 10,
    pixelTolerance: 8,
    panDamping: 5,
  },
})
```

详见 [交互指南](/guide/interaction)。

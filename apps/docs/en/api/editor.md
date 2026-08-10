# createEditor

```ts
const editor = await createEditor(options)
```

## Main methods

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

## interaction config

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

See the [Interaction guide](/en/guide/interaction).

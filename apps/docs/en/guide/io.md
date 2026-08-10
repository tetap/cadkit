# SVG / DXF / Images

## SVG

- Supports line / polyline / polygon / rect / circle / ellipse / text / **image**
- `<image href|xlink:href>` keeps transform and `preserveAspectRatio`
- When no explicit physical size is present, SVG user units map at **72 DPI** into document world units
- `use` / `filter` / `mask` emit structured warnings

```ts
await editor.import.svg(svgText)
editor.export.svg()
```

## Images

```ts
await editor.import.image(file)
await editor.import.image('https://…')
```

`@cadkit/assets` AssetRegistry decodes bitmaps, tracks refs, and budgets GPU textures. `ImageEntity.assetId` is the stable reference; serialization keeps `href`.

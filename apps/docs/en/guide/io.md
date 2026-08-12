# Import / Export

CADKit unifies I/O through `@cadkit/io-*` packages and the editor facade:

| Format | Package | Import | Export |
|--------|---------|--------|--------|
| SVG | `@cadkit/io-svg` | ✓ | ✓ |
| DXF | `@cadkit/io-dxf` | ✓ | — |
| G-code / NC | `@cadkit/io-gcode` | ✓ | ✓ |
| Raster images | `@cadkit/assets` | ✓ | (via SVG / JSON refs) |
| JSON document | `@cadkit/editor` | — | ✓ |

```ts
await editor.import.svg(svgText)
await editor.import.dxf(file)
await editor.import.gcode(ncText)   // .nc / .gcode / .ngc
await editor.import.image(file)

const svg = editor.export.svg()
const json = editor.export.json()
const gcode = await editor.export.gcode()
```

---

## SVG

- Supports line / polyline / polygon / rect / circle / ellipse / text / **image**
- `path` expands to polyline + cubic bezier by default
- `<image href|xlink:href>` keeps transform and `preserveAspectRatio`
- When no explicit physical size is present, SVG user units map at **72 DPI** into document world units
- `use` / `filter` / `mask` emit structured warnings

```ts
await editor.import.svg(svgText)
const svg = editor.export.svg() // ImageEntity emits href / size / transform
```

---

## DXF

Based on [`dxf-render/parser`](https://github.com/arbaev/dxf-kit):

- LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / ELLIPSE / SPLINE / TEXT / MTEXT / INSERT
- Reads `$INSUNITS` and converts into document units
- After parse, fragmented linework is **welded** via shared `optimizeImportPaths` (`@cadkit/geometry`)

```ts
await editor.import.dxf(file)
```

---

## G-code

Package: `@cadkit/io-gcode`. Targets GRBL-style laser / engraver workflows.

### Import

Supported motion / state:

- `G0` / `G1` lines, `G2` / `G3` arcs
- `G20` / `G21` units, `G90` / `G91` absolute / incremental
- `M3` / `M5` laser on / off (cut segment boundaries)

Defaults:

- `flipY: true` — machine bottom-left ↔ canvas Y-down
- `optimize: true` — weld fragments / self-close / collinear simplify

```ts
await editor.import.gcode(source, {
  flipY: true,
  optimize: true,
})
```

Playground accepts drag / open of `.nc` · `.gcode` · `.ngc`.

### Export

Reads **per-layer** machine params, builds a toolpath plan, then emits GRBL:

| Layer mode | Behavior |
|------------|----------|
| `line` | Stroke outlines |
| `fill` | Hatch scanlines (bidirectional / cross-hatch) |
| `image` | Grayscale PWM scan engraving (S follows pixel tone) |

Layer params (`Layer.gcode`):

- `mode` · `fillStyle` (`bidirectional` | `crossHatch`) · `fillAngle` (degrees; cross = angle + 90°)
- `lineSpacing` · `power` · `speed` · `passes`

Export enables **travel optimization** by default (chain → NN with closed-loop entry / reverse → 2-opt). Cut geometry length is unchanged — only order and direction.

```ts
const gcode = await editor.export.gcode({
  travelSpeed: 3000,
  flipY: true,
  optimizeOrder: true,
  start: { x: 0, y: 0 },
})
```

Playground: edit params in the layer side panel; open the toolpath preview for travel / cut.

Lower-level API:

```ts
import { importGcode, exportGcode, buildToolpaths } from '@cadkit/io-gcode'
```

---

## Images & image layers

```ts
await editor.import.image(file)          // File | Blob
await editor.import.image('https://…')   // URL / data URL
```

- `@cadkit/assets`: `AssetRegistry` decodes (`createImageBitmap`), ref-counts, and budgets GPU textures
- `ImageEntity.assetId` is the stable reference; serialization keeps `href`
- Imports create or reuse an **image layer** (`gcode.mode === 'image'`) without stealing the active vector layer
- Entities cannot be dragged between image and line/fill layers; export uses grayscale PWM scanlines (`lineSpacing` sets pitch)
- Playground: AppBar import, Image tool, canvas drag-and-drop

---

## Import path optimization

DXF / G-code import share `optimizeImportPaths` (`@cadkit/geometry`):

1. **Endpoint weld** — merge fragments within tolerance  
2. **Self-close** — close rings when endpoints meet  
3. **Collinear simplify** — drop midpoints on straight runs  

`stats.before` / `after` count open paths only; circles, arcs, and other non-path entities pass through unchanged.

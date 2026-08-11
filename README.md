# CADKit

**English** | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md)

Industrial **CAD infinite-canvas editor framework** for the web — WebGPU rendering, Float64 document model, and a modular monorepo built for high entity counts.

CADKit combines a production-oriented interaction model (selection, transforms, snaps, layers) with a scalable scene pipeline (spatial index, LOD, dirty updates). Inspired by incremental / dirty-region ideas from [LeaferJS](https://github.com/leaferjs/leafer-ui) and the approachable object/handle APIs of [Fabric.js](https://fabricjs.com/).

> **Status:** early open source (`v0.1`). APIs may evolve. Contributions and feedback welcome.

---

## Why CADKit?

| | |
|---|---|
| **WebGPU-first** | Vector + image passes on a modern GPU path (no Canvas2D fallback as the primary renderer) |
| **CAD-grade model** | Float64 authority document, layers, groups, undo/redo |
| **Editor UX** | Object-mode AABB transforms, Figma-like rulers/grid, align & angle snap |
| **Manufacturing-ready hooks** | Per-layer GRBL / G-code engrave parameters (export-oriented; not used for screen paint) |
| **Scale targets** | Chunked loading, bounded memory, million-entity navigation goals |

---

## Core canvas features

### Drawing & editing
- **Tools:** Select (V), Pan, Line, Rectangle, Ellipse, Circle, Polyline, Pen (Bezier), Brush, Text, Image
- **Transforms:** Scale / rotate handles, group & ungroup, undo / redo
- **Text:** Straight text + **arc / curve text** with on-canvas radius handles
- **Boolean ops:** Union, subtract, intersect, exclude (multi-select)
- **Offset:** Contour offset with join styles; multi-select unions overlapping results
- **Images:** Import, place, optional filter stack

### Document & layers
- Multi-layer document with visibility & color
- **Drag to reorder** layers; **drag entities** onto another layer
- Layer stack drives draw order (panel top = front)
- **Per-layer GRBL params** (right sidebar when a layer is selected):
  - Engrave mode: **line** or **fill**
  - Fill: line spacing + styles — Bi-directional, Cross-Hatch, Fill Shapes Individually, Offset Fill
  - Power, speed, passes  
  *(Stored for future G-code export; does not affect canvas rendering. Entities do not have individual machine params.)*

### View & guides
- Infinite canvas with zoom / pan (incl. inertia)
- Rulers, major/minor/mid grid, **page work area** mode
- Align snap & angle snap
- Selection hit modes (bounds / geometry)

### Interoperability
- **Import:** SVG, DXF (streaming), raster images
- **Export:** SVG, JSON document
- Document units (e.g. mm) with display unit & DPI import settings

### Architecture highlights
- Monorepo packages: `document` · `geometry` · `scene` · `interaction` · `render-webgpu` · `editor` · …
- Spatial index (R-tree / BVH), display-list caching, LOD
- Worker / WASM hooks for heavy compute (extensible)

---

## Quick start

```bash
# Node >= 20, pnpm 10+
pnpm install
pnpm build
pnpm playground:dev    # full desktop editor playground
pnpm docs:dev          # VitePress docs
```

Open the playground, try drawing tools, layers dock, and the right-side layer G-code form after selecting a layer.

---

## Repository layout

```
apps/
  docs/          VitePress documentation
  playground/    Full desktop editor (Dev menu: stress / seed / benchmarks)
packages/
  types/         Public types & extension points
  geometry/      Matrices, bounds, curves, boolean, offset, text layout
  document/      Float64 authority model + layers (+ gcode params)
  spatial/       R-tree / BVH
  commands/      Transactions & undo/redo (incl. group/ungroup)
  scene/         Document → cacheable display list
  assets/        Image registry & filter contracts
  render-core/   Renderer abstraction & budgets
  render-webgpu/ WebGPU backend (vectors + images)
  interaction/   Tools, selection, snaps, handles, text overlay
  text/          IME + shaping helpers
  guides/        Grid / rulers geometry
  io-svg/        SVG (incl. image)
  io-dxf/        Streaming DXF
  platform-web/  Browser capabilities
  worker-runtime/ Worker messaging
  wasm/          WASM ABI placeholder + JS fallback
  editor/        Public facade (`createEditor`)
```

---

## Performance targets (v1 freeze)

| Scenario | Target |
|----------|--------|
| Tens of millions of entities | Chunked load, bounded memory |
| ~1M simple visible entities | Aim 60 FPS on high-end desktop; ~30 FPS on iGPU |
| Navigation frame time | High-end p95 ≤ 16.7 ms; iGPU ≤ 33 ms |
| Pure pan geometry upload | &lt; 1 KB/frame (`pan-reuse`) |
| Click feedback | p95 ≤ 100 ms |
| Local edit first frame | ≤ 100 ms |

Dense splines, fills, and massive text are not promised at full detail for 1M on-screen entities — LOD and real benchmarks apply.

---

## Playground UI locale

The playground shell currently ships **zh-CN** and **en-US** UI strings.  
This repository documents the project in **Chinese, English, Japanese, and Korean** (see links at the top). Additional UI locales are welcome via PR.

---

## Contributing

1. `pnpm install && pnpm build && pnpm test`
2. Keep changes focused; match existing TypeScript / package boundaries
3. Add or update tests for geometry, document, and interaction behavior
4. Open a PR with a clear summary and test plan

Issues and feature proposals are welcome at [github.com/tetap/cadkit](https://github.com/tetap/cadkit).

---

## License

[MIT](./LICENSE)

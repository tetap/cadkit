<p align="center">
  <h1 align="center">CADKit</h1>
  <p align="center">
    <a href="https://github.com/tetap/cadkit/stargazers"><img src="https://img.shields.io/github/stars/tetap/cadkit?style=flat&color=f5a623" alt="GitHub stars" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://gpuweb.github.io/gpuweb/"><img src="https://img.shields.io/badge/WebGPU-first-4141E2" alt="WebGPU-first" /></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node >= 20" /></a>
  </p>
  <p align="center">
    <a href="./README.md"><b>English</b></a> ·
    <a href="./README.zh-CN.md">简体中文</a> ·
    <a href="./README.ja.md">日本語</a> ·
    <a href="./README.ko.md">한국어</a>
  </p>
  <p align="center">
    <b>The CAD canvas framework for makers who ship on the web.</b><br />
    WebGPU rendering, a Float64 document model, and editor UX that feels like a design tool — with manufacturing I/O when you need it.
  </p>
</p>

<p align="center">
  <a href="https://tetap.github.io/cadkit/"><b>Live demo →</b></a>
  &nbsp;·&nbsp;
  <a href="#quick-start">Quick start</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/tetap/cadkit/tree/main/apps/docs">Docs</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/tetap/cadkit/tree/main/apps/playground">Playground</a>
</p>

---

## Features

### WebGPU Infinite Canvas

Vector and image passes on a modern GPU path — pan, zoom, and edit without a Canvas2D primary renderer.

[Docs →](./apps/docs/guide/rendering.md)

### CAD-grade Document

Float64 authority model, layers, groups, compound paths with holes, and undo / redo you can trust.

[Docs →](./apps/docs/guide/concepts.md)

### Editor UX That Gets Out of the Way

Object-mode transforms, parametric shape handles (rect / star), arc text, rulers, grid, align & angle snap.

[Docs →](./apps/docs/guide/interaction.md)

### Boolean, Offset & Path Edit

Union / subtract / intersect / exclude; contour offset (including groups); vertex select & delete in path edit mode.

[Docs →](./apps/docs/guide/interaction.md)

### Layers Built for Fabrication

Per-layer line / fill / image modes, GRBL-oriented power · speed · passes, hatch preview, and drag-to-reorder stack.

[Docs →](./apps/docs/guide/io.md)

### Import What You Have, Export What You Cut

SVG · DXF · G-code · raster images in; SVG · JSON · G-code out — with path welding and travel optimization on import / export.

[Docs →](./apps/docs/guide/io.md)

**Also in the box:**

- **Image layers** — Imported rasters land on dedicated image layers; vector and image stacks stay isolated.
- **Curve text** — Arc / path text with on-canvas radius handles, same resident style as shape params.
- **Snaps with feedback** — Object align, grid, and angle snap with visible guides (not silent magnetic pulls).
- **Spatial pipeline** — R-tree / BVH, display-list cache, LOD, incremental WebGPU updates.
- **Playground shell** — Full desktop editor UI (zh-CN / en-US) to try the stack before you embed it.
- **And more** — APIs are early (`v0.1`); the [commit history](https://github.com/tetap/cadkit/commits/main) is the living changelog.

---

## Stack at a glance

Works as a **TypeScript monorepo** — pick packages, or start from the editor facade.

| Layer | Packages |
|-------|----------|
| **Public API** | `@cadkit/editor` · `@cadkit/types` |
| **Model** | `@cadkit/document` · `@cadkit/commands` · `@cadkit/geometry` |
| **View** | `@cadkit/scene` · `@cadkit/render-webgpu` · `@cadkit/guides` |
| **Input** | `@cadkit/interaction` · `@cadkit/text` |
| **I/O** | `@cadkit/io-svg` · `@cadkit/io-dxf` · `@cadkit/io-gcode` · `@cadkit/assets` |

Inspired by incremental / dirty-region ideas from [LeaferJS](https://github.com/leaferjs/leafer-ui) and approachable object / handle APIs from [Fabric.js](https://fabricjs.com/) — purpose-built for CAD scale and manufacturing workflows.

---

## Quick start

```bash
# Node >= 20, pnpm 10+
pnpm install
pnpm build
pnpm playground:dev    # full desktop editor
pnpm docs:dev          # VitePress docs
```

```ts
import { createEditor } from '@cadkit/editor'

const editor = await createEditor({ view: canvas, theme: 'light' })
await editor.import.svg(svgText)
await editor.import.dxf(dxfFile)
await editor.import.gcode(gcodeText)
const nc = editor.export.gcode()
```

Open the playground, draw a star, tweak tip / corner handles, assign a layer’s fill angle, then export G-code.

---

## Repository layout

```
apps/
  docs/          VitePress documentation
  playground/    Full desktop editor (Dev: stress / seed / benches)
packages/
  editor/        Public facade (`createEditor`)
  document/      Float64 model + layers (+ gcode / image modes)
  geometry/      Matrices, curves, boolean, offset, shapes, import weld
  interaction/   Tools, selection, snaps, handles, text overlay
  scene/         Document → cacheable display list
  render-webgpu/ WebGPU vectors + images
  io-svg/        SVG import / export
  io-dxf/        Streaming DXF
  io-gcode/      G-code import / export + hatch + path order
  …              types, spatial, commands, assets, text, guides, wasm
```

---

## Performance targets (v1)

| Scenario | Target |
|----------|--------|
| Tens of millions of entities | Chunked load, bounded memory |
| ~1M simple visible entities | ~60 FPS high-end · ~30 FPS iGPU |
| Navigation frame time | p95 ≤ 16.7 ms (high-end) · ≤ 33 ms (iGPU) |
| Pure pan geometry upload | &lt; 1 KB/frame (`pan-reuse`) |
| Click / local-edit feedback | p95 ≤ 100 ms |

Dense splines, fills, and massive text are not promised at full detail for 1M on-screen entities — LOD and real benches apply.

---

## Developing

```bash
pnpm install && pnpm build && pnpm test
```

1. Keep changes focused; respect package boundaries  
2. Add or update tests for geometry, document, and interaction  
3. Open a PR with a clear summary and test plan  

Issues and ideas: [github.com/tetap/cadkit](https://github.com/tetap/cadkit).

---

## License

CADKit is free and open source under the [MIT License](./LICENSE).

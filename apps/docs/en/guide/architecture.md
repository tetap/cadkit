# Architecture

## Layers

```
UI / Playground
    ↓
@cadkit/editor          public facade
    ↓
interaction / scene / commands
    ↓
document (Float64 SoA authority)  ←→  spatial (R-tree)
    ↓
render-core ← render-webgpu
    ↓
platform-web / worker-runtime / wasm
```

## Principles

1. **Document is the single source of truth**: render objects are disposable; never treat GPU vertices as authoritative.
2. **Unified Backend protocol**: business code must not depend on WebGPU internals; WebGPU is the only renderer.
3. **Incremental invalidation**: changes carry `beforeBounds/afterBounds` for index and dirty regions.
4. **Flat display list**: sorted by `pass → primitive → style` for batching.
5. **Instance-scoped plugins**: no global mutable registries.

## Relation to Leafer / Fabric

| Source | Adopted | Not copied |
|--------|---------|------------|
| LeaferJS | Dirty regions, lifecycle, layering, platform adapters | Linear-tree hit testing, single huge dirty rect |
| Fabric.js | Facade API, handle strategy, event disposers, SVG DX | Per-object offscreen cache as main path, as CAD model |

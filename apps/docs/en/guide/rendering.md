# Rendering & incremental updates

CADKit is **WebGPU-only**. Canvas/OffscreenCanvas is used only for glyph atlases / decode helpers, never as the document renderer.

## Incremental path

| Mode | Behavior |
|------|----------|
| `full` | Rebuild visible display list after scene edits; upload vectors |
| `pan-reuse` | Pan-only: reuse DisplayList + GPU verts; update camera uniforms only |
| `zoom-bin` | Retessellate when zoom crosses an LOD bin |

Geometry cache key: `(entityId, entity.version, lodBin)`. Handle overlay uses a DOM element pool. Dirty-rect metadata is recorded via `consumeDirtyMeta()` for a future partial-redraw path.

## Images & filters

Image pass draws alpha-blended quads. Built-in filters: brightness, contrast, saturation, grayscale, invert, opacity (blur: separable H/V passes). Custom WGSL accepts **only** the body of `filter(color, uv, params) -> vec4f`; forbidden constructs fall back to identity.

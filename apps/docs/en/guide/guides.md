# Rulers & Grid

CADKit ships Figma-style rulers and grid, both synced to `Camera2D` pan/zoom, with unit switching.

## Units

Document storage unit: `document.unit` (world coordinates)  
Ruler display unit: `document.displayUnit`

```ts
editor.setDisplayUnit('in') // labels only — geometry unchanged
```

Supported: `mm | cm | m | in | ft | px | pt`

Ticks use a 1/2/5×10ⁿ nice step; major ticks target ~80 CSS pixels. Grid lines include **major / mid / minor** so mid ticks are not dropped (which previously looked like a missing line).

## Work area

- `unbounded`: infinite grid filling the viewport
- `page`: finite page rectangle; grey outside, grid clipped to the page with forced border lines

```ts
editor.setWorkAreaMode('page')
editor.setWorkAreaSize(210, 297)
```

## API

```ts
editor.setGridVisible(true)
editor.setRulersVisible(true)
```

- Rulers: DOM overlay (crisp labels)
- Grid: WebGPU screen-space overlay pass (1px line width while panning/zooming)

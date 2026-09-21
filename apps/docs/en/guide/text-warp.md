# Text Warp

Photoshop / xTool-style envelope warp: eight presets (arc, arc-lower, arc-upper, arch, bulge, shell, flag / crown, wave), plus direction, bend, and horizontal / vertical perspective. Warp is applied to **glyph outlines**, so preview, hatch, G-code, and SVG share one path.

Source: `packages/geometry/src/text-warp.ts`. Outline hook: `packages/geometry/src/text-outlines.ts`.

## Pipeline

```mermaid
flowchart LR
  A[TextEntity.warp] --> B[canvas raster + Moore traces]
  B --> C[unwarped contours + ink AABB]
  C --> D[densify closed rings]
  D --> E[warpPoint per vertex]
  E --> F[render / hatch / G-code]
```

1. Extract unwarped outlines from layout (straight or arc). The cache key **omits** `warp`, so translating text does not re-rasterize.
2. Build the ink AABB from all contour points; that box is the envelope frame.
3. Densify closed rings from the box size so large arcs / waves do not collapse to polylines.
4. Map every point with `warpPoint`. `bend = distortH = distortV = 0` is identity and is skipped.

Playground: select text → ContextBar **Warp** → write `TextEntity.warp`. Sliders −100%…100% map to `[-1, 1]`.

## Data

```ts
interface TextWarp {
  style: TextWarpStyle          // arc | arcLower | arcUpper | arch | bulge | shell | flag | wave
  direction?: 'horizontal' | 'vertical'
  bend: number                  // intensity [-1, 1]
  distortH?: number             // horizontal perspective [-1, 1]
  distortV?: number             // vertical perspective [-1, 1]
}
```

## Coordinates

The editor is **Y-down**. Envelope math runs in a **Y-up** frame centered on the ink box, then folds back.

$$
\begin{aligned}
u &= (x - c_x) / \mathrm{halfW} \in [-1, 1] \\
v &= -(y - c_y) / \mathrm{halfH} \in [-1, 1]
\end{aligned}
$$

`direction === 'vertical'` swaps $(u, v)$ before the map and swaps the result after, so one formula covers vertical text.

## Core: `warpPoint`

For a point inside the box:

1. Normalize to $(u, v)$.
2. `styleEnvelope(style, u, v, bend, halfW, halfH, hd, vd)` returns local $(o_x, o_y)$ (Y-up, world units).
3. **Flag / Wave** fold perspective into the envelope. Other styles get a **baseline-anchored** trapezoid afterwards:

$$
o_y' = \mathrm{bot}(u) + \bigl(o_y - \mathrm{bot}(u)\bigr) \cdot \max(0.42,\ 1 + h_d \cdot u \cdot 0.82)
$$

   Horizontal perspective grows height from the column bottom instead of scaling all of $Y$ about the center (the latter crushes a wide line into a mountain). Vertical: $o_x' = o_x \cdot (1 + v_d \cdot v)$.
4. Back to editor space: $(c_x + o_x,\ c_y - o_y)$.

## Flag / crown (`flag`)

Reference shots: 50% is a flag wave; 100% + H 100% + V −18% is a tall peak right of center, pointy tops, and a long right-hand tail.

**Crown wave** (0 at both ends, 1 in the middle):

$$
w(u) = \cos(u \cdot \pi / 2)
$$

**Bend easing**: 50% keeps the reference amplitude; above 50% it does not double linearly, so the slope does not smear neighbouring glyphs into a triangle.

$$
b' =
\begin{cases}
b & |b| \le 0.5 \\
\mathrm{sign}(b)\bigl(0.5 + 0.42(|b|-0.5)\bigr) & |b| > 0.5
\end{cases}
$$

**Amplitude tracks glyph height and caps width**. Uncapped $k \cdot \mathrm{halfW}$ turned a long digit string into a mountain at 100% + horizontal perspective:

$$
A = b' \bigl(1.85\,\mathrm{halfH} + 0.4 \cdot \min(\mathrm{halfW},\ 5.5\,\mathrm{halfH})\bigr)
$$

**Top and bottom share phase; the top rides more** (mid glyphs grow). Horizontal perspective boosts the crown on $+u$ and grows from the **column baseline**:

$$
\begin{aligned}
w_H &= w(u)\cdot(1 + h_d \cdot u \cdot 0.45) \\
\mathrm{bot} &= -\mathrm{halfH} + 0.42 A\, w_H \\
\mathrm{rawTop} &= \mathrm{halfH} + 1.38 A\, w_H \\
h &= \max(0.62,\ 1 + h_d \cdot u \cdot 0.7) \\
\mathrm{top} &= \mathrm{bot} + (\mathrm{rawTop}-\mathrm{bot})\, h \\
o_y &= \mathrm{lerp}(\mathrm{bot},\ \mathrm{top},\ (v+1)/2)
\end{aligned}
$$

$w(u)$ is still 0 at the ends, so the far right does not become the tallest column — that is the flat tail of the last “3” in the reference.

**Shear** (verticals lean with the slope):

$$
o_x = u\cdot\mathrm{halfW}\cdot\max(0.35,\ 1 + v_d\cdot v\cdot 1.6) + b'\cdot 0.38\cdot\mathrm{halfH}\cdot\bigl(-\sin(u\pi/2)\bigr)\cdot v
$$

Negative vertical perspective also spills the bottom-right outward for the tail. Shear stays mild so the left-hand “1” does not collapse to a diagonal.

## Other presets

| Style | Idea |
|-------|------|
| Arc `arc` | World-space circular arc: chord = line width, sag $\propto \max(\mathrm{halfH},\ \mathrm{halfW})$, interpolate by column radius. Not square-normalized (wide lines stay wide). |
| Arc lower / upper | Bend only the bottom or top edge; the other stays flat; lerp in $v$. |
| Arch `arch` | Add $A\cdot\cos(u\pi/2)$ to the whole column; height almost unchanged. |
| Bulge `bulge` | Scale column $Y$ by $1 + b\cdot w(u)$. |
| Shell `shell` | Wide top, pinched bottom, parabolic lift at the top. |
| Wave `wave` | Same envelope as flag, two periods $\sin((u+1)\pi)$, smaller amplitude. |

Arc radius:

$$
R = \frac{\mathrm{halfW}^2 + s^2}{2|s|},\quad
\theta = u\cdot\arctan(\mathrm{halfW}/(R-|s|)),\quad
r = \mathrm{sign}(s)\,R + \ell_y
$$

## Densify

Closed rings insert points at $\max(0.25,\ \min(\mathrm{width},\mathrm{height})/36)$, at most 32 segments per edge. Open paths are left as-is.

## Files

| Path | Role |
|------|------|
| `packages/types/src/entities.ts` | `TextWarp` / `TextWarpStyle` |
| `packages/geometry/src/text-warp.ts` | Envelope + perspective |
| `packages/geometry/src/text-outlines.ts` | Hook after raster outlines |
| `apps/playground/src/ui/TextWarpDialog.ts` | Warp panel |

Tests: `packages/geometry/src/text-warp.test.ts` (identity, arc lift, flag mid-height, H-perspective right peak, left side not crushed).

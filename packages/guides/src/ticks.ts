import type { Camera2D, LengthUnit } from '@cadkit/geometry'
import {
  computeTickScale,
  displayToWorld,
  formatTickLabel,
  worldToDisplay,
  type TickScale,
} from '@cadkit/geometry'

export type TickKind = 'major' | 'mid' | 'minor'

export interface TickMark {
  /** Position in screen pixels along the ruler axis */
  screen: number
  /** Value in display units */
  value: number
  kind: TickKind
  label?: string
}

export interface GuideScale {
  scale: TickScale
  /** Major step in world units */
  majorWorld: number
  minorWorld: number
  midWorld: number
}

export function buildGuideScale(
  camera: Camera2D,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  targetMajorPx = 80,
): GuideScale {
  const zoom = camera.getState().zoom
  const scale = computeTickScale(zoom, worldUnit, displayUnit, targetMajorPx)
  return {
    scale,
    majorWorld: displayToWorld(scale.major, worldUnit, displayUnit),
    midWorld: displayToWorld(scale.mid, worldUnit, displayUnit),
    minorWorld: displayToWorld(scale.minor, worldUnit, displayUnit),
  }
}

function nearlyMultiple(value: number, step: number): boolean {
  if (step <= 0) return false
  const r = Math.abs(value / step)
  return Math.abs(r - Math.round(r)) < 1e-6
}

/** Generate ticks for a horizontal or vertical ruler covering the viewport. */
export function generateTicks(
  camera: Camera2D,
  axis: 'x' | 'y',
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  sizePx: number,
): TickMark[] {
  const guide = buildGuideScale(camera, worldUnit, displayUnit)
  const zoom = camera.getState().zoom
  const origin = axis === 'x' ? camera.getState().x : camera.getState().y
  const startWorld = origin
  const endWorld = origin + sizePx / zoom

  const startDisplay = worldToDisplay(startWorld, worldUnit, displayUnit)
  const endDisplay = worldToDisplay(endWorld, worldUnit, displayUnit)
  const minD = Math.min(startDisplay, endDisplay)
  const maxD = Math.max(startDisplay, endDisplay)

  const minor = guide.scale.minor
  // Integer index loop avoids FP drift that drops the last edge tick ("missing line").
  const iStart = Math.floor(minD / minor - 1e-12)
  const iEnd = Math.ceil(maxD / minor + 1e-12)
  const ticks: TickMark[] = []

  for (let i = iStart; i <= iEnd; i++) {
    const v = Number((i * minor).toPrecision(12))
    const world = displayToWorld(v, worldUnit, displayUnit)
    const screen = (world - origin) * zoom
    // Include the far viewport edge (screen === sizePx)
    if (screen < -1 || screen > sizePx + 1) continue

    let kind: TickKind = 'minor'
    if (nearlyMultiple(v, guide.scale.major)) kind = 'major'
    else if (nearlyMultiple(v, guide.scale.mid)) kind = 'mid'

    ticks.push({
      screen,
      value: v,
      kind,
      label: kind === 'major' ? formatTickLabel(v, guide.scale.major) : undefined,
    })
  }
  return ticks
}

/**
 * Grid line positions in world units for [minWorld, maxWorld], inclusive.
 * When `forceEnds` is true, both endpoints are always emitted as major lines
 * (optional page-frame outline — prefer false so page edges stay borderless).
 *
 * @param originWorld Anchor for step multiples. Page/work-area mode should pass
 *   the work-area origin so cells are local to the page, not world 0.
 */
export function generateWorldGridAxes(
  minWorld: number,
  maxWorld: number,
  minorWorld: number,
  majorWorld: number,
  forceEnds = false,
  originWorld = 0,
): Array<{ world: number; major: boolean }> {
  if (!(maxWorld > minWorld) || !(minorWorld > 0)) return []
  const localMin = minWorld - originWorld
  const localMax = maxWorld - originWorld
  const iStart = Math.floor(localMin / minorWorld - 1e-12)
  const iEnd = Math.ceil(localMax / minorWorld + 1e-12)
  const map = new Map<string, { world: number; major: boolean }>()

  const push = (world: number, major: boolean) => {
    const w = Math.min(maxWorld, Math.max(minWorld, world))
    const key = w.toPrecision(12)
    const prev = map.get(key)
    if (prev) {
      prev.major = prev.major || major
      return
    }
    map.set(key, { world: w, major })
  }

  for (let i = iStart; i <= iEnd; i++) {
    const local = i * minorWorld
    const w = originWorld + local
    if (w < minWorld - minorWorld * 1e-9 || w > maxWorld + minorWorld * 1e-9) continue
    // Major/minor relative to the work-area origin, not global world 0.
    push(w, nearlyMultiple(local, majorWorld))
  }
  if (forceEnds) {
    push(minWorld, true)
    push(maxWorld, true)
  }
  return [...map.values()].sort((a, b) => a.world - b.world)
}

/**
 * Tick scale for a finite work area: density from how large the page is on screen,
 * independent of camera pan / full-viewport coverage.
 */
export function buildWorkAreaGuideScale(
  pageExtentWorld: number,
  pageExtentPx: number,
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  targetCells = 8,
): GuideScale {
  const targetMajorPx = Math.min(80, Math.max(28, pageExtentPx / Math.max(1, targetCells)))
  const zoom = pageExtentPx / Math.max(pageExtentWorld, 1e-12)
  const scale = computeTickScale(zoom, worldUnit, displayUnit, targetMajorPx)
  return {
    scale,
    majorWorld: displayToWorld(scale.major, worldUnit, displayUnit),
    midWorld: displayToWorld(scale.mid, worldUnit, displayUnit),
    minorWorld: displayToWorld(scale.minor, worldUnit, displayUnit),
  }
}

export interface GridLine {
  screen: number
  world: number
  major: boolean
}

export function generateGridLines(
  camera: Camera2D,
  axis: 'x' | 'y',
  worldUnit: LengthUnit,
  displayUnit: LengthUnit,
  sizePx: number,
): GridLine[] {
  const ticks = generateTicks(camera, axis, worldUnit, displayUnit, sizePx)
  const origin = axis === 'x' ? camera.getState().x : camera.getState().y
  const zoom = camera.getState().zoom
  return ticks
    .filter((t) => t.kind === 'major' || t.kind === 'mid' || t.kind === 'minor')
    .map((t) => ({
      screen: t.screen,
      world: origin + t.screen / zoom,
      major: t.kind === 'major',
    }))
}

/** World / document coordinates (Float64 authority). */
export type WorldPoint = { readonly x: number; readonly y: number; readonly __space: 'world' }
export type LocalPoint = { readonly x: number; readonly y: number; readonly __space: 'local' }
export type ViewPoint = { readonly x: number; readonly y: number; readonly __space: 'view' }
export type ScreenPoint = { readonly x: number; readonly y: number; readonly __space: 'screen' }
export type DevicePoint = { readonly x: number; readonly y: number; readonly __space: 'device' }

export type Vec2 = { readonly x: number; readonly y: number }

export function worldPoint(x: number, y: number): WorldPoint {
  return { x, y, __space: 'world' }
}

export function localPoint(x: number, y: number): LocalPoint {
  return { x, y, __space: 'local' }
}

export function viewPoint(x: number, y: number): ViewPoint {
  return { x, y, __space: 'view' }
}

export function screenPoint(x: number, y: number): ScreenPoint {
  return { x, y, __space: 'screen' }
}

export function devicePoint(x: number, y: number): DevicePoint {
  return { x, y, __space: 'device' }
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y }
}

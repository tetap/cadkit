/** Parse CSS-ish color strings used by entity styles. */
export function parseColor(input: string): [number, number, number, number] {
  const raw = input.trim().toLowerCase()
  if (!raw || raw === 'none' || raw === 'transparent') return [0, 0, 0, 0]

  if (raw.startsWith('rgba(') || raw.startsWith('rgb(')) {
    const inner = raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')'))
    const parts = inner.split(',').map((p) => p.trim())
    const r = Number(parts[0]) / 255
    const g = Number(parts[1]) / 255
    const b = Number(parts[2]) / 255
    const a = parts[3] != null ? Number(parts[3]) : 1
    if ([r, g, b, a].every((n) => Number.isFinite(n))) {
      return [
        Math.min(1, Math.max(0, r)),
        Math.min(1, Math.max(0, g)),
        Math.min(1, Math.max(0, b)),
        Math.min(1, Math.max(0, a)),
      ]
    }
  }

  const h = raw.startsWith('#') ? raw.slice(1) : raw
  if (h.length === 3 || h.length === 4) {
    const r = parseInt(h[0]! + h[0]!, 16) / 255
    const g = parseInt(h[1]! + h[1]!, 16) / 255
    const b = parseInt(h[2]! + h[2]!, 16) / 255
    const a = h.length === 4 ? parseInt(h[3]! + h[3]!, 16) / 255 : 1
    return [r, g, b, a]
  }
  if (h.length === 6 || h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    if ([r, g, b, a].every((n) => Number.isFinite(n))) return [r, g, b, a]
  }
  return [0.2, 0.8, 0.47, 1]
}

export function isPaintVisible(color: string | undefined): boolean {
  if (!color) return false
  return parseColor(color)[3] > 1e-3
}

import type { FilterOp } from './filters.js'

/** Stable cache key for a filter stack (code + params). */
export function hashFilterStack(filters: readonly FilterOp[]): string {
  return filters
    .map((f) => {
      const params = Object.keys(f.params)
        .sort()
        .map((k) => `${k}:${f.params[k]}`)
        .join(',')
      const body = f.type === 'custom' ? hashString(f.wgslBody ?? '') : ''
      return `${f.type}|${params}|${body}`
    })
    .join('>')
}

function hashString(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

import earcut from 'earcut'

/**
 * Ear-clip a closed ring (optional holes) into triangle vertex indices.
 * `coords` / each hole are flat `[x,y,...]`; duplicate closing vertex is stripped.
 */
export function triangulateRing(
  coords: ArrayLike<number>,
  holes?: readonly ArrayLike<number>[],
): { vertices: number[]; indices: number[] } {
  const outer = uniqueFlatRing(coords)
  if (outer.length < 6) return { vertices: [], indices: [] }

  const vertices: number[] = [...outer]
  const holeIndices: number[] = []
  if (holes?.length) {
    for (const hole of holes) {
      const h = uniqueFlatRing(hole)
      if (h.length < 6) continue
      holeIndices.push(vertices.length / 2)
      for (let i = 0; i < h.length; i++) vertices.push(h[i]!)
    }
  }

  const indices = earcut(
    vertices,
    holeIndices.length ? holeIndices : undefined,
    2,
  )
  return { vertices, indices }
}

/** Conservative triangle count for buffer sizing (earcut ≤ n−2 on a simple ring). */
export function estimateTriangleCount(
  coords: ArrayLike<number>,
  holes?: readonly ArrayLike<number>[],
): number {
  const n = uniqueRingCount(coords)
  if (n < 3) return 0
  let m = n
  if (holes) {
    for (const h of holes) m += uniqueRingCount(h)
  }
  // Generous upper bound; avoids undersized fill buffers.
  return Math.max(0, m * 2)
}

export function uniqueRingCount(coords: ArrayLike<number>): number {
  let n = Math.floor(coords.length / 2)
  if (n >= 2) {
    const dx = coords[0]! - coords[(n - 1) * 2]!
    const dy = coords[1]! - coords[(n - 1) * 2 + 1]!
    if (dx * dx + dy * dy < 1e-12) n -= 1
  }
  return n
}

function uniqueFlatRing(coords: ArrayLike<number>): number[] {
  const n = uniqueRingCount(coords)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(coords[i * 2]!, coords[i * 2 + 1]!)
  }
  return out
}

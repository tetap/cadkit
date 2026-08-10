import type { Entity, EntityId } from '@cadkit/types'
import { IDENTITY, multiply, type Matrix3 } from './matrix.js'

export type EntityLookup = (id: EntityId) => Entity | undefined

/**
 * Resolve local→world matrix by walking parentId chain
 * (child local → … → group.transform → world).
 */
export function resolveWorldMatrix(entity: Entity, lookup: EntityLookup): Matrix3 {
  let m = (entity.transform as unknown as Matrix3) ?? IDENTITY
  let parentId = entity.parentId as EntityId | undefined
  const guard = new Set<string>([entity.id])
  while (parentId) {
    if (guard.has(parentId)) break
    guard.add(parentId)
    const parent = lookup(parentId)
    if (!parent) break
    m = multiply(parent.transform as unknown as Matrix3, m)
    parentId = parent.parentId as EntityId | undefined
  }
  return m
}

/** Left-multiply delta onto an existing affine transform tuple. */
export function multiplyTransform(
  prev: readonly [number, number, number, number, number, number],
  delta: Matrix3,
): readonly [number, number, number, number, number, number] {
  const next = multiply(delta, prev as unknown as Matrix3)
  return [next[0], next[1], next[2], next[3], next[4], next[5]] as const
}

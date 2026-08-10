/** Branded entity identifier (stable across sessions). */
export type EntityId = string & { readonly __brand: 'EntityId' }

/** Document session token for aborting stale async work. */
export type SessionToken = string & { readonly __brand: 'SessionToken' }

/** Layer identifier. */
export type LayerId = string & { readonly __brand: 'LayerId' }

/** Block definition identifier. */
export type BlockId = string & { readonly __brand: 'BlockId' }

/** Group identifier. */
export type GroupId = string & { readonly __brand: 'GroupId' }

let nextId = 1

export function createEntityId(prefix = 'e'): EntityId {
  const id = `${prefix}_${Date.now().toString(36)}_${(nextId++).toString(36)}`
  return id as EntityId
}

export function createSessionToken(): SessionToken {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` as SessionToken
}

export function createLayerId(name = 'layer'): LayerId {
  return createEntityId(name) as unknown as LayerId
}

export function createBlockId(name = 'block'): BlockId {
  return createEntityId(name) as unknown as BlockId
}

export function createGroupId(): GroupId {
  return createEntityId('g') as unknown as GroupId
}

export function asEntityId(value: string): EntityId {
  return value as EntityId
}

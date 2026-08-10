import type { SessionToken } from '@cadkit/types'

/** Frozen cross-thread ABI from benchmark spike. */
export type WorkerChannelMode = 'shared-array-buffer' | 'transferable'

export interface WorkerEnvelope<T = unknown> {
  id: string
  session: SessionToken
  type: string
  payload: T
}

export interface WorkerResponse<T = unknown> {
  id: string
  session: SessionToken
  ok: boolean
  payload?: T
  error?: string
}

export interface TessellateRequest {
  kind: 'arc' | 'cubic'
  data: Float64Array
  pixelError: number
  worldPerPixel: number
}

export interface TessellateResponse {
  points: Float64Array
}

export interface ParseChunkRequest {
  format: 'dxf' | 'svg'
  text: string
  offset: number
}

export interface AbiVersion {
  major: number
  minor: number
  channel: WorkerChannelMode
}

export const WORKER_ABI: AbiVersion = {
  major: 0,
  minor: 1,
  channel: typeof SharedArrayBuffer !== 'undefined' ? 'shared-array-buffer' : 'transferable',
}

export function createEnvelope<T>(
  session: SessionToken,
  type: string,
  payload: T,
): WorkerEnvelope<T> {
  return {
    id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    session,
    type,
    payload,
  }
}

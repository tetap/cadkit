import { describe, expect, it } from 'vitest'
import { WORKER_ABI, createEnvelope } from './protocol.js'
import { createSessionToken } from '@cadkit/types'

describe('worker abi', () => {
  it('has frozen version', () => {
    expect(WORKER_ABI.major).toBe(0)
    expect(WORKER_ABI.minor).toBe(1)
  })

  it('creates envelopes with session', () => {
    const session = createSessionToken()
    const env = createEnvelope(session, 'ping', { n: 1 })
    expect(env.session).toBe(session)
    expect(env.type).toBe('ping')
  })
})

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createSessionToken } from '@cadkit/types'

describe('WorkerPool', () => {
  beforeEach(() => {
    class FakeWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null
      onerror: ((ev: ErrorEvent) => void) | null = null
      postMessage(data: { id: string; session: string }) {
        queueMicrotask(() => {
          this.onmessage?.({
            data: { id: data.id, session: data.session, ok: true, payload: { echo: 1 } },
          } as MessageEvent)
        })
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips requests and rejects after dispose', async () => {
    const { WorkerPool } = await import('./pool.js')
    const pool = new WorkerPool('fake://worker', 2)
    const session = createSessionToken()
    const res = await pool.request(session, 'ping', {})
    expect(res.ok).toBe(true)
    pool.dispose()
    await expect(pool.request(session, 'ping', {})).rejects.toThrow(/disposed/)
  })

  it('invalidates session pending work', async () => {
    class SlowWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null
      onerror: ((ev: ErrorEvent) => void) | null = null
      postMessage() {
        /* never responds */
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', SlowWorker)
    const { WorkerPool } = await import('./pool.js')
    const pool = new WorkerPool('fake://worker', 1)
    const session = createSessionToken()
    const p = pool.request(session, 'slow', {})
    pool.invalidateSession(session)
    await expect(p).rejects.toThrow(/invalidated/)
    pool.dispose()
  })
})

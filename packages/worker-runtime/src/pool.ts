import type { SessionToken } from '@cadkit/types'
import { WORKER_ABI, createEnvelope, type WorkerEnvelope, type WorkerResponse } from './protocol.js'

export class WorkerPool {
  private workers: Worker[] = []
  private rr = 0
  private pending = new Map<
    string,
    { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void; session: SessionToken }
  >()

  constructor(
    private readonly scriptUrl: string | URL,
    size = 2,
  ) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(scriptUrl, { type: 'module' })
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data)
      worker.onerror = (err) => {
        for (const [id, p] of this.pending) {
          p.reject(new Error(err.message))
          this.pending.delete(id)
        }
      }
      this.workers.push(worker)
    }
  }

  get abi() {
    return WORKER_ABI
  }

  request<T, R>(session: SessionToken, type: string, payload: T, transfer: Transferable[] = []): Promise<WorkerResponse<R>> {
    if (this.workers.length === 0) {
      return Promise.reject(new Error('WorkerPool disposed'))
    }
    const envelope = createEnvelope(session, type, payload)
    return new Promise((resolve, reject) => {
      this.pending.set(envelope.id, { resolve: resolve as (v: WorkerResponse) => void, reject, session })
      const worker = this.workers[this.rr++ % this.workers.length]!
      worker.postMessage(envelope, transfer)
    })
  }

  /** Drop pending responses from old sessions. */
  invalidateSession(session: SessionToken): void {
    for (const [id, p] of this.pending) {
      if (p.session === session) {
        p.reject(new Error('Session invalidated'))
        this.pending.delete(id)
      }
    }
  }

  dispose(): void {
    for (const w of this.workers) w.terminate()
    this.workers = []
    for (const [, p] of this.pending) p.reject(new Error('WorkerPool disposed'))
    this.pending.clear()
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (p.session !== msg.session) {
      p.reject(new Error('Stale session response'))
      return
    }
    p.resolve(msg)
  }
}

/** Inline worker factory for tessellation without separate file in tests. */
export function createInlineTessellateWorker(): Worker {
  const source = `
    self.onmessage = (ev) => {
      const msg = ev.data;
      const payload = msg.payload || {};
      const points = payload.data ? new Float64Array(payload.data) : new Float64Array();
      self.postMessage({ id: msg.id, session: msg.session, ok: true, payload: { points } }, [points.buffer]);
    };
  `
  const blob = new Blob([source], { type: 'application/javascript' })
  return new Worker(URL.createObjectURL(blob), { type: 'module' })
}

export type { WorkerEnvelope, WorkerResponse }

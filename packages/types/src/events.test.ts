import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from './events.js'

describe('createEventBus', () => {
  it('on/off/emit and disposer', () => {
    const bus = createEventBus()
    const fn = vi.fn()
    const dispose = bus.on('error', fn)
    bus.emit('error', { message: 'a' })
    expect(fn).toHaveBeenCalledWith({ message: 'a' })
    dispose()
    bus.emit('error', { message: 'b' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('once fires once', () => {
    const bus = createEventBus()
    const fn = vi.fn()
    bus.once('metrics', fn)
    bus.emit('metrics', { frameMs: 1, drawCalls: 1, visibleCount: 1, uploadBytes: 0, memoryMB: 0 })
    bus.emit('metrics', { frameMs: 2, drawCalls: 1, visibleCount: 1, uploadBytes: 0, memoryMB: 0 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('emit snapshots handlers', () => {
    const bus = createEventBus()
    const order: number[] = []
    const d = bus.on('error', () => {
      order.push(1)
      d()
    })
    bus.on('error', () => order.push(2))
    bus.emit('error', { message: 'x' })
    expect(order).toEqual([1, 2])
  })
})

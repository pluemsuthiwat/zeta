import os from 'node:os'
import { describe, it, expect, vi } from 'vitest'
import { currentAddress, listInterfaces, resolveSource, watchInterfaces } from '../src/main/netInterfaces.js'

describe('netInterfaces', () => {
  it('lists IPv4 interfaces with a label and address', async () => {
    const list = await listInterfaces()
    for (const i of list) {
      expect(i.address).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
      expect(i.label).toContain(i.name === i.label ? i.name : `(${i.name})`)
    }
  })
  it('Auto binds nothing; a missing interface is a clear error', async () => {
    expect(await resolveSource(null)).toEqual({ localAddress: undefined, label: null })
    await expect(resolveSource('zz-not-here')).rejects.toThrow(/has no IPv4 address \(disconnected\?\)/)
  })
  it('reads the address an interface has right now', async () => {
    expect(currentAddress('zz-not-here')).toBeNull()
    for (const i of await listInterfaces()) expect(currentAddress(i.name)).toBe(i.address)
  })
  it('reports address changes, not the first look or unchanged polls', async () => {
    let addr = '172.31.254.248'
    const spy = vi
      .spyOn(os, 'networkInterfaces')
      .mockImplementation(() => (addr ? { zz0: [{ family: 'IPv4', internal: false, address: addr, netmask: '255.255.255.0' }] } : {}))
    const seen = []
    const stop = watchInterfaces((list) => seen.push(list.map((i) => i.address)), 20)
    const wait = () => new Promise((r) => setTimeout(r, 70))
    await wait()
    expect(seen).toEqual([]) // first snapshot and repeats are silent
    addr = '172.18.2.168' // Wi-Fi joined another network
    await wait()
    addr = null // dropped
    await wait()
    stop()
    spy.mockRestore()
    expect(seen).toEqual([['172.18.2.168'], []])
  })
})

import { describe, it, expect } from 'vitest'
import { listInterfaces, resolveSource } from '../src/main/netInterfaces.js'

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
})

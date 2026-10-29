import { describe, it, expect } from 'vitest'
import { isIpv4, isValidNetmask, netmaskPrefix, staticSetErrors } from '../src/main/lib/ipv4.js'
import { normalizeMac, formatMac } from '../src/main/lib/macAddress.js'

describe('isIpv4', () => {
  it('accepts strict dotted quads', () => {
    for (const ip of ['0.0.0.0', '10.0.0.1', '192.168.1.50', '255.255.255.255']) expect(isIpv4(ip)).toBe(true)
  })
  it('rejects leading zeros, wrong part counts and out-of-range octets', () => {
    for (const ip of ['010.0.0.1', '10.0.0.01', '10.0.0', '10.0.0.1.1', '256.1.1.1', '1.1.1.-1', ' ', '1..1.1', 'a.b.c.d', '1.1.1.1/24'])
      expect(isIpv4(ip)).toBe(false)
  })
})

describe('netmask', () => {
  it('accepts contiguous /8 to /30', () => {
    expect(netmaskPrefix('255.255.255.0')).toBe(24)
    expect(isValidNetmask('255.0.0.0')).toBe(true)
    expect(isValidNetmask('255.255.255.252')).toBe(true)
  })
  it('rejects non-contiguous and out-of-range masks', () => {
    expect(isValidNetmask('255.0.255.0')).toBe(false)
    expect(isValidNetmask('255.255.255.254')).toBe(false) // /31
    expect(isValidNetmask('254.0.0.0')).toBe(false) // /7
    expect(isValidNetmask('0.0.0.0')).toBe(false)
  })
})

describe('staticSetErrors', () => {
  const base = { ip: '192.168.1.50', netmask: '255.255.255.0', gateway: '192.168.1.1' }
  it('passes a sane set', () => expect(staticSetErrors(base)).toEqual([]))
  it('rejects network and broadcast IPs', () => {
    expect(staticSetErrors({ ...base, ip: '192.168.1.0' })[0]).toMatch(/network address/)
    expect(staticSetErrors({ ...base, ip: '192.168.1.255' })[0]).toMatch(/broadcast/)
  })
  it('rejects a gateway outside the subnet, equal to the IP, or on network/broadcast', () => {
    expect(staticSetErrors({ ...base, gateway: '192.168.2.1' })[0]).toMatch(/not in the same subnet/)
    expect(staticSetErrors({ ...base, gateway: base.ip })[0]).toMatch(/same as the IP/)
    expect(staticSetErrors({ ...base, gateway: '192.168.1.255' })[0]).toMatch(/network or broadcast/)
  })
})

describe('MAC', () => {
  it('normalizes every separator style', () => {
    for (const m of ['AA:BB:CC:DD:EE:FF', 'aa-bb-cc-dd-ee-ff', 'aabb.ccdd.eeff', 'AABBCCDDEEFF'])
      expect(normalizeMac(m)).toBe('aabbccddeeff')
    expect(formatMac('aabbccddeeff')).toBe('aa:bb:cc:dd:ee:ff')
  })
  it('rejects short or non-hex values', () => {
    expect(normalizeMac('aa:bb:cc:dd:ee')).toBeNull()
    expect(normalizeMac('gg:bb:cc:dd:ee:ff')).toBeNull()
  })
})

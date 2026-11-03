import { describe, it, expect } from 'vitest'
import { filterAps, statusBucket } from '../src/renderer/src/apFilter.js'

const ap = (serial, mac, extra = {}) => ({ serial, mac, name: `ap-${serial}`, ip: '10.0.0.1', group: 'default', status: 'up', ...extra })
const aps = [
  ap('1G3T', 'aa:bb:cc:00:00:01'),
  ap('DHFY1GSD3T', '00:13:00:00:00:02', { status: 'down' }),
  ap('AAEQWE1G3T', 'aa:bb:cc:00:00:03', { status: 'rebooting', group: 'TEST' })
]
const serials = (opts) => filterAps(aps, opts).map((a) => a.serial)

describe('filterAps', () => {
  it('does not match a MAC when the query is not MAC-like', () => {
    expect(serials({ query: '1g3t' })).toEqual(['1G3T', 'AAEQWE1G3T'])
  })
  it('exact mode needs a whole serial, case-insensitive', () => {
    expect(serials({ query: '1g3t', exact: true })).toEqual(['1G3T'])
    expect(serials({ query: ' 1G3T ', exact: true })).toEqual(['1G3T'])
  })
  it('matches MACs in any separator style', () => {
    expect(serials({ query: '00-13' })).toEqual(['DHFY1GSD3T'])
    expect(serials({ query: 'aabb.cc00.0003', exact: true })).toEqual(['AAEQWE1G3T'])
    expect(serials({ query: 'aa:bb', exact: true })).toEqual([])
  })
  it('filters by status bucket and group together', () => {
    expect(serials({ status: 'up' })).toEqual(['1G3T'])
    expect(serials({ status: 'down' })).toEqual(['DHFY1GSD3T'])
    expect(serials({ status: 'other' })).toEqual(['AAEQWE1G3T'])
    expect(serials({ status: 'up', group: 'TEST' })).toEqual([])
    expect(statusBucket({ status: 'upgrading' })).toBe('other')
  })
})

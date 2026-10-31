import { describe, it, expect } from 'vitest'
import { checkForUpdate, compareVersions, parseVersion, pickAsset } from '../src/main/lib/updateCheck.js'

const assets = [
  { name: 'Zeta-1.1.1-mac-arm64.dmg', browser_download_url: 'https://dl/arm64.dmg' },
  { name: 'Zeta-1.1.1-mac-arm64.dmg.blockmap', browser_download_url: 'https://dl/arm64.blockmap' },
  { name: 'Zeta-1.1.1-mac-x64.dmg', browser_download_url: 'https://dl/x64.dmg' },
  { name: 'Zeta-1.1.1-win-x64-setup.exe', browser_download_url: 'https://dl/setup.exe' }
]

function fakeFetch(status, body) {
  return async () => ({ status, ok: status >= 200 && status < 300, statusText: '', json: async () => body })
}

describe('versions', () => {
  it('parses tags with or without v', () => {
    expect(parseVersion('v1.10.2')).toEqual({ nums: [1, 10, 2], pre: null })
    expect(parseVersion('1.1.0-beta.2')).toEqual({ nums: [1, 1, 0], pre: 'beta.2' })
    expect(parseVersion('latest')).toBeNull()
  })

  it('compares numerically, release after its pre-releases', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
    expect(compareVersions('1.1.0-beta.1', '1.1.0')).toBeLessThan(0)
    expect(compareVersions('1.1.0-beta.10', '1.1.0-beta.2')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })
})

describe('pickAsset', () => {
  it('picks the installer for this computer', () => {
    expect(pickAsset(assets, 'darwin', 'arm64').browser_download_url).toBe('https://dl/arm64.dmg')
    expect(pickAsset(assets, 'darwin', 'x64').browser_download_url).toBe('https://dl/x64.dmg')
    expect(pickAsset(assets, 'win32', 'x64').browser_download_url).toBe('https://dl/setup.exe')
  })

  it('returns null when the release has none for this computer', () => {
    expect(pickAsset(assets, 'win32', 'arm64')).toBeNull()
    expect(pickAsset(assets, 'linux', 'x64')).toBeNull()
  })
})

describe('checkForUpdate', () => {
  const release = { tag_name: 'v1.1.1', html_url: 'https://gh/release', published_at: '2026-11-01T00:00:00Z', assets }

  it('reports a newer release with this computer’s installer', async () => {
    const r = await checkForUpdate({ current: '1.1.0', platform: 'darwin', arch: 'arm64', fetch: fakeFetch(200, release) })
    expect(r).toMatchObject({ available: true, latest: '1.1.1', downloadUrl: 'https://dl/arm64.dmg', releaseUrl: 'https://gh/release' })
  })

  it('nothing to do when already on the newest (or a newer dev) version', async () => {
    for (const current of ['1.1.1', '1.2.0']) {
      const r = await checkForUpdate({ current, platform: 'darwin', arch: 'arm64', fetch: fakeFetch(200, release) })
      expect(r.available).toBe(false)
    }
  })

  it('no published release yet is not an error', async () => {
    const r = await checkForUpdate({ current: '1.1.0', platform: 'darwin', arch: 'arm64', fetch: fakeFetch(404, {}) })
    expect(r).toEqual({ current: '1.1.0', latest: null, available: false })
  })

  it('fails on other HTTP errors and odd tags', async () => {
    await expect(checkForUpdate({ current: '1.1.0', platform: 'darwin', arch: 'arm64', fetch: fakeFetch(403, {}) })).rejects.toThrow('403')
    await expect(
      checkForUpdate({ current: '1.1.0', platform: 'darwin', arch: 'arm64', fetch: fakeFetch(200, { ...release, tag_name: 'nightly' }) })
    ).rejects.toThrow('unexpected tag')
  })
})

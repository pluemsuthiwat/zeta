// Is there a newer Zeta on GitHub? Reads the newest published release: drafts and pre-releases
// never show up in /releases/latest, so a release only reaches users once it is published.
export const RELEASES_API = 'https://api.github.com/repos/pluemsuthiwat/zeta/releases/latest'

/** 'v1.2.3' or '1.2.3-beta.1' → { nums: [1, 2, 3], pre: 'beta.1' | null }, or null if it isn't a version. */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v ?? '').trim())
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || null } : null
}

/** < 0 when a is older than b. A pre-release is older than its release (1.1.0-beta < 1.1.0). */
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) throw new Error(`Not a version: ${!x ? a : b}`)
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i]
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre.localeCompare(y.pre, 'en', { numeric: true })
}

/** The installer for this computer, named like electron-builder.yml's artifactName. */
export function pickAsset(assets, platform, arch) {
  const suffix = platform === 'darwin' ? `-mac-${arch}.dmg` : platform === 'win32' ? `-win-${arch}-setup.exe` : null
  if (!suffix) return null
  return (assets || []).find((a) => a.name?.toLowerCase().endsWith(suffix)) || null
}

/**
 * { current, latest, available, releaseUrl, downloadUrl, publishedAt }.
 * downloadUrl is null when the release has no installer for this computer (open releaseUrl instead).
 */
export async function checkForUpdate({ current, platform, arch, fetch, url = RELEASES_API, timeoutMs = 10_000 }) {
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Zeta/${current}` },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (res.status === 404) return { current, latest: null, available: false } // nothing published yet
  if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`.trim())
  const release = await res.json()
  const latest = String(release.tag_name || '').replace(/^v/, '')
  if (!parseVersion(latest)) throw new Error(`The newest release has an unexpected tag: ${release.tag_name}`)
  return {
    current,
    latest,
    available: compareVersions(latest, current) > 0,
    releaseUrl: release.html_url,
    downloadUrl: pickAsset(release.assets, platform, arch)?.browser_download_url || null,
    publishedAt: release.published_at || null
  }
}

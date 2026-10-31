// Build plugin: writes third-party-licenses.json next to each bundle, listing every npm package that
// ships inside Zeta with its license text. MIT/BSD/ISC require that text to travel with the app.
// - the renderer and preload bundle their packages: they are read from the bundle's module ids
// - main keeps `dependencies` external, so electron-builder copies them (and what they depend on)
//   into the app: they are read from package-lock.json
// Electron's and Chromium's own licenses are added to the app by electron-builder.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i

function packageDir(id) {
  const path = id.split('?')[0].replaceAll('\\', '/')
  const i = path.lastIndexOf('/node_modules/')
  if (i < 0) return null
  const parts = path.slice(i + '/node_modules/'.length).split('/')
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  return path.slice(0, i) + '/node_modules/' + name
}

function readPackage(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort()
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || pkg.licenses?.map((l) => l.type).join(' OR ')
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
  const text = files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n')
  return {
    name: pkg.name,
    version: pkg.version,
    license: license || 'UNKNOWN',
    repository: repo || null,
    // some packages declare a license but ship no license file
    text: text || `No license file in this package.\nDeclared license: ${license || 'none'}${author ? `\nAuthor: ${author}` : ''}`
  }
}

function lockfileProductionDirs(root) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  return Object.entries(lock.packages)
    .filter(([path, p]) => path && !p.dev && !p.link)
    .map(([path]) => join(root, path))
    .filter((dir) => existsSync(join(dir, 'package.json')))
}

/** includeProduction: also list package.json `dependencies` (and theirs), for the main build. */
export default function thirdPartyLicenses({ includeProduction = false } = {}) {
  return {
    name: 'zeta-third-party-licenses',
    apply: 'build',
    generateBundle() {
      const dirs = new Set()
      for (const id of this.getModuleIds()) {
        if (id.startsWith('\0')) continue
        const dir = packageDir(id)
        if (dir) dirs.add(dir)
      }
      if (includeProduction) for (const dir of lockfileProductionDirs(process.cwd())) dirs.add(dir.replaceAll('\\', '/'))

      const byKey = new Map()
      for (const dir of dirs) {
        const p = readPackage(dir)
        byKey.set(`${p.name}@${p.version}`, p)
      }
      const list = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
      this.emitFile({ type: 'asset', fileName: 'third-party-licenses.json', source: JSON.stringify(list) })
    }
  }
}

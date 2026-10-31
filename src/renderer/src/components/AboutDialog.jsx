import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../api.js'
import logo from '../assets/logo.svg'
import zetaLicense from '../../../../LICENSE?raw'
import { Modal, Button, SearchInput, Skeleton, Alert, cx } from './ui.jsx'

const REPO_URL = 'https://github.com/pluemsuthiwat/zeta'

function LicenseText({ children }) {
  return (
    <pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-elev2 p-3 text-[11.5px] leading-relaxed text-muted">
      {children}
    </pre>
  )
}

/** Version, Zeta's own license, and the license of every package that ships inside the app. */
export default function AboutDialog({ open, onClose }) {
  const [about, setAbout] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(null) // 'zeta' or name@version
  const toggle = (key) => setExpanded((k) => (k === key ? null : key))
  const [update, setUpdate] = useState({ state: 'idle' }) // idle | checking | done | error

  async function checkUpdate() {
    setUpdate({ state: 'checking' })
    try {
      setUpdate({ state: 'done', ...(await api.app.checkUpdate(true)) })
    } catch (err) {
      setUpdate({ state: 'error', error: err.message })
    }
  }

  useEffect(() => {
    if (!open || about) return
    api.app.about().then(setAbout, (err) => setError(err.message))
  }, [open, about])

  const packages = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = about?.packages || []
    return q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.license.toLowerCase().includes(q)) : all
  }, [about, query])

  return (
    <Modal open={open} onClose={onClose} title="About Zeta" width="max-w-2xl" fullHeight footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex items-center gap-4">
        <img src={logo} alt="" className="size-14 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-fg">Zeta</span>
            <span className="mono text-[13px] text-subtle">v{__APP_VERSION__}</span>
          </div>
          <p className="text-[13px] text-subtle">Bulk-provision Aruba access points from Excel</p>
          <p className="mt-1 text-[13px] text-muted">Copyright © 2026 Suthiwat Srisen · Released under the MIT License</p>
        </div>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-accent transition-colors hover:bg-hover"
        >
          GitHub <ExternalLink className="size-3.5" />
        </a>
      </div>

      {about && (
        <p className="mono mt-3 text-[11.5px] text-subtle">
          Electron {about.versions.electron} · Chromium {about.versions.chrome} · Node {about.versions.node}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" icon={RefreshCw} busy={update.state === 'checking'} onClick={checkUpdate}>
          Check for updates
        </Button>
        {update.state === 'done' && !update.available && <span className="text-[13px] text-ok">Zeta is up to date.</span>}
        {update.state === 'done' && update.available && (
          <span className="text-[13px] text-fg">
            Zeta {update.latest} is available.{' '}
            <a href={update.downloadUrl || update.releaseUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
              Download
            </a>
            {' · '}
            <a href={update.releaseUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              What's new
            </a>
          </span>
        )}
        {update.state === 'error' && <span className="text-[13px] text-bad">Couldn't check: {update.error}</span>}
      </div>

      <div className="mt-4">
        <button onClick={() => toggle('zeta')} className="flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-fg">
          <ChevronRight className={cx('size-4 transition-transform', expanded === 'zeta' && 'rotate-90')} />
          Zeta license (MIT)
        </button>
        {expanded === 'zeta' && <LicenseText>{zetaLicense.trim()}</LicenseText>}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-fg">
              Open-source software
              {about && <span className="ml-1.5 font-normal tabular-nums text-subtle">{about.packages.length}</span>}
            </h3>
            <p className="mt-0.5 text-xs text-subtle">
              Packages included in Zeta. Electron's and Chromium's licenses are in the app folder (LICENSE.electron.txt,
              LICENSES.chromium.html).
            </p>
          </div>
          <SearchInput value={query} onChange={setQuery} placeholder="Search packages" className="w-52 shrink-0" />
        </div>

        <div className="mt-3">
          {error && <Alert tone="red">{error}</Alert>}
          {!about && !error && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-7" />
              ))}
            </div>
          )}
          {about && about.packages.length === 0 && (
            <p className="text-[13px] text-subtle">The list is created when Zeta is built (not in dev mode).</p>
          )}
          {about && about.packages.length > 0 && packages.length === 0 && <p className="text-[13px] text-subtle">No packages match.</p>}
          <ul>
            {packages.map((p) => {
              const key = `${p.name}@${p.version}`
              return (
                <li key={key} className="border-t border-line first:border-t-0">
                  <button
                    onClick={() => toggle(key)}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[13px] transition-colors hover:bg-hover"
                  >
                    <ChevronRight className={cx('size-3.5 shrink-0 text-subtle transition-transform', expanded === key && 'rotate-90')} />
                    <span className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
                    <span className="mono shrink-0 text-[11.5px] text-subtle">{p.version}</span>
                    <span className="mono w-36 shrink-0 truncate text-right text-[11.5px] text-muted">{p.license}</span>
                  </button>
                  {expanded === key && <LicenseText>{p.text}</LicenseText>}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </Modal>
  )
}

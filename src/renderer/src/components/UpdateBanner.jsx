import { useEffect, useState } from 'react'
import { ArrowDownToLine, X } from 'lucide-react'
import { api } from '../api.js'

const SKIP_KEY = 'zeta-skipped-update'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000 // the app may stay open (or in the tray) for days
const FIRST_CHECK_MS = 3000 // let the first screen load before going online

function skippedVersion() {
  try {
    return localStorage.getItem(SKIP_KEY)
  } catch {
    return null
  }
}

/** Bar under the header when GitHub has a newer release. Quiet when offline or GitHub fails. */
export default function UpdateBanner() {
  const [update, setUpdate] = useState(null)
  const [laterFor, setLaterFor] = useState(null) // "Later" hides this version until the next start

  useEffect(() => {
    const check = () =>
      api.app.checkUpdate().then(setUpdate, () => {}) // no internet is normal on a provisioning network
    const first = setTimeout(check, FIRST_CHECK_MS)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])

  if (!update?.available || laterFor === update.latest || skippedVersion() === update.latest) return null

  const skip = () => {
    try {
      localStorage.setItem(SKIP_KEY, update.latest)
    } catch {
      /* falls back to "Later" */
    }
    setLaterFor(update.latest)
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-accent/25 bg-accent/10 px-4 py-2 text-[13px]">
      <ArrowDownToLine className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate text-fg">
        <span className="font-medium">Zeta {update.latest} is available.</span>{' '}
        <span className="text-muted">You have {update.current}.</span>
      </span>
      <a href={update.releaseUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-fg">
        What's new
      </a>
      <button onClick={skip} className="shrink-0 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-fg">
        Skip this version
      </button>
      <a
        href={update.downloadUrl || update.releaseUrl}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-lg bg-accent px-3 py-1 font-medium text-white transition-colors hover:bg-accent-2"
      >
        Download
      </a>
      <button onClick={() => setLaterFor(update.latest)} className="shrink-0 rounded-md p-1 text-subtle hover:bg-hover hover:text-fg" aria-label="Later" title="Later">
        <X className="size-4" />
      </button>
    </div>
  )
}

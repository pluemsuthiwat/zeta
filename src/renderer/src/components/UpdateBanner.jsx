import { ArrowDownToLine, X } from 'lucide-react'

/** Bar under the header when GitHub has a newer release (state from useUpdateCheck). */
export default function UpdateBanner({ update, onLater, onSkip }) {
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
      <button onClick={onSkip} className="shrink-0 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-fg">
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
      <button onClick={onLater} className="shrink-0 rounded-md p-1 text-subtle hover:bg-hover hover:text-fg" aria-label="Later" title="Later">
        <X className="size-4" />
      </button>
    </div>
  )
}

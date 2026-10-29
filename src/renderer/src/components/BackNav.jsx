import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'

const isMac = window.zeta.platform === 'darwin'

/**
 * Back button + breadcrumb ("← Controllers / HQ Mobility Controller").
 * Also goes back on ⌘[ (macOS) / Alt+← (Windows) and the mouse's back button,
 * unless `enabled` is false (e.g. while a modal is open).
 */
export default function BackNav({ to = '/', label = 'Controllers', current, enabled = true }) {
  const navigate = useNavigate()

  useEffect(() => {
    if (!enabled) return
    const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
    const onKey = (e) => {
      const hit = isMac ? e.metaKey && e.key === '[' : e.altKey && e.key === 'ArrowLeft'
      if (hit && !typing(document.activeElement)) {
        e.preventDefault()
        navigate(to)
      }
    }
    const onMouse = (e) => {
      if (e.button === 3) {
        e.preventDefault()
        navigate(to)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [enabled, navigate, to])

  return (
    <nav className="flex min-w-0 items-center gap-2 text-[13px]" aria-label="Breadcrumb">
      <Link
        to={to}
        title={`Back to ${label}`}
        className="group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-elev2/60 pl-2 pr-3 font-medium text-muted transition-[background-color,border-color,color] duration-200 ease-out hover:border-line-strong hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <ArrowLeft className="size-4 transition-transform duration-200 ease-out group-hover:-translate-x-[3px]" />
        {label}
      </Link>
      {current && (
        <>
          <ChevronRight className="size-3.5 shrink-0 text-subtle" />
          <span className="truncate text-subtle" aria-current="page">
            {current}
          </span>
        </>
      )}
    </nav>
  )
}

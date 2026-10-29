import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from './ui.jsx'

/**
 * Themed single-select (replaces the native <select>, whose OS popup ignores the app theme).
 * options: [{ value, label, count? }]. Keyboard: ↑/↓ move, Enter picks, Esc closes.
 */
export default function Dropdown({ options, value, onChange, prefix, className, menuClassName, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef(null)
  const listRef = useRef(null)
  const id = useId()
  const current = options.find((o) => o.value === value) || options[0]

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // keep the highlighted option in view
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (o) => {
    onChange(o.value)
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(options[active])
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className={cx('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cx(
          'flex h-9 w-full items-center gap-2 rounded-lg border bg-elev2 px-3 text-left text-sm transition-colors duration-150',
          open ? 'border-accent/70 ring-3 ring-accent/20' : 'border-line-strong hover:border-subtle/50'
        )}
      >
        {prefix && <span className="shrink-0 text-subtle">{prefix}</span>}
        <span className="min-w-0 flex-1 truncate text-fg">{current?.label}</span>
        {current?.count !== undefined && <span className="mono shrink-0 text-[11.5px] text-subtle">{current.count}</span>}
        <ChevronDown className={cx('size-4 shrink-0 text-subtle transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <ul
          id={id}
          ref={listRef}
          role="listbox"
          className={cx(
            'absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-72 overflow-auto rounded-xl border border-line-strong bg-elev p-1 shadow-2xl shadow-black/40',
            'origin-top animate-[dropdown-in_120ms_ease-out]',
            menuClassName
          )}
        >
          {options.map((o, i) => {
            const selected = o.value === value
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()} // keep focus on the button
                onClick={() => pick(o)}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                  i === active ? 'bg-hover text-fg' : 'text-muted',
                  selected && 'text-fg'
                )}
              >
                <Check className={cx('size-3.5 shrink-0 text-accent', !selected && 'invisible')} />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count !== undefined && (
                  <span
                    className={cx(
                      'mono shrink-0 rounded-md px-1.5 py-px text-[11px] tabular-nums',
                      selected ? 'bg-accent/15 text-accent' : 'bg-elev2 text-subtle'
                    )}
                  >
                    {o.count}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

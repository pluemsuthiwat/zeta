import { useEffect } from 'react'
import { X, Loader2, RefreshCw } from 'lucide-react'

export function cx(...c) {
  return c.filter(Boolean).join(' ')
}

const BUTTON = {
  primary:
    'brand-gradient text-white hover:brightness-110 active:brightness-95 disabled:opacity-45 disabled:hover:brightness-100',
  secondary: 'bg-elev2 text-fg ring-1 ring-inset ring-line-strong hover:bg-hover hover:ring-subtle/40 disabled:text-subtle',
  ghost: 'text-muted hover:bg-hover hover:text-fg disabled:text-subtle/60',
  danger: 'bg-bad text-white hover:brightness-110 disabled:opacity-50',
  dangerGhost: 'text-bad/90 hover:bg-bad/10 hover:text-bad'
}

export function Button({ variant = 'secondary', size = 'md', busy, icon: Icon, className, children, ...props }) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        BUTTON[variant],
        className
      )}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  )
}

const BADGE = {
  green: 'bg-ok/12 text-ok ring-ok/25',
  orange: 'bg-orange/12 text-orange ring-orange/25',
  red: 'bg-bad/12 text-bad ring-bad/25',
  yellow: 'bg-warn/12 text-warn ring-warn/25',
  blue: 'bg-info/12 text-info ring-info/25',
  gray: 'bg-hover text-muted ring-line-strong'
}

export function Badge({ color = 'gray', dot, pulse, children, className }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        BADGE[color],
        className
      )}
    >
      {dot && (
        <span className="relative inline-flex size-1.5">
          {pulse && <span className="animate-ping-soft absolute inset-0 rounded-full bg-current" />}
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  )
}

const CONTROLLER_STATUS = {
  online: ['green', 'Online'],
  offline: ['orange', 'Offline'],
  error: ['red', 'Error'],
  unknown: ['gray', 'Unknown']
}
export function ControllerStatusBadge({ status }) {
  const [color, label] = CONTROLLER_STATUS[status] || CONTROLLER_STATUS.unknown
  return (
    <Badge color={color} dot pulse={status === 'online'}>
      {label}
    </Badge>
  )
}

export function Card({ className, children, ...props }) {
  return (
    <div className={cx('rounded-2xl border border-line bg-elev shadow-card', className)} {...props}>
      {children}
    </div>
  )
}

const ICON_TONE = {
  accent: 'text-accent bg-accent/12',
  ok: 'text-ok bg-ok/12',
  bad: 'text-bad bg-bad/12',
  warn: 'text-warn bg-warn/12',
  info: 'text-info bg-info/12',
  muted: 'text-muted bg-hover'
}

export function StatBox({ label, value, tone, hint, icon: Icon, iconTone = 'muted', active, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'group rounded-2xl border bg-elev px-4 py-3.5 text-left shadow-card transition-colors',
        onClick && 'hover:border-line-strong',
        active ? 'border-accent/60 ring-1 ring-accent/40' : 'border-line'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{label}</div>
        {Icon && (
          <span className={cx('grid size-7 place-items-center rounded-lg', ICON_TONE[iconTone])}>
            <Icon className="size-3.5" />
          </span>
        )}
      </div>
      <div className={cx('mt-1.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums', tone || 'text-fg')}>{value}</div>
      {hint && <div className="mt-1.5 text-xs text-subtle">{hint}</div>}
    </Tag>
  )
}

/** fullHeight: always as tall as the window allows, so switching to a short list doesn't shrink it. */
export function Modal({ open, onClose, title, subtitle, width = 'max-w-lg', children, footer, dismissable = true, fullHeight = false }) {
  useEffect(() => {
    if (!open || !dismissable) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, dismissable])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 pt-16 backdrop-blur-[3px]">
      <div
        className={cx(
          'flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-elev shadow-2xl shadow-black/40',
          fullHeight && 'h-full',
          width
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-subtle">{subtitle}</p>}
          </div>
          {dismissable && (
            <button onClick={onClose} className="rounded-lg p-1 text-subtle transition-colors hover:bg-hover hover:text-fg" aria-label="Close">
              <X className="size-5" />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-elev2/50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted">{message}</div>
    </Modal>
  )
}

export function Field({ label, required, hint, children }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-muted">
        {label}
        {required && <span className="text-accent-2"> *</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-subtle">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line-strong bg-elev2 px-3 text-sm text-fg placeholder:text-subtle transition-colors hover:border-subtle/50 focus:border-accent/70 focus:outline-none focus:ring-3 focus:ring-accent/20'

export function SearchInput({ value, onChange, placeholder, className }) {
  return (
    <div className={cx('relative', className || 'w-72')}>
      <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(inputClass, 'pl-9')}
      />
    </div>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-elev2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg px-3 py-1 text-[13px] font-medium transition-all',
            value === o.value ? 'bg-elev text-fg shadow-sm ring-1 ring-line-strong' : 'text-subtle hover:text-fg'
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={cx('ml-1.5 tabular-nums', value === o.value ? 'text-accent' : 'opacity-70')}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

const ALERT = {
  red: 'border-bad/25 bg-bad/8 text-bad',
  yellow: 'border-warn/25 bg-warn/8 text-warn',
  blue: 'border-info/25 bg-info/8 text-info',
  green: 'border-ok/25 bg-ok/8 text-ok',
  gray: 'border-line bg-hover text-muted'
}

export function Alert({ tone = 'gray', icon: Icon, title, children, action }) {
  return (
    <div className={cx('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', ALERT[tone])}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cx(title && 'mt-0.5', 'text-fg/80')}>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function Pager({ page, pages, onChange, total }) {
  if (pages <= 1) return <div className="text-xs text-subtle">{total} rows</div>
  return (
    <div className="flex items-center gap-2 text-xs text-subtle">
      <span className="tabular-nums">
        Page {page} of {pages} · {total} rows
      </span>
      <Button size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <Button size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </div>
  )
}

export function Skeleton({ className }) {
  return <div className={cx('animate-pulse rounded-lg bg-hover', className)} />
}

export function ProgressBar({ value, max, tone = 'brand-gradient' }) {
  const pct = max ? Math.round((value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
      <div className={cx('h-full rounded-full transition-all duration-500', tone)} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Clickable filter tile used above tables (review + progress). */
export function FilterTile({ label, count, tone, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'rounded-xl border px-3.5 py-2.5 text-left transition-all',
        active ? 'border-accent/60 bg-accent/8 ring-1 ring-accent/30' : 'border-line bg-elev2/40 hover:border-line-strong'
      )}
    >
      <div className="text-xs font-medium text-subtle">{label}</div>
      <div className={cx('mt-0.5 text-xl font-semibold tabular-nums', tone || 'text-fg')}>{count}</div>
    </button>
  )
}

export const tableHead = 'bg-elev2/60 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle'
export const tableRow = 'border-t border-line transition-colors hover:bg-hover'

function SpinningRefresh(props) {
  return <RefreshCw {...props} className={cx(props.className, 'animate-spin')} />
}

/** Refresh button whose icon spins while `refreshing`. */
export function RefreshButton({ refreshing, onClick, size, className }) {
  return (
    <Button size={size} className={className} icon={refreshing ? SpinningRefresh : RefreshCw} disabled={refreshing} onClick={onClick}>
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </Button>
  )
}

/** Thin indeterminate bar along the top edge of a `relative` parent. */
export function TopProgress({ active }) {
  if (!active) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
      <div className="brand-gradient h-full w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite]" />
    </div>
  )
}

/** "· ● Updated 1:15:10 AM" — the dot pulses once on every new timestamp. */
export function UpdatedAt({ at }) {
  if (!at) return null
  return (
    <>
      <span>·</span>
      <span key={at} className="relative inline-flex size-1.5">
        <span className="absolute inset-0 animate-[ping-once_0.9s_ease-out] rounded-full bg-ok" />
        <span className="relative size-1.5 rounded-full bg-ok" />
      </span>
      <span className="tabular-nums">Updated {new Date(at).toLocaleTimeString()}</span>
    </>
  )
}

/** Runs `fn` and resolves no sooner than `ms`, so a fast refresh still shows its feedback. */
export async function atLeast(ms, fn) {
  const [out] = await Promise.all([fn(), new Promise((r) => setTimeout(r, ms))])
  return out
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Network, Check, ChevronDown, RefreshCw, Wifi, Cable } from 'lucide-react'
import { api } from '../api.js'
import { useToast } from './Toast.jsx'
import { cx } from './ui.jsx'

const isWifi = (label) => /wi-?fi|wlan|wireless|airport/i.test(label)

/** Header dropdown: which network interface Zeta uses to reach the controllers. */
export default function SourceInterfacePicker() {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState({ selected: null, interfaces: [] })
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [flash, setFlash] = useState(false)
  const ref = useRef(null)
  const seen = useRef(null) // last data shown, to tell what changed
  const labels = useRef(new Map()) // en0 -> "Wi-Fi (en0)", kept while it is disconnected

  // Tell the user when the selected interface's address changes on its own (Wi-Fi joined
  // another network, DHCP renewed, cable pulled); `choose` reports the user's own changes.
  const apply = useCallback(
    (next) => {
      const prev = seen.current
      seen.current = next
      for (const i of next.interfaces) labels.current.set(i.name, i.label)
      setData(next)
      if (!prev || !next.selected || prev.selected !== next.selected) return
      const before = prev.interfaces.find((i) => i.name === next.selected)
      const after = next.interfaces.find((i) => i.name === next.selected)
      if (before?.address === after?.address) return
      const label = labels.current.get(next.selected) || next.selected
      if (before && after) {
        toast({ tone: 'info', title: `${label} has a new address`, message: `${before.address} → ${after.address}. Connections, including running jobs, continue through it.` })
      } else if (after) {
        toast({ tone: 'success', title: `${label} is connected again`, message: `Controllers are reached through ${after.address}.` })
      } else {
        toast({ tone: 'error', title: `${label} disconnected`, message: 'Connections wait until it has an address again, or pick another interface.' })
      }
      setFlash(true)
    },
    [toast]
  )

  const load = useCallback(async () => {
    try {
      apply(await api.net.list())
    } catch {
      /* keep last list */
    }
  }, [apply])

  // live: main pushes every interface/address change; also re-read when the window comes back
  useEffect(() => {
    load()
    const off = api.net.onChange(apply)
    window.addEventListener('focus', load)
    return () => {
      off()
      window.removeEventListener('focus', load)
    }
  }, [load, apply])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), 1600)
    return () => clearTimeout(t)
  }, [flash])

  // The list comes back in a few ms; keep the spin long enough to be seen as feedback.
  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    await Promise.all([load(), new Promise((r) => setTimeout(r, 700))])
    setRefreshing(false)
  }

  // refresh when opened, close on outside click / Escape
  useEffect(() => {
    if (!open) return
    load()
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, load])

  const current = data.interfaces.find((i) => i.name === data.selected)
  const missing = data.selected && !current
  const missingLabel = missing ? labels.current.get(data.selected) || data.selected : null

  async function choose(name) {
    setBusy(true)
    try {
      await api.net.set(name)
      await load()
      setOpen(false)
      const picked = data.interfaces.find((i) => i.name === name)
      toast({
        tone: 'success',
        title: 'Source interface changed',
        message: picked ? `Controllers are now reached through ${picked.label} · ${picked.address}` : 'Using the system route (Auto).'
      })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not use this interface', message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const Icon = current ? (isWifi(current.label) ? Wifi : Cable) : Network

  return (
    <div ref={ref} className="no-drag relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[13px] transition-colors duration-500',
          missing ? 'border-warn/40 text-warn hover:bg-warn/8' : 'border-line text-muted hover:bg-hover hover:text-fg',
          flash && !missing && 'border-accent/60 bg-accent/10 text-fg'
        )}
        title="Network interface used to reach the controllers"
      >
        <Icon className="size-4" />
        <span className="max-w-[260px] truncate">
          {current ? (
            <>
              {current.label} <span className="mono text-subtle">· {current.address}</span>
            </>
          ) : missing ? (
            `${missingLabel} · disconnected`
          ) : (
            'Auto'
          )}
        </span>
        <ChevronDown className="size-3.5 text-subtle" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[340px] overflow-hidden rounded-xl border border-line-strong bg-elev shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-fg">Source interface</div>
              <div className="text-xs text-subtle">Used for every controller connection</div>
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="rounded-md p-1 text-subtle transition-colors hover:bg-hover hover:text-fg disabled:text-accent"
              title="Refresh list"
              aria-label="Refresh list"
            >
              <RefreshCw className={cx('size-3.5', refreshing && 'animate-spin')} />
            </button>
          </div>
          <div className={cx('max-h-80 overflow-auto p-1.5 transition-opacity duration-200', refreshing && 'opacity-50')}>
            <Option
              active={!data.selected}
              disabled={busy}
              icon={Network}
              title="Auto"
              detail="Let the system pick the route"
              onClick={() => choose(null)}
            />
            {data.interfaces.map((i) => (
              <Option
                key={i.name}
                active={data.selected === i.name}
                disabled={busy}
                icon={isWifi(i.label) ? Wifi : Cable}
                title={i.label}
                detail={`${i.address} / ${i.netmask}`}
                onClick={() => choose(i.name)}
              />
            ))}
            {missing && (
              <div className="mx-2 my-1.5 rounded-lg bg-warn/8 px-2.5 py-2 text-xs text-warn">
                {missingLabel} is selected but has no IPv4 address right now. Connections wait until it is back, or pick another
                one.
              </div>
            )}
          </div>
          <div className="border-t border-line px-3.5 py-2 text-[11.5px] leading-relaxed text-subtle">
            Addresses update live. Changing the interface reconnects through it; a running job keeps its interface until it finishes and
            follows that interface to a new address.
          </div>
        </div>
      )}
    </div>
  )
}

function Option({ active, disabled, icon: Icon, title, detail, onClick }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-accent/10' : 'hover:bg-hover'
      )}
    >
      <span className={cx('grid size-8 shrink-0 place-items-center rounded-lg', active ? 'bg-accent/15 text-accent' : 'bg-elev2 text-subtle')}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-fg">{title}</span>
        <span className="mono block truncate text-[11.5px] text-subtle">{detail}</span>
      </span>
      {active && <Check className="size-4 shrink-0 text-accent" />}
    </button>
  )
}

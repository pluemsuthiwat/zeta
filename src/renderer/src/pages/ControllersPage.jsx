import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Plug, Pencil, Trash2, ArrowRight, Router, WifiOff, Server, CircleCheck, CircleAlert, History } from 'lucide-react'
import { api } from '../api.js'
import { usePolling } from '../hooks/usePolling.js'
import { formatDateTime, modeLabel } from '../format.js'
import ControllerForm from '../components/ControllerForm.jsx'
import { useToast } from '../components/Toast.jsx'
import {
  Button,
  Card,
  ControllerStatusBadge,
  StatBox,
  SearchInput,
  Segmented,
  ConfirmDialog,
  Alert,
  Skeleton,
  RefreshButton,
  TopProgress,
  UpdatedAt,
  atLeast,
  cx
} from '../components/ui.jsx'

export default function ControllersPage() {
  const [controllers, setControllers] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState(null) // { controller } | null
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const toast = useToast()
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    try {
      setControllers(await api.controllers.list())
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const replace = (c) => setControllers((list) => list?.map((x) => (x.id === c.id ? { ...x, ...c } : x)))

  // Re-read the list, then every controller's live AP counts at once (not waiting for each
  // card's own 5-second poll). A controller that can't be reached just shows its error.
  async function refreshAll() {
    if (refreshing) return
    setRefreshing(true)
    try {
      await atLeast(700, async () => {
        const list = await api.controllers.list()
        setControllers(list)
        setLoadError('')
        await Promise.all(list.map((c) => api.controllers.apStats(c.id).then(replace, () => {})))
      })
      setUpdatedAt(Date.now())
    } catch (err) {
      toast({ tone: 'error', title: 'Could not refresh', message: err.message })
    } finally {
      setRefreshing(false)
    }
  }

  const counts = useMemo(() => {
    const list = controllers || []
    const online = list.filter((c) => c.status === 'online').length
    return { all: list.length, online, offline: list.length - online }
  }, [controllers])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (controllers || []).filter((c) => {
      if (filter === 'online' && c.status !== 'online') return false
      if (filter === 'offline' && c.status === 'online') return false
      return !q || c.name.toLowerCase().includes(q) || c.ipAddress.includes(q)
    })
  }, [controllers, query, filter])

  async function confirmDelete() {
    setDeleteBusy(true)
    try {
      await api.controllers.remove(deleting.id)
      setControllers((list) => list.filter((c) => c.id !== deleting.id))
      setDeleting(null)
    } catch (err) {
      toast({ tone: 'error', title: `Could not delete ${deleting.name}`, message: err.message })
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className={cx('relative mx-auto max-w-7xl px-7 py-7', refreshing && 'cursor-progress')} aria-busy={refreshing}>
      <TopProgress active={refreshing} />
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Controllers</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-subtle">
            Provision Aruba access points in bulk from one Excel file.
            <UpdatedAt at={updatedAt} />
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton refreshing={refreshing} onClick={refreshAll} />
          <Button variant="primary" icon={Plus} disabled={refreshing} onClick={() => setForm({ controller: null })}>
            Add Controller
          </Button>
        </div>
      </div>

      {/* Locked while refreshing: inert blocks clicks and keyboard focus until the new data is in. */}
      <div inert={refreshing}>
        <div className="mt-6 grid grid-cols-3 gap-4">
          <StatBox label="Controllers" value={counts.all} icon={Server} iconTone="accent" />
          <StatBox label="Online" value={counts.online} tone="text-ok" icon={CircleCheck} iconTone="ok" />
          <StatBox
            label="Offline"
            value={counts.offline}
            tone={counts.offline ? 'text-orange' : undefined}
            icon={CircleAlert}
            iconTone={counts.offline ? 'warn' : 'muted'}
            hint="Includes Error and Unknown"
          />
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search by name or IP" />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'online', label: 'Online', count: counts.online },
              { value: 'offline', label: 'Offline', count: counts.offline }
            ]}
          />
        </div>

        {loadError && (
          <div className="mt-4">
            <Alert tone="red">{loadError}</Alert>
          </div>
        )}

        <div
          className={cx(
            'mt-4 grid grid-cols-1 gap-4 transition-opacity duration-200 lg:grid-cols-2 2xl:grid-cols-3',
            refreshing && 'opacity-50 select-none'
          )}
        >
          {controllers === null && [0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
          {visible.map((c) => (
            <ControllerCard
              key={c.id}
              controller={c}
              onChange={replace}
              onEdit={() => setForm({ controller: c })}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </div>

        {controllers?.length === 0 && (
          <Card className="relative mt-4 overflow-hidden px-6 py-16 text-center">
            <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-96 rounded-full bg-accent/15 blur-3xl" />
            <div className="relative mx-auto grid size-14 place-items-center rounded-2xl border border-line-strong bg-elev2">
              <Router className="size-6 text-accent" />
            </div>
            <div className="relative mt-4 text-base font-semibold text-fg">No controllers yet</div>
            <p className="relative mx-auto mt-1.5 max-w-sm text-sm text-subtle">
              Add a controller with its IP, port and an admin account, then test the connection.
            </p>
            <Button className="relative mt-5" variant="primary" icon={Plus} onClick={() => setForm({ controller: null })}>
              Add Controller
            </Button>
          </Card>
        )}
        {controllers?.length > 0 && visible.length === 0 && (
          <p className="mt-10 text-center text-sm text-subtle">No controllers match this search.</p>
        )}
      </div>

      {form && (
        <ControllerForm
          open
          controller={form.controller}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            load()
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete controller?"
        danger
        busy={deleteBusy}
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        message={
          <>
            <b className="text-fg">{deleting?.name}</b> and its job history will be removed from Zeta. Nothing on the controller itself is
            changed.
          </>
        }
      />
    </div>
  )
}

function ControllerCard({ controller: c, onChange, onEdit, onDelete }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [testing, setTesting] = useState(false)

  // Card shows the last saved numbers at once, then reads the controller live every 5 s.
  usePolling(
    async () => {
      onChange(await api.controllers.apStats(c.id))
    },
    5000,
    { immediate: true }
  )

  async function test() {
    setTesting(true)
    try {
      onChange(await api.controllers.test(c.id))
      toast({ tone: 'success', title: 'Connection OK', message: `${c.name} · ${c.ipAddress}:${c.port}` })
    } catch (err) {
      toast({ tone: 'error', title: `${c.name}: connection failed`, message: err.message })
      try {
        onChange(await api.controllers.get(c.id))
      } catch {
        /* deleted meanwhile */
      }
    } finally {
      setTesting(false)
    }
  }

  const reachable = c.status === 'online'
  const stats = c.apStats
  const job = c.lastJob
  const upPct = stats?.managed ? Math.round((stats.up / stats.managed) * 100) : 0

  return (
    <Card className="group flex flex-col transition-colors hover:border-line-strong">
      <div className="flex items-start gap-3 px-5 pt-5">
        <div
          className={cx(
            'grid size-10 shrink-0 place-items-center rounded-xl border',
            reachable ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line-strong bg-elev2 text-subtle'
          )}
        >
          <Router className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-fg">{c.name}</div>
          <div className="mt-1 flex items-center gap-2">
            <ControllerStatusBadge status={c.status} />
            <span className="text-xs text-subtle">{modeLabel(c.mode)}</span>
          </div>
        </div>
        <div className="flex opacity-60 transition-opacity group-hover:opacity-100">
          <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit} aria-label="Edit" title="Edit" />
          <Button size="sm" variant="dangerGhost" icon={Trash2} onClick={onDelete} aria-label="Delete" title="Delete" />
        </div>
      </div>

      <div className="mx-5 mt-4 rounded-xl border border-line bg-elev2/60 px-4 py-3.5">
        {reachable || (stats && c.status === 'unknown') ? (
          <>
            <div className="grid grid-cols-3 divide-x divide-line text-center">
              <Metric label="Managed" value={stats?.managed ?? '—'} />
              <Metric label="Up" value={stats?.up ?? '—'} tone="text-ok" />
              <Metric label="Down" value={stats?.down ?? '—'} tone={stats?.down > 0 ? 'text-bad' : undefined} />
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-hover">
              <div className="h-full rounded-full bg-ok transition-all duration-500" style={{ width: `${upPct}%` }} />
            </div>
          </>
        ) : c.status === 'unknown' ? (
          <div className="py-3 text-center text-xs text-subtle">Reading AP status…</div>
        ) : (
          <div className="flex items-start gap-2.5 py-1 text-xs text-muted">
            <WifiOff className="mt-0.5 size-4 shrink-0 text-subtle" />
            <div>
              AP status unavailable while the controller is unreachable
              {c.lastError && <div className="mt-1 text-bad">{c.lastError}</div>}
            </div>
          </div>
        )}
      </div>

      <dl className="mx-5 mb-5 mt-4 grid grid-cols-[76px_1fr] gap-y-1.5 text-[13px]">
        <dt className="text-subtle">Host</dt>
        <dd className="mono text-fg">{c.ipAddress}</dd>
        <dt className="text-subtle">Port</dt>
        <dd className="mono text-fg">{c.port}</dd>
        <dt className="text-subtle">Mode</dt>
        <dd className="text-fg">{modeLabel(c.mode)}</dd>
        <dt className="text-subtle">Last job</dt>
        <dd className="flex items-center gap-1.5 text-fg">
          {job ? (
            <>
              <History className="size-3.5 text-subtle" />
              <span className={cx(job.counts.failed > 0 && 'text-bad')}>
                {job.finished}/{job.counts.total} finished{job.counts.failed ? `, ${job.counts.failed} failed` : ''}
              </span>
              <span className="text-xs text-subtle">{formatDateTime(job.createdAt)}</span>
            </>
          ) : (
            <span className="text-subtle">None yet</span>
          )}
        </dd>
      </dl>

      <div className="mt-auto flex items-center gap-2 border-t border-line px-4 py-3">
        <Button size="sm" icon={Plug} busy={testing} onClick={test}>
          Test Connection
        </Button>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => navigate(`/controllers/${c.id}`)}>
          Manage APs <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </Card>
  )
}

function Metric({ label, value, tone }) {
  return (
    <div>
      <div className={cx('text-xl font-semibold tabular-nums tracking-tight', tone || 'text-fg')}>{value}</div>
      <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-subtle">{label}</div>
    </div>
  )
}

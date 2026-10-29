import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  FileSpreadsheet,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Router,
  Wifi,
  WifiOff,
  ArrowUpCircle,
  RadioTower
} from 'lucide-react'
import { api } from '../api.js'
import { usePolling } from '../hooks/usePolling.js'
import { formatDateTime, formatMac, modeLabel } from '../format.js'
import ImportPreviewModal from '../components/ImportPreviewModal.jsx'
import BackNav from '../components/BackNav.jsx'
import {
  Badge,
  Button,
  Card,
  ControllerStatusBadge,
  StatBox,
  SearchInput,
  Alert,
  Skeleton,
  ProgressBar,
  Pager,
  RefreshButton,
  TopProgress,
  UpdatedAt,
  inputClass,
  tableHead,
  tableRow,
  cx
} from '../components/ui.jsx'

const PAGE_SIZE = 100

export default function ControllerDetailPage() {
  const { controllerId } = useParams()
  const [controller, setController] = useState(null)
  const [headerError, setHeaderError] = useState('')
  const [data, setData] = useState(null) // { aps, summary }
  const [apError, setApError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null) // last successful read, for the "Updated …" pulse
  const [jobs, setJobs] = useState([])
  const [group, setGroup] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [importOpen, setImportOpen] = useState(false)
  const [viewJobId, setViewJobId] = useState(null)

  // Header loads at once from the local database; the AP table reads the controller.
  const loadHeader = useCallback(async () => {
    try {
      setController(await api.controllers.get(controllerId))
    } catch (err) {
      setHeaderError(err.message)
    }
  }, [controllerId])

  const loadJobs = useCallback(async () => {
    try {
      setJobs(await api.jobs.list(controllerId))
    } catch {
      /* keep the last list */
    }
  }, [controllerId])

  const loadAps = useCallback(
    async ({ silent } = {}) => {
      if (!silent) setRefreshing(true)
      // a manual refresh spins for at least 0.7 s, so the feedback is visible even when fast
      const minSpin = silent ? null : new Promise((r) => setTimeout(r, 700))
      try {
        const next = await api.aps.list(controllerId)
        await minSpin
        setData(next)
        setApError('')
        setUpdatedAt(Date.now())
      } catch (err) {
        await minSpin
        // a failed silent refresh keeps the old table on screen
        if (!silent || !data) setApError(err.message)
      } finally {
        if (!silent) setRefreshing(false)
        loadHeader()
      }
    },
    [controllerId, loadHeader, data]
  )

  useEffect(() => {
    loadHeader()
    loadJobs()
    loadAps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controllerId])

  usePolling(() => loadAps({ silent: true }), 5000, { enabled: !apError })
  const latestJob = jobs[0]
  const jobActive = latestJob && ['queued', 'running'].includes(latestJob.status)
  usePolling(loadJobs, jobActive ? 3000 : 10000)

  const aps = data?.aps || []
  const summary = data?.summary
  const groups = useMemo(() => Object.entries(summary?.groups || {}).sort(([a], [b]) => a.localeCompare(b)), [summary])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qMac = q.replace(/[^0-9a-f]/g, '')
    return aps.filter((a) => {
      if (group && (a.group || '(none)') !== group) return false
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) ||
        a.serial.toLowerCase().includes(q) ||
        a.ip.includes(q) ||
        (qMac.length >= 2 && a.mac.includes(qMac))
      )
    })
  }, [aps, group, query])
  useEffect(() => setPage(1), [group, query])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (headerError) {
    return (
      <div className="mx-auto max-w-7xl px-7 py-7">
        <Alert tone="red" icon={AlertCircle} title="This controller could not be loaded">
          {headerError}
        </Alert>
        <div className="mt-4">
          <BackNav />
        </div>
      </div>
    )
  }

  const upPct = summary?.managed ? Math.round((summary.up / summary.managed) * 100) : 0

  return (
    <div className="mx-auto max-w-7xl px-7 py-7">
      <BackNav current={controller?.name} enabled={!importOpen && !viewJobId} />

      {/* header */}
      <div className="mt-4 flex items-start justify-between gap-4">
        {controller ? (
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
              <Router className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{controller.name}</h1>
                <ControllerStatusBadge status={controller.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-subtle">
                <span>
                  Host <span className="mono text-muted">{controller.ipAddress}</span>
                </span>
                <span>
                  Port <span className="mono text-muted">{controller.port}</span>
                </span>
                <span>
                  Mode <span className="text-muted">{modeLabel(controller.mode)}</span>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <Skeleton className="h-12 w-96" />
        )}
        <div className="flex shrink-0 gap-2">
          <RefreshButton refreshing={refreshing} onClick={() => loadAps()} />
          <Button variant="primary" icon={FileSpreadsheet} onClick={() => setImportOpen(true)}>
            Import Excel
          </Button>
        </div>
      </div>

      {latestJob && <JobBanner job={latestJob} onView={() => setViewJobId(latestJob.id)} />}

      {/* stats */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <StatBox label="Total APs" value={summary ? summary.managed : '—'} icon={RadioTower} iconTone="accent" />
        <StatBox
          label="Up"
          value={summary ? summary.up : '—'}
          tone="text-ok"
          icon={Wifi}
          iconTone="ok"
          hint={summary ? `${upPct}% of APs` : undefined}
        />
        <StatBox
          label="Down"
          value={summary ? summary.down : '—'}
          tone={summary?.down > 0 ? 'text-bad' : undefined}
          icon={WifiOff}
          iconTone={summary?.down > 0 ? 'bad' : 'muted'}
        />
        <StatBox
          label="Upgrading"
          value={summary ? summary.upgrading : '—'}
          tone={summary?.upgrading > 0 ? 'text-warn' : undefined}
          icon={ArrowUpCircle}
          iconTone={summary?.upgrading > 0 ? 'warn' : 'muted'}
        />
      </div>

      {/* table */}
      <Card className="relative mt-6 overflow-hidden">
        <TopProgress active={refreshing && Boolean(data)} />
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="font-semibold text-fg">Access Points</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-subtle">
              Live from the controller · refreshes every 5 seconds
              <UpdatedAt at={updatedAt} />
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select className={cx(inputClass, 'w-48')} value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">All groups ({aps.length})</option>
              {groups.map(([g, n]) => (
                <option key={g} value={g}>
                  {g} ({n})
                </option>
              ))}
            </select>
            <SearchInput value={query} onChange={setQuery} placeholder="Search serial, MAC, name or IP" className="w-80" />
          </div>
        </div>

        {apError && !data ? (
          <div className="border-t border-line p-5">
            <Alert
              tone="red"
              icon={AlertCircle}
              title="Could not read the AP list from the controller"
              action={
                <Button size="sm" busy={refreshing} onClick={() => loadAps()}>
                  Retry
                </Button>
              }
            >
              {apError}
            </Alert>
          </div>
        ) : !data ? (
          <div className="space-y-2 border-t border-line p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (
          <>
            {apError && (
              <div className="border-t border-line bg-warn/8 px-5 py-2 text-xs text-warn">
                Live refresh failed ({apError}). Showing the last data read.
              </div>
            )}
            <table className="w-full text-sm">
              <thead className={tableHead}>
                <tr>
                  <th className="px-5 py-2.5">Access Point</th>
                  <th className="px-5 py-2.5">MAC Address</th>
                  <th className="px-5 py-2.5">IP Address</th>
                  <th className="px-5 py-2.5">Group</th>
                  <th className="px-5 py-2.5">Model</th>
                  <th className="px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className={cx('transition-opacity duration-200', refreshing && 'opacity-50')}>
                {shown.map((a) => (
                  <tr key={a.serial || a.mac} className={tableRow}>
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-fg">{a.name}</div>
                      <div className="mono mt-0.5 text-subtle">SN {a.serial}</div>
                    </td>
                    <td className="mono px-5 py-2.5 text-muted">{formatMac(a.mac)}</td>
                    <td className="mono px-5 py-2.5 text-muted">{a.ip || '—'}</td>
                    <td className="px-5 py-2.5">
                      <span className="rounded-md bg-hover px-2 py-0.5 text-[12.5px] text-muted ring-1 ring-inset ring-line">{a.group}</span>
                    </td>
                    <td className="px-5 py-2.5 text-muted">{a.model}</td>
                    <td className="px-5 py-2.5">
                      <ApStatus ap={a} />
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr className="border-t border-line">
                    <td colSpan={6} className="px-5 py-12 text-center text-subtle">
                      {aps.length ? 'No APs match this filter.' : 'This controller manages no APs.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="flex justify-end border-t border-line px-5 py-3">
              <Pager page={page} pages={pages} total={filtered.length} onChange={setPage} />
            </div>
          </>
        )}
      </Card>

      {(importOpen || viewJobId) && controller && (
        <ImportPreviewModal
          controller={controller}
          jobId={viewJobId}
          onClose={() => {
            setImportOpen(false)
            setViewJobId(null)
            loadJobs()
          }}
          onJobStarted={(id) => {
            setImportOpen(false)
            setViewJobId(id)
            loadJobs()
          }}
        />
      )}
    </div>
  )
}

function ApStatus({ ap }) {
  if (ap.status === 'up')
    return (
      <div className="flex items-center gap-2">
        <Badge color="green" dot>
          Up
        </Badge>
        {ap.uptime && <span className="text-xs text-subtle">for {ap.uptime}</span>}
      </div>
    )
  if (ap.status === 'down')
    return (
      <Badge color="red" dot>
        Down
      </Badge>
    )
  if (ap.status === 'rebooting' || ap.status === 'upgrading')
    return (
      <Badge color="yellow" dot pulse>
        {ap.status === 'rebooting' ? 'Rebooting' : 'Upgrading'}
      </Badge>
    )
  return <Badge color="gray">{ap.statusText || ap.status}</Badge>
}

const BANNER = {
  blue: { box: 'border-info/25 bg-info/6', icon: 'text-info', bar: 'bg-info' },
  red: { box: 'border-bad/25 bg-bad/6', icon: 'text-bad', bar: 'bg-bad' },
  green: { box: 'border-ok/25 bg-ok/6', icon: 'text-ok', bar: 'bg-ok' }
}

export function JobBanner({ job, onView }) {
  const running = ['queued', 'running'].includes(job.status)
  const problems = (job.counts.failed || 0) > 0
  const tone = running ? 'blue' : problems ? 'red' : 'green'
  const Icon = running ? Loader2 : problems ? AlertTriangle : CheckCircle2
  const title = running
    ? 'Provisioning job running'
    : problems
      ? 'Last provisioning job finished with problems'
      : 'Last provisioning job completed'
  const c = job.counts
  const s = BANNER[tone]
  return (
    <div className={cx('mt-6 rounded-2xl border px-5 py-4', s.box)}>
      <div className="flex items-center gap-3">
        <Icon className={cx('size-5', running && 'animate-spin', s.icon)} />
        <div className="flex-1">
          <div className="font-medium text-fg">{title}</div>
          <div className="mt-0.5 text-xs text-muted">
            <span className="tabular-nums">
              {job.finished}/{c.total} finished · {c.failed || 0} failed · {c.skipped || 0} skipped · {c.sent || 0} sent to new master
            </span>
            <span className="ml-2 text-subtle">{formatDateTime(job.createdAt)}</span>
          </div>
        </div>
        <Button size="sm" onClick={onView}>
          View progress
        </Button>
      </div>
      <div className="mt-3">
        <ProgressBar value={job.finished} max={c.total} tone={running ? 'brand-gradient' : s.bar} />
      </div>
    </div>
  )
}

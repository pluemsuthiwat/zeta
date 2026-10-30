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
  RadioTower,
  Info
} from 'lucide-react'
import { api } from '../api.js'
import { usePolling } from '../hooks/usePolling.js'
import { formatDateTime, formatMac, modeLabel } from '../format.js'
import ImportPreviewModal from '../components/ImportPreviewModal.jsx'
import BackNav from '../components/BackNav.jsx'
import Dropdown from '../components/Dropdown.jsx'
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
  Modal,
  RefreshButton,
  TopProgress,
  UpdatedAt,
  tableHead,
  tableRow,
  cx
} from '../components/ui.jsx'

const PAGE_SIZE = 100

export default function ControllerDetailPage() {
  const { controllerId } = useParams()
  const [controller, setController] = useState(null)
  const [headerError, setHeaderError] = useState('')
  const [data, setData] = useState(null) // { aps, summary, flagLegend }
  const [apError, setApError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null) // last successful read, for the "Updated …" pulse
  const [jobs, setJobs] = useState([])
  const [group, setGroup] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [importOpen, setImportOpen] = useState(false)
  const [flagsHelpOpen, setFlagsHelpOpen] = useState(false)
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
  // Several jobs can run on one controller: show every running one, else the latest.
  const activeJobs = jobs.filter((j) => ['queued', 'running'].includes(j.status))
  const bannerJobs = activeJobs.length ? activeJobs : jobs.slice(0, 1)
  usePolling(loadJobs, activeJobs.length ? 3000 : 10000)

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
    <div className={cx('mx-auto max-w-7xl px-7 py-7', refreshing && 'cursor-progress')} aria-busy={refreshing}>
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
          <Button variant="primary" icon={FileSpreadsheet} disabled={refreshing} onClick={() => setImportOpen(true)}>
            Import Excel
          </Button>
        </div>
      </div>

      {/* Locked while refreshing: inert blocks clicks and keyboard focus until the new data is in. */}
      <div inert={refreshing}>
        {bannerJobs.map((j) => (
          <JobBanner key={j.id} job={j} onView={() => setViewJobId(j.id)} />
        ))}

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
              <Dropdown
                className="w-56"
                ariaLabel="Filter by AP group"
                prefix="Group"
                value={group}
                onChange={setGroup}
                options={[{ value: '', label: 'All groups', count: aps.length }, ...groups.map(([g, n]) => ({ value: g, label: g, count: n }))]}
              />
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
              {/* Fixed layout: column widths never move as uptimes and names change on refresh. Widths are
                  measured from the widest value (MAC 17 chars, IP 15 chars, "for 123d:23h:59m:59s") plus
                  padding; Access Point takes the rest. 1100px fits the window's minimum width (1160). */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col className="w-[164px]" />
                    <col className="w-[152px]" />
                    <col className="w-[176px]" />
                    <col className="w-[112px]" />
                    <col className="w-[116px]" />
                    <col className="w-[208px]" />
                  </colgroup>
                  <thead className={tableHead}>
                    <tr>
                      <th className="px-5 py-2.5">Access Point</th>
                      <th className="px-4 py-2.5">MAC Address</th>
                      <th className="px-4 py-2.5">IP Address</th>
                      <th className="px-4 py-2.5">Group</th>
                      <th className="px-4 py-2.5">Model</th>
                      <th className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          Flags
                          <button
                            type="button"
                            onClick={() => setFlagsHelpOpen(true)}
                            className="grid size-[18px] place-items-center rounded-full bg-accent text-white transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            title="What do the flags mean?"
                            aria-label="What do the flags mean?"
                          >
                            <Info className="size-3" strokeWidth={2.75} />
                          </button>
                        </span>
                      </th>
                      <th className="px-5 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className={cx('transition-opacity duration-200', refreshing && 'opacity-50 select-none')}>
                    {shown.map((a) => (
                      <tr key={a.serial || a.mac} className={tableRow}>
                        <td className="px-5 py-2.5">
                          <div className="truncate font-medium text-fg" title={a.name}>
                            {a.name}
                          </div>
                          <div className="mono mt-0.5 truncate text-subtle">SN {a.serial}</div>
                        </td>
                        <td className="mono whitespace-nowrap px-4 py-2.5 text-muted">{formatMac(a.mac)}</td>
                        <td className="mono whitespace-nowrap px-4 py-2.5 text-muted">{a.ip || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className="inline-block max-w-full truncate rounded-md bg-hover px-2 py-0.5 align-middle text-[12.5px] text-muted ring-1 ring-inset ring-line"
                            title={a.group}
                          >
                            {a.group}
                          </span>
                        </td>
                        <td className="truncate px-4 py-2.5 text-muted" title={a.model}>
                          {a.model}
                        </td>
                        <td className="px-4 py-2.5">
                          <ApFlags flags={a.flags} legend={data?.flagLegend} />
                        </td>
                        <td className="px-5 py-2.5">
                          <ApStatus ap={a} />
                        </td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr className="border-t border-line">
                        <td colSpan={7} className="px-5 py-12 text-center text-subtle">
                          {aps.length ? 'No APs match this filter.' : 'This controller manages no APs.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end border-t border-line px-5 py-3">
                <Pager page={page} pages={pages} total={filtered.length} onChange={setPage} />
              </div>
            </>
          )}
        </Card>
      </div>

      <FlagLegendModal open={flagsHelpOpen} onClose={() => setFlagsHelpOpen(false)} legend={data?.flagLegend} aps={aps} />

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

// Flags that point at a problem to fix before the AP goes out (shown in yellow).
const PROBLEM_FLAGS = new Set(['D', 'E', 'F', 'G', 'I', 'L', 'N', 'T', 'U', 'm'])

/** "N2" → ['N', '2']; two-character flags the legend knows ("1+", "R-") stay together. */
function splitFlags(flags, legend = {}) {
  const out = []
  for (let i = 0; i < flags.length; i++) {
    const two = flags.slice(i, i + 2)
    if (/[+-]/.test(two[1] || '') && legend[two]) {
      out.push(two)
      i++
    } else if (flags[i].trim()) out.push(flags[i])
  }
  return out
}

/** Every flag the controller defines, with the ones its APs show right now listed first. */
function FlagLegendModal({ open, onClose, legend, aps }) {
  const entries = Object.entries(legend || {})
  const counts = new Map()
  for (const a of aps) for (const f of new Set(splitFlags(a.flags || '', legend))) counts.set(f, (counts.get(f) || 0) + 1)
  const present = entries.filter(([f]) => counts.has(f))
  const Row = ([f, meaning]) => (
    <div key={f} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
      <span
        className={cx(
          'mono grid min-w-8 place-items-center rounded px-1.5 py-0.5 text-[12px] ring-1 ring-inset',
          PROBLEM_FLAGS.has(f) ? 'bg-warn/10 text-warn ring-warn/30' : 'bg-hover text-muted ring-line'
        )}
      >
        {f}
      </span>
      <span className="flex-1 text-[13px] text-fg">{meaning}</span>
      {counts.has(f) && (
        <span className="text-xs text-subtle">
          {counts.get(f)} AP{counts.get(f) === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AP flags"
      subtitle="From this controller's own legend (show ap database long)"
      width="max-w-xl"
    >
      {!entries.length ? (
        <p className="text-sm text-subtle">The flag legend loads with the AP list. Refresh the page and try again.</p>
      ) : (
        <div className="space-y-4">
          {present.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">On this controller now</h3>
              {present.map(Row)}
            </section>
          )}
          <section>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">All flags</h3>
            {entries.map(Row)}
          </section>
          <p className="flex items-center gap-2 border-t border-line pt-3 text-xs text-subtle">
            <span className="mono rounded bg-warn/10 px-1.5 py-0.5 text-warn ring-1 ring-inset ring-warn/30">N</span>
            Yellow = worth fixing before the AP goes out.
          </p>
        </div>
      )}
    </Modal>
  )
}

/** The AP's flags from `show ap database long`; hover shows what each one means. */
function ApFlags({ flags, legend }) {
  const list = splitFlags(flags || '', legend)
  if (!list.length) return <span className="text-subtle">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((f) => (
        <span
          key={f}
          title={legend?.[f] ? `${f} = ${legend[f]}` : f}
          className={cx(
            'mono cursor-default rounded px-1.5 py-0.5 text-[11.5px] ring-1 ring-inset',
            PROBLEM_FLAGS.has(f) ? 'bg-warn/10 text-warn ring-warn/30' : 'bg-hover text-muted ring-line'
          )}
        >
          {f}
        </span>
      ))}
    </div>
  )
}

function ApStatus({ ap }) {
  if (ap.status === 'up')
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Badge color="green" dot>
          Up
        </Badge>
        {ap.uptime && (
          <span className="truncate whitespace-nowrap text-xs text-subtle" title={`for ${ap.uptime}`}>
            for {ap.uptime}
          </span>
        )}
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
  return (
    <span className="inline-block max-w-full truncate align-middle" title={ap.statusText || ap.status}>
      <Badge color="gray">{ap.statusText || ap.status}</Badge>
    </span>
  )
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

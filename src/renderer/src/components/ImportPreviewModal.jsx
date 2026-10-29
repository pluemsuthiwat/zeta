import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Download, FileSpreadsheet, AlertCircle, AlertTriangle, Info, Loader2, CheckCircle2, ArrowRight } from 'lucide-react'
import { api } from '../api.js'
import { usePolling } from '../hooks/usePolling.js'
import { formatMac, plural } from '../format.js'
import { Modal, Button, Badge, Alert, SearchInput, Pager, ProgressBar, FilterTile, tableHead, cx } from './ui.jsx'

const PAGE_SIZE = 50

/** Live progress of the controller reads behind Preview / Apply (from the main process). */
function useCheckProgress(active, kind) {
  const [p, setP] = useState(null)
  useEffect(() => {
    if (!active) {
      setP(null)
      return
    }
    return api.imports.onProgress((e) => e.kind === kind && setP(e))
  }, [active, kind])
  return p
}

function CheckProgress({ progress, title }) {
  const details = progress?.phase === 'details' && progress.total > 0
  return (
    <div className="rounded-xl border border-accent/25 bg-accent/6 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-fg">
        <Loader2 className="size-4 animate-spin text-accent" />
        <span className="font-medium">{title}</span>
        <span className="ml-auto text-xs tabular-nums text-muted">
          {details ? `AP settings ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}` : 'Reading the AP list…'}
        </span>
      </div>
      <div className="mt-2.5">
        <ProgressBar value={details ? progress.done : 0} max={details ? progress.total : 1} />
      </div>
      <p className="mt-2 text-xs text-subtle">Read-only. Each AP that changes IP or Master is checked against what it really has.</p>
    </div>
  )
}

/**
 * Upload -> Review (live preview, read-only) -> Apply -> Progress.
 * With `jobId` it opens straight on the progress of that job.
 */
export default function ImportPreviewModal({ controller, jobId, onClose, onJobStarted }) {
  if (jobId) return <ProgressStep controller={controller} jobId={jobId} onClose={onClose} />
  return <UploadAndReview controller={controller} onClose={onClose} onJobStarted={onJobStarted} />
}

// ---------------------------------------------------------------------------

function UploadAndReview({ controller, onClose, onJobStarted }) {
  const [file, setFile] = useState(null) // { name, bytes }
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const progress = useCheckProgress(busy, 'preview')

  async function runPreview(f = file) {
    setBusy(true)
    setError('')
    try {
      setPreview(await api.imports.preview(controller.id, f.bytes))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (preview) {
    return (
      <ReviewStep
        controller={controller}
        file={file}
        preview={preview}
        onBack={() => setPreview(null)}
        onClose={onClose}
        onJobStarted={onJobStarted}
      />
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title="Import APs from Excel"
      subtitle={`${controller.name} · ${controller.ipAddress}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!file} busy={busy} onClick={() => runPreview()}>
            {busy ? 'Reading the controller…' : 'Preview Changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <DropZone
          file={file}
          onFile={(f) => {
            setFile(f)
            setError('')
          }}
        />
        {busy && <CheckProgress progress={progress} title="Comparing the file with the controller" />}
        {error && (
          <Alert tone="red" icon={AlertCircle} title="The file could not be previewed">
            {error}
          </Alert>
        )}
        <div className="rounded-xl border border-line bg-elev2/40 px-4 py-3">
          <div className="text-sm font-medium text-fg">Templates</div>
          <p className="mt-0.5 text-xs text-subtle">Serial Number and MAC columns are set to Text, so Excel keeps leading zeros.</p>
          <div className="mt-2.5 flex gap-2">
            <TemplateButton type="static" label="Static IP template" />
            <TemplateButton type="dhcp" label="DHCP template" />
          </div>
        </div>
        <div className="text-xs leading-relaxed text-subtle">
          <p>
            One row per AP, identified by <b>Serial Number</b> (or MAC). Other columns are the new values; an empty cell means
            “don't change it”. Columns: Name, Group, IP (or <span className="mono">DHCP</span>), Netmask, Gateway, DNS, Master.
          </p>
          <p className="mt-1">.xlsx only, up to 2 MB and 2,000 rows. Only the first worksheet is read; row 1 is the header.</p>
          <p className="mt-1">Previewing only reads from the controller. Nothing is changed until you apply.</p>
        </div>
      </div>
    </Modal>
  )
}

function TemplateButton({ type, label }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      icon={Download}
      busy={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await api.imports.saveTemplate(type)
        } finally {
          setBusy(false)
        }
      }}
    >
      {label}
    </Button>
  )
}

function DropZone({ file, onFile }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)
  const [error, setError] = useState('')

  async function take(f) {
    setError('')
    if (!f) return
    if (!/\.xlsx$/i.test(f.name)) {
      setError(/\.xls$/i.test(f.name) ? 'Old .xls files are not supported. Open it in Excel and Save As .xlsx.' : 'Choose an .xlsx file.')
      return
    }
    if (f.size > 2 * 1024 * 1024) {
      setError('The file is larger than 2 MB.')
      return
    }
    onFile({ name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) })
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          take(e.dataTransfer.files?.[0])
        }}
        className={cx(
          'flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 transition-all',
          over ? 'border-accent bg-accent/8' : 'border-line-strong hover:border-subtle hover:bg-hover'
        )}
      >
        {file ? (
          <>
            <span className="grid size-12 place-items-center rounded-2xl bg-ok/10 text-ok ring-1 ring-inset ring-ok/25"><FileSpreadsheet className="size-5" /></span>
            <div className="mt-3 font-medium text-fg">{file.name}</div>
            <div className="text-xs text-subtle">{(file.size / 1024).toFixed(1)} KB · click or drop to choose another file</div>
          </>
        ) : (
          <>
            <span className="grid size-12 place-items-center rounded-2xl bg-accent/10 text-accent ring-1 ring-inset ring-accent/25"><Upload className="size-5" /></span>
            <div className="mt-3 font-medium text-fg">Drop an .xlsx file here, or click to choose</div>
            <div className="text-xs text-subtle">Up to 2 MB, 2,000 rows</div>
          </>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          take(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------

const ROW_FILTERS = [
  { key: 'all', label: 'All rows', match: () => true },
  { key: 'ready', label: 'Ready to apply', match: (r) => r.status === 'ready', tone: 'text-ok' },
  { key: 'notup', label: 'Not Up', match: (r) => r.status === 'notup', tone: 'text-warn' },
  { key: 'nochange', label: 'No change', match: (r) => r.status === 'nochange' },
  { key: 'error', label: 'Errors', match: (r) => r.status === 'error', tone: 'text-bad' }
]

function ReviewStep({ controller, file, preview, onBack, onClose, onJobStarted }) {
  const { rows, summary } = preview
  const [filter, setFilter] = useState(summary.ready ? 'ready' : summary.errors ? 'error' : 'all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [confirmed, setConfirmed] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const applyProgress = useCheckProgress(applying, 'apply')

  const applicable = summary.ready + summary.notUp
  const counts = { all: summary.total, ready: summary.ready, notup: summary.notUp, nochange: summary.noChange, error: summary.errors }

  const filtered = useMemo(() => {
    const f = ROW_FILTERS.find((x) => x.key === filter)
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (!f.match(r)) return false
      if (!q) return true
      return [r.serial, r.mac, r.currentName, r.currentGroup, ...r.changes.map((c) => c.to)].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [rows, filter, query])
  useEffect(() => setPage(1), [filter, query])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  async function apply() {
    setApplying(true)
    setError('')
    try {
      const { jobId } = await api.imports.apply(controller.id, file.bytes, true)
      onJobStarted(jobId)
    } catch (err) {
      setError(err.message)
      setApplying(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissable={!applying}
      width="max-w-6xl"
      title="Review changes"
      subtitle={`${file.name} · ${controller.name}`}
      footer={
        <div className="flex w-full items-center gap-4">
          <div className="text-sm text-muted">
            <b className="text-fg">{applicable}</b> will be applied · {summary.errors} skipped · {summary.noChange} unchanged
          </div>
          <div className="ml-auto flex gap-2">
            <Button onClick={onBack} disabled={applying}>
              Upload another file
            </Button>
            <Button variant="primary" disabled={!applicable || !confirmed} busy={applying} onClick={apply}>
              {applying ? 'Re-checking and starting…' : `Apply ${plural(applicable, 'change')}`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Alert tone={applicable ? 'blue' : 'yellow'} icon={Info}>
          {applicable
            ? 'Preview only. Nothing has been changed on the controller yet.'
            : 'Preview only. Nothing in this file can be applied: fix the rows below and upload the file again.'}
        </Alert>

        <div className={cx('grid gap-3', summary.notUp ? 'grid-cols-5' : 'grid-cols-4')}>
          {ROW_FILTERS.filter((f) => f.key !== 'notup' || summary.notUp).map((f) => (
            <FilterTile key={f.key} label={f.label} count={counts[f.key]} tone={f.tone} active={filter === f.key} onClick={() => setFilter(f.key)} />
          ))}
        </div>

        {summary.topErrors.length > 0 && (
          <div className="rounded-xl border border-bad/25 bg-bad/8 px-4 py-3">
            <div className="text-sm font-medium text-bad">Most common errors</div>
            <ul className="mt-1 space-y-0.5 text-sm text-bad">
              {summary.topErrors.map((e) => (
                <li key={e.reason}>
                  {e.reason} <span className="font-medium">({e.count})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.otherSessions?.length > 0 && (
          <Alert tone="yellow" icon={AlertTriangle} title="Someone else is active on this controller">
            {summary.otherSessions.map((x) => `${x.user || 'user'} from ${x.from}`).join(', ')}{' '}
            {summary.otherSessions.length === 1 ? 'has' : 'have'} been active in the last 2 minutes. If they are provisioning APs too (another Zeta or
            the WebUI), Zeta checks before every reboot that the controller's shared provisioning list still holds its own AP and stops that AP
            otherwise — but it is safest to agree who provisions first.
          </Alert>
        )}
        {summary.unreadable > 0 && (
          <Alert tone="gray" icon={Info}>
            {plural(summary.unreadable, 'AP')} could not be read from the controller. Their network/master values are treated as changes,
            so they may reboot even if the values already match.
          </Alert>
        )}

        <div className="flex items-center justify-between">
          <SearchInput value={query} onChange={setQuery} placeholder="Search serial, MAC, name or group" />
          <Pager page={page} pages={pages} total={filtered.length} onChange={setPage} />
        </div>

        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className={tableHead}>
              <tr>
                <th className="w-14 px-3 py-2">Row</th>
                <th className="px-3 py-2">Access Point</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Group</th>
                <th className="px-3 py-2">Network / Master</th>
                <th className="w-64 px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top [&>tr]:transition-colors [&>tr:hover]:bg-hover">
              {shown.map((r) => (
                <ReviewRow key={r.rowNumber} row={r} />
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-subtle">
                    No rows here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {applying && <CheckProgress progress={applyProgress} title="Re-checking against the controller before writing" />}
        {error && (
          <Alert tone="red" icon={AlertCircle} title="Apply was refused">
            {error}
          </Alert>
        )}

        {applicable > 0 && (
          <div className="space-y-2 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3">
            {summary.highRisk > 0 && (
              <div className="flex gap-2 text-sm text-warn">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <b>{plural(summary.highRisk, 'AP')}</b> will change Static IP, DHCP or Master. A wrong value can make an AP unreachable, and
                  all rows are sent in one go. Consider trying 1–2 APs first.
                </span>
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-warn">
              <input type="checkbox" className="size-4 accent-[var(--warn)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I understand every applied AP will reboot (a few minutes each)
            </label>
          </div>
        )}
      </div>
    </Modal>
  )
}

const RESULT = {
  ready: ['green', 'Ready'],
  nochange: ['gray', 'No change'],
  error: ['red', 'Error'],
  notup: ['yellow', 'Not Up']
}

function Change({ change }) {
  if (!change) return <span className="text-xs text-subtle">unchanged</span>
  return (
    <div className="text-[13px]">
      <span className="text-subtle line-through">{change.from || '—'}</span>
      <ArrowRight className="mx-1 inline size-3 text-subtle" />
      <span className="font-medium text-fg">{change.to}</span>
    </div>
  )
}

function ReviewRow({ row: r }) {
  const by = Object.fromEntries(r.changes.map((c) => [c.field, c]))
  const [color, label] = RESULT[r.status]
  const risky = by.network || by.master
  return (
    <tr className={cx(r.status === 'error' && 'bg-bad/5')}>
      <td className="px-3 py-2 tabular-nums text-subtle">{r.rowNumber}</td>
      <td className="px-3 py-2">
        <div className="mono text-fg">{r.serial || '—'}</div>
        <div className="mono text-subtle">{r.mac ? formatMac(r.mac) : ''}</div>
        {r.currentName && <div className="text-xs text-subtle">{r.currentName}</div>}
      </td>
      <td className="px-3 py-2">
        {r.status === 'error' ? null : <Change change={by.name} />}
        {r.waitsFor
          ?.filter((d) => d.reason === 'name')
          .map((d) => (
            <div key={d.row} className="mt-0.5 text-xs text-subtle">
              row {d.row} moves off this name
            </div>
          ))}
      </td>
      <td className="px-3 py-2">{r.status === 'error' ? null : <Change change={by.group} />}</td>
      <td className="px-3 py-2">
        {r.status === 'error' ? null : risky ? (
          <div className="space-y-1 rounded-lg bg-warn/8 px-2.5 py-1.5 ring-1 ring-inset ring-warn/25">
            {by.network && <Change change={by.network} />}
            {r.waitsFor
              ?.filter((d) => d.reason === 'ip')
              .map((d) => (
                <div key={d.row} className="text-xs text-subtle">
                  sent after row {d.row} leaves {d.value}
                </div>
              ))}
            {by.master && (
              <div className="text-xs text-warn">
                Master: <Change change={by.master} />
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs text-subtle">unchanged</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge color={color}>{label}</Badge>
          {r.status === 'ready' && <span className="text-xs text-subtle">{plural(r.changes.length, 'change')}</span>}
        </div>
        {r.errors.map((e) => (
          <div key={e} className="mt-1 text-xs text-bad">
            {e}
          </div>
        ))}
        {r.warnings.map((w) => (
          <div key={w} className="mt-1 text-xs text-warn">
            {w}
          </div>
        ))}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------

const ITEM_STATUS = {
  pending: ['gray', 'Waiting'],
  writing: ['blue', 'Writing'],
  verifying: ['blue', 'Verifying'],
  ok: ['green', 'Done'],
  sent: ['blue', 'Sent'],
  failed: ['red', 'Failed'],
  skipped: ['yellow', 'Skipped']
}
const PROGRESS_FILTERS = [
  { key: 'all', label: 'All APs', match: () => true },
  { key: 'progress', label: 'In progress', match: (i) => ['pending', 'writing', 'verifying'].includes(i.status) },
  { key: 'done', label: 'Done', match: (i) => i.status === 'ok' || i.status === 'sent', tone: 'text-ok' },
  { key: 'problem', label: 'Failed / skipped', match: (i) => i.status === 'failed' || i.status === 'skipped', tone: 'text-bad' }
]

function ProgressStep({ controller, jobId, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const load = async () => {
    try {
      setData(await api.jobs.get(jobId))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])
  const running = data && ['queued', 'running'].includes(data.job.status)
  usePolling(load, 3000, { enabled: running !== false })

  const items = data?.items || []
  const filtered = useMemo(() => {
    const f = PROGRESS_FILTERS.find((x) => x.key === filter)
    const q = query.trim().toLowerCase()
    return items.filter((i) => {
      if (!f.match(i)) return false
      if (!q) return true
      return [i.serial, i.mac, i.currentName, i.before?.name].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [items, filter, query])
  useEffect(() => setPage(1), [filter, query])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const job = data?.job
  const c = job?.counts || {}
  const problems = (c.failed || 0) > 0

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-6xl"
      title="Provisioning progress"
      subtitle={controller.name}
      footer={<Button onClick={onClose}>{running ? 'Close (keeps running)' : 'Close'}</Button>}
    >
      {error && !data ? (
        <Alert tone="red" icon={AlertCircle}>
          {error}
        </Alert>
      ) : !data ? (
        <div className="flex items-center gap-2 py-10 text-subtle">
          <Loader2 className="size-4 animate-spin" /> Loading job…
        </div>
      ) : (
        <div className="space-y-4">
          <div
            className={cx(
              'rounded-2xl border px-5 py-4',
              running ? 'border-info/25 bg-info/6' : problems ? 'border-bad/25 bg-bad/6' : 'border-ok/25 bg-ok/6'
            )}
          >
            <div className="flex items-center gap-2">
              {running ? (
                <Loader2 className="size-4 animate-spin text-info" />
              ) : problems ? (
                <AlertTriangle className="size-4 text-bad" />
              ) : (
                <CheckCircle2 className="size-4 text-ok" />
              )}
              <div className="font-medium text-fg">
                {running ? 'Provisioning job running' : problems ? 'Finished with problems' : 'Completed'}
              </div>
              <div className="ml-auto text-sm tabular-nums text-muted">
                {job.finished} / {c.total} finished
              </div>
            </div>
            <div className="mt-2.5">
              <ProgressBar value={job.finished} max={c.total} tone={running ? 'brand-gradient' : problems ? 'bg-bad' : 'bg-ok'} />
            </div>
            <div className="mt-2 text-xs text-muted">
              {running
                ? 'You can close this window; the job keeps running in Zeta. Keep Zeta open (it stays in the tray) until it finishes.'
                : job.message}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {PROGRESS_FILTERS.map((f) => (
              <FilterTile key={f.key} label={f.label} count={items.filter(f.match).length} tone={f.tone} active={filter === f.key} onClick={() => setFilter(f.key)} />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <SearchInput value={query} onChange={setQuery} placeholder="Search serial, MAC or name" />
            <Pager page={page} pages={pages} total={filtered.length} onChange={setPage} />
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className={tableHead}>
                <tr>
                  <th className="w-14 px-3 py-2">Row</th>
                  <th className="px-3 py-2">Access Point</th>
                  <th className="px-3 py-2">Changes</th>
                  <th className="w-80 px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top [&>tr]:transition-colors [&>tr:hover]:bg-hover">
                {shown.map((i) => {
                  const [color, label] = ITEM_STATUS[i.status] || ITEM_STATUS.pending
                  return (
                    <tr key={i.id}>
                      <td className="px-3 py-2 tabular-nums text-subtle">{i.rowNumber}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-fg">{i.currentName}</div>
                        <div className="mono text-subtle">
                          {i.serial} · {formatMac(i.mac)}
                        </div>
                      </td>
                      <td className="space-y-0.5 px-3 py-2">
                        {i.changes.map((ch) => (
                          <div key={ch.field} className="flex items-baseline gap-2">
                            <span className="w-16 shrink-0 text-xs capitalize text-subtle">{ch.field}</span>
                            <Change change={ch} />
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        <Badge color={color} dot={['writing', 'verifying'].includes(i.status)}>
                          {label}
                        </Badge>
                        {i.message && <div className="mt-1 text-xs text-muted">{i.message}</div>}
                        {i.status === 'failed' && i.before && (
                          <div className="mt-1 text-xs text-subtle">
                            Previous values: name {i.before.name || '—'}, group {i.before.group || '—'}, IP {i.before.ip || '—'}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

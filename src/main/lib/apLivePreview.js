// Read-only. Compares requested network/master values with what each AP actually has
// provisioned and drops the ones that already match. Shared by Preview and Apply.
import { readWorkbook, validateRows, resolveDependencies } from './apImport.js'

// Every row that changes IP or Master has its real provisioning read (no cap): guessing
// "it differs" would reboot APs that already have the values. 5 at a time keeps the
// controller's CPU comfortable; a progress callback lets the window show how far it is.
export const DETAIL_CONCURRENCY = 5

async function mapLimit(items, limit, fn) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

function sameNetwork(req, prov) {
  if (!prov?.found || prov.ipMode === null) return false
  if (req.mode === 'dhcp') return prov.ipMode === 'dhcp'
  return (
    prov.ipMode === 'static' &&
    prov.ip === req.ip &&
    prov.netmask === req.netmask &&
    prov.gateway === req.gateway &&
    (!req.dns || prov.dns === req.dns)
  )
}

/** Builds the before → after list the review table shows. */
function describeChanges(row) {
  const { ap, requested, provisioning: prov } = row
  const changes = []
  if (requested.name) changes.push({ field: 'name', from: ap.name, to: requested.name })
  if (requested.group) changes.push({ field: 'group', from: ap.group, to: requested.group })
  if (requested.network) {
    const n = requested.network
    const from =
      prov?.found && prov.ipMode
        ? prov.ipMode === 'dhcp'
          ? 'DHCP'
          : [prov.ip, prov.netmask, prov.gateway].filter(Boolean).join(' / ')
        : ap.ip || 'unknown'
    const to = n.mode === 'dhcp' ? 'DHCP' : [n.ip, n.netmask, n.gateway].join(' / ') + (n.dns ? ` · DNS ${n.dns}` : '')
    changes.push({ field: 'network', from, to })
  }
  if (requested.master) changes.push({ field: 'master', from: prov?.master || 'unknown', to: requested.master })
  return changes
}

const matchesAny = (row, prov) =>
  prov?.found &&
  ((row.requested.network && sameNetwork(row.requested.network, prov)) || (row.requested.master && prov.master === row.requested.master))

/**
 * Full preview: parse file, read AP list, validate, read provisioning where needed, prune.
 * @param {object} [opts]
 * @param {(p: {phase: string, done: number, total: number}) => void} [opts.onProgress]
 * @param {object[]} [opts.inFlight] names/IPs running jobs are about to set (see resolveDependencies)
 * @param {Map<string, object>} [opts.known] provisioning read by a recent preview of the same
 *   file (serial → result). Apply passes it: a value that "differs" is written either way, so it
 *   is reused; anything that matched (and would be skipped) is read again, because only a stale
 *   "matches" can wrongly skip a change.
 * @returns {{ rows, aps, summary, provisioning: Map<string, object> }}
 */
export async function runLivePreview(client, fileBuffer, { onProgress = () => {}, known = null, inFlight = [] } = {}) {
  const parsed = await readWorkbook(fileBuffer)
  onProgress({ phase: 'list', done: 0, total: 0 })
  const aps = await client.listAccessPoints()
  const rows = validateRows(parsed.rows, aps, inFlight)

  // Rows blocked only by a name/IP holder are read too: if the AP already has the value, the
  // claim (and its error) goes away when the chains are rechecked below.
  const ownErrors = (r) => r.errors.filter((e) => !(r.depErrors || []).includes(e)).length
  const needDetails = rows.filter((r) => ownErrors(r) === 0 && (r.requested.network || r.requested.master))
  const toRead = []
  for (const row of needDetails) {
    const prev = known?.get(row.ap.serial)
    if (prev && prev.found && !matchesAny(row, prev)) row.provisioning = prev
    else toRead.push(row)
  }

  let unreadable = 0
  let done = 0
  onProgress({ phase: 'details', done, total: toRead.length })
  await mapLimit(toRead, DETAIL_CONCURRENCY, async (row) => {
    try {
      row.provisioning = await client.getProvisioning(row.ap)
    } catch {
      row.provisioning = null
    }
    done++
    if (done === toRead.length || done % 5 === 0) onProgress({ phase: 'details', done, total: toRead.length })
  })

  const provisioning = new Map()
  for (const row of needDetails) {
    if (!row.provisioning?.found) {
      unreadable++
      continue // can't read it: assume it differs, never guess that it matches
    }
    provisioning.set(row.ap.serial, row.provisioning)
    if (row.requested.network && sameNetwork(row.requested.network, row.provisioning)) delete row.requested.network
    if (row.requested.master && row.provisioning.master === row.requested.master) delete row.requested.master
  }

  // The controller accepts a group that doesn't exist (status 0) and the AP reboots into it,
  // so check every requested group against `show ap-group`. With a Master change the group
  // must exist on the *new* controller, which this one can't tell us: warn instead.
  const wantGroups = rows.filter((r) => !ownErrors(r) && r.requested.group)
  if (wantGroups.length && typeof client.listApGroups === 'function') {
    const groups = await client.listApGroups()
    const exact = new Set(groups)
    for (const r of wantGroups) {
      const g = r.requested.group
      if (r.requested.master) {
        r.warnings.push(`Group "${g}" must exist on the new controller ${r.requested.master}; Zeta can only check this one.`)
      } else if (!exact.has(g)) {
        const near = groups.find((x) => x.toLowerCase() === g.toLowerCase())
        r.errors.push(
          near
            ? `AP Group "${g}" does not exist on this controller. Did you mean "${near}"? (names are case-sensitive)`
            : `AP Group "${g}" does not exist on this controller. Groups here: ${groups.join(', ')}.`
        )
      }
    }
  }

  // Dropping values the AP already has can change who moves off what: recheck the chains.
  resolveDependencies(rows, aps, inFlight)

  for (const r of rows) {
    if (r.errors.length) r.status = 'error'
    else if (Object.keys(r.requested).length === 0) r.status = 'nochange'
    else r.status = r.ap.status === 'up' ? 'ready' : 'notup'
    r.risk = r.requested.network || r.requested.master ? 'high' : 'low'
    r.changes = r.status === 'error' ? [] : describeChanges(r)
  }

  return { rows, aps, provisioning, summary: summarize(rows, unreadable) }
}

export function summarize(rows, unreadable = 0) {
  const count = (s) => rows.filter((r) => r.status === s).length
  const reasons = new Map()
  for (const r of rows) {
    for (const e of r.errors) {
      // group "same reason, different value": hide quoted values, tokens that contain digits, and
      // all-caps tokens of 6+ characters (serials can be letters only: CNSDJKLZMT)
      const key = e
        .replace(/"[^"]*"/g, '"…"')
        .replace(/\b[A-Z][A-Z0-9]{5,}\b/g, '…')
        .replace(/[\w:.\-/]*\d(?:[\w:.\-/]*\w)?/g, '…')
      reasons.set(key, (reasons.get(key) || 0) + 1)
    }
  }
  return {
    total: rows.length,
    ready: count('ready'),
    notUp: count('notup'),
    noChange: count('nochange'),
    errors: count('error'),
    highRisk: rows.filter((r) => (r.status === 'ready' || r.status === 'notup') && r.risk === 'high').length,
    unreadable,
    topErrors: [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([reason, count]) => ({ reason, count }))
  }
}

/** Shape sent to the renderer: no raw provisioning blobs. */
export function toPreviewRow(r) {
  return {
    rowNumber: r.rowNumber,
    excelRow: r.excelRow,
    serial: r.ap?.serial || r.input.serial,
    mac: r.ap?.mac || r.input.mac,
    currentName: r.ap?.name || '',
    currentGroup: r.ap?.group || '',
    apStatus: r.ap?.status || null,
    status: r.status,
    risk: r.risk,
    errors: r.errors,
    warnings: r.warnings,
    changes: r.changes,
    waitsFor: r.waitsFor
  }
}

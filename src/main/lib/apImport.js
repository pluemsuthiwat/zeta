// Reads the import workbook and checks every row against the controller's real AP list.
// Rows that break a rule become errors and are skipped; other rows carry on.
import ExcelJS from 'exceljs'
import { isIpv4, isValidNetmask, staticSetErrors } from './ipv4.js'
import { normalizeMac, formatMac } from './macAddress.js'

export const MAX_ROWS = 2000
export const MAX_BYTES = 2 * 1024 * 1024

export class ImportFileError extends Error {}

const HEADER_ALIASES = {
  serial: ['serial', 'serial number', 'serial #', 'sn', 's/n'],
  mac: ['mac', 'mac address', 'ethernet mac', 'wired mac'],
  name: ['name', 'new name'],
  group: ['group', 'new group'],
  ip: ['ip', 'ip address', 'new ip'],
  netmask: ['netmask', 'subnet', 'subnet mask', 'mask'],
  gateway: ['gateway', 'default gateway'],
  dns: ['dns', 'dns server'],
  master: ['master', 'master ip', 'controller', 'controller ip', 'server ip']
}
const CHANGE_FIELDS = ['name', 'group', 'ip', 'netmask', 'gateway', 'dns', 'master']

function headerKey(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(t)) return key
  return null
}

function cellText(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return ''
  return String(cell.text ?? cell.value).trim()
}

/** Parses the first worksheet. Throws ImportFileError when the whole file is unusable. */
export async function readWorkbook(buffer) {
  const buf = Buffer.from(buffer)
  if (buf.length === 0) throw new ImportFileError('The file is empty.')
  if (buf.length > MAX_BYTES) throw new ImportFileError('The file is larger than 2 MB.')
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    throw new ImportFileError('This is an old .xls file. Open it in Excel and Save As .xlsx first.')
  }
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ImportFileError('Only .xlsx files are supported.')

  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buf)
  } catch {
    throw new ImportFileError('The file could not be read as an .xlsx workbook.')
  }
  const ws = wb.worksheets[0]
  if (!ws) throw new ImportFileError('The workbook has no worksheets.')

  const columns = {}
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const key = headerKey(cellText(cell))
    if (key && columns[key] === undefined) columns[key] = col
  })
  // APs are identified by Serial Number only (a MAC column is only compared, as a warning)
  if (columns.serial === undefined) {
    throw new ImportFileError('The first row needs a Serial Number column.')
  }
  if (!CHANGE_FIELDS.some((f) => columns[f] !== undefined)) {
    throw new ImportFileError(
      'The first row needs at least one column to change (Name, Group, IP, Netmask, Gateway, DNS or Master).'
    )
  }

  const rows = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const values = {}
    let any = false
    for (const [key, col] of Object.entries(columns)) {
      values[key] = cellText(row.getCell(col))
      if (values[key]) any = true
    }
    if (!any) continue
    rows.push({ rowNumber: rows.length + 1, excelRow: r, values })
    if (rows.length > MAX_ROWS) throw new ImportFileError(`The file has more than ${MAX_ROWS} rows.`)
  }
  if (rows.length === 0) throw new ImportFileError('The file has no data rows under the header.')
  return { columns: Object.keys(columns), rows }
}

const lc = (s) => String(s || '').toLowerCase()

/**
 * Checks rows against the controller's AP list (from `show ap database long`).
 * Returns one result per row. Network/master changes are kept as requested here;
 * apLivePreview later drops the ones the AP already has.
 */
export function validateRows(parsedRows, aps, inFlight = []) {
  const bySerial = new Map()
  for (const ap of aps) if (ap.serial) bySerial.set(lc(ap.serial), ap)

  const results = parsedRows.map(({ rowNumber, excelRow, values: v }) => {
    const errors = []
    const warnings = []
    let ap = null

    // --- identify the AP ---
    if (!v.serial) errors.push('The row has no Serial Number.')
    else {
      ap = bySerial.get(lc(v.serial)) || null
      if (!ap) errors.push(`No AP with Serial Number ${v.serial} was found on this controller.`)
    }

    // --- MAC: the user's record only. Compared with the AP found by serial, never used to provision ---
    let macMismatch = false
    if (v.mac && ap) {
      const mac = normalizeMac(v.mac)
      const apMac = normalizeMac(ap.mac)
      if (!mac) {
        macMismatch = true
        warnings.push(`MAC "${v.mac}" in the file is not a valid MAC address. Zeta goes by Serial Number, so the row still applies.`)
      } else if (apMac && mac !== apMac) {
        macMismatch = true
        warnings.push(
          `MAC ${formatMac(mac)} in the file does not match ${formatMac(apMac)} on the controller for Serial ${ap.serial}. Zeta goes by Serial Number, so the row still applies.`
        )
      }
    }

    const requested = {}

    // --- name / group ---
    if (v.name && ap && v.name !== ap.name) requested.name = v.name
    if (v.group && ap && v.group !== ap.group) requested.group = v.group

    // --- network ---
    const isDhcp = lc(v.ip) === 'dhcp'
    if (isDhcp) {
      if (v.netmask || v.gateway || v.dns) errors.push('With IP set to DHCP, Netmask, Gateway and DNS must be empty.')
      else requested.network = { mode: 'dhcp' }
    } else if (v.ip || v.netmask || v.gateway || v.dns) {
      const fieldErrors = []
      if (v.ip && !isIpv4(v.ip)) fieldErrors.push(`IP "${v.ip}" is not a valid IPv4 address.`)
      if (v.netmask && !isValidNetmask(v.netmask))
        fieldErrors.push(`Netmask "${v.netmask}" must be a contiguous mask between /8 and /30.`)
      if (v.gateway && !isIpv4(v.gateway)) fieldErrors.push(`Gateway "${v.gateway}" is not a valid IPv4 address.`)
      if (v.dns && !isIpv4(v.dns)) fieldErrors.push(`DNS "${v.dns}" is not a valid IPv4 address.`)
      const complete = v.ip && v.netmask && v.gateway
      if (!complete) {
        fieldErrors.push(
          v.dns && !v.ip && !v.netmask && !v.gateway
            ? 'DNS can only be set together with a full static IP (IP, Netmask, Gateway).'
            : 'Static IP needs IP, Netmask and Gateway together.'
        )
      }
      if (fieldErrors.length === 0) fieldErrors.push(...staticSetErrors(v))
      errors.push(...fieldErrors)
      if (fieldErrors.length === 0) {
        requested.network = { mode: 'static', ip: v.ip, netmask: v.netmask, gateway: v.gateway, ...(v.dns ? { dns: v.dns } : {}) }
      }
    }

    // --- master ---
    if (v.master) {
      if (!isIpv4(v.master)) errors.push(`Master "${v.master}" must be an IPv4 address (DNS names are not supported).`)
      else requested.master = v.master
    }

    if (ap && ap.status !== 'up') {
      warnings.push(`The AP is ${ap.status} right now. It will be skipped if it is still not Up when the job starts.`)
    }

    return { rowNumber, excelRow, input: v, ap, errors, warnings, macMismatch, requested, waitsFor: [] }
  })

  // --- the same AP referenced by more than one row ---
  const byAp = new Map()
  for (const r of results) {
    if (!r.ap) continue
    const key = r.ap.serial
    if (!byAp.has(key)) byAp.set(key, [])
    byAp.get(key).push(r)
  }
  for (const group of byAp.values()) {
    if (group.length < 2) continue
    for (const r of group) {
      const others = group.filter((o) => o !== r).map((o) => o.rowNumber)
      r.errors.push(`The same AP is also in row ${others.join(', ')}.`)
    }
  }

  checkDuplicatesInFile(results)
  resolveDependencies(results, aps, inFlight)

  for (const r of results) {
    if (r.errors.length) r.status = 'error'
    else if (Object.keys(r.requested).length === 0) r.status = 'nochange'
    else r.status = r.ap.status === 'up' ? 'ready' : 'notup'
    r.risk = r.requested.network || r.requested.master ? 'high' : 'low'
  }
  return results
}

function duplicates(results, keyOf, message) {
  const groups = new Map()
  for (const r of results) {
    const k = keyOf(r)
    if (!k) continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    for (const r of group) message(r, group.filter((o) => o !== r).map((o) => o.rowNumber))
  }
}

function checkDuplicatesInFile(results) {
  duplicates(
    results,
    (r) => r.input.name && lc(r.input.name),
    (r, others) => r.errors.push(`New name "${r.input.name}" is also used in row ${others.join(', ')}.`)
  )
  duplicates(
    results,
    (r) => (r.requested.network?.mode === 'static' ? r.requested.network.ip : null),
    (r, others) => r.errors.push(`IP ${r.requested.network.ip} is also used in row ${others.join(', ')}.`)
  )
}

/** The row moves its AP off `field` (its current name / IP) in this file. */
function movesOff(row, field) {
  if (!row?.ap) return false
  if (field === 'name') return Boolean(row.requested.name)
  const n = row.requested.network
  return Boolean(n) && (n.mode === 'dhcp' || n.ip !== row.ap.ip)
}

/**
 * The rule is the end state: after Apply, every name and IP must be unique. A name or IP that
 * other APs hold right now is fine when each of them moves off it in the same file
 * (.10→.11 while .11→.12, or even a swap .10↔.11). It is an error only when a holder keeps it
 * (not in the file, not changing that value, or its row has errors). A row asking for the value
 * its AP already has claims nothing, even if another AP shares it after a partly failed job.
 * `waitsFor` = [{ row, reason, value }] only orders the writes: the holder is sent first, and
 * if the controller rejects the holder's write, the row that wanted its value is skipped.
 * Nothing waits for reboots. Runs again after the live preview drops matching values: its own
 * errors from the last run are replaced, so a value that turned out to match no longer blocks.
 *
 * `inFlight` = what jobs still running on this controller are about to set, which the AP list
 * doesn't show yet: [{ serial, row, name, ip, offName, offIp }]. A value one of them is setting
 * on another AP is taken; a value its AP is moving off counts as free, like a holder row here.
 */
export function resolveDependencies(results, aps, inFlight = []) {
  const holdersBy = (key) => {
    const m = new Map()
    for (const a of aps) {
      const k = key(a)
      if (!k) continue
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(a)
    }
    return m
  }
  const byName = holdersBy((a) => a.name && lc(a.name))
  const byIp = holdersBy((a) => a.ip)
  const rowByAp = new Map(results.filter((r) => r.ap).map((r) => [r.ap, r]))
  const byRow = new Map(results.map((r) => [r.rowNumber, r]))
  const flightOf = new Map(inFlight.map((f) => [lc(f.serial), f]))
  const movingOffInJob = (ap, reason) => {
    const f = ap.serial && flightOf.get(lc(ap.serial))
    return Boolean(f && (reason === 'name' ? f.offName : f.offIp))
  }
  const takenInJob = (r, reason, value) =>
    inFlight.find(
      (f) => lc(f.serial) !== lc(r.ap?.serial || '') && (reason === 'name' ? f.name && lc(f.name) === lc(value) : f.ip === value)
    )

  const claims = (r) => {
    const out = []
    if (r.requested.name) out.push({ reason: 'name', value: r.requested.name, holders: byName.get(lc(r.requested.name)) || [] })
    const n = r.requested.network
    if (n?.mode === 'static' && n.ip !== r.ap?.ip) out.push({ reason: 'ip', value: n.ip, holders: byIp.get(n.ip) || [] })
    return out
  }

  for (const r of results) {
    const prev = new Set(r.depErrors || [])
    r.errors = r.errors.filter((e) => !prev.has(e))
    r.depErrors = []
  }
  const fail = (r, msg) => {
    r.errors.push(msg)
    r.depErrors.push(msg)
  }

  // Iterate: a holder row picking up an error keeps its value, which invalidates rows that wanted it.
  let changed = true
  while (changed) {
    changed = false
    for (const r of results) {
      r.waitsFor = []
      if (r.errors.length) continue
      for (const { reason, value, holders } of claims(r)) {
        const label = reason === 'name' ? `Name "${value}"` : `IP ${value}`
        const job = takenInJob(r, reason, value)
        if (job) {
          fail(r, `${label} is being set on AP ${job.serial} by a provisioning job that is still running (its row ${job.row}).`)
          break
        }
        for (const holder of holders) {
          if (holder === r.ap) continue
          if (movingOffInJob(holder, reason)) continue // a running job is moving that AP off it
          const holderRow = rowByAp.get(holder)
          const who = holder.name || holder.serial
          if (!holderRow || !movesOff(holderRow, reason)) {
            fail(r, `${label} is already used by AP ${who}${reason === 'name' ? ` (Serial ${holder.serial})` : ''}.`)
            changed = true
          } else if (holderRow.errors.length) {
            fail(r, `${label} is held by the AP in row ${holderRow.rowNumber}, which has errors and will keep it.`)
            changed = true
          } else {
            r.waitsFor.push({ row: holderRow.rowNumber, reason, value })
          }
        }
        if (r.errors.length) break
      }
    }
  }

  // Swaps (A↔B, .10↔.11) have no "holder first" order; they are written as they come.
  const reaches = (from, target, seen = new Set()) => {
    for (const d of byRow.get(from)?.waitsFor || []) {
      if (d.row === target) return true
      if (!seen.has(d.row)) {
        seen.add(d.row)
        if (reaches(d.row, target, seen)) return true
      }
    }
    return false
  }
  for (const r of results) {
    r.waitsFor = r.errors.length ? [] : r.waitsFor.filter((d) => !reaches(d.row, r.rowNumber))
  }
}

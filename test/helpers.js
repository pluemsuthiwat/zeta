import ExcelJS from 'exceljs'

/** Builds an .xlsx buffer from a header row and data rows. */
export async function makeXlsx(header, rows) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('APs')
  ws.addRow(header)
  for (const r of rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export function ap(overrides) {
  return {
    name: 'AP-1',
    group: 'default',
    model: 'AP-515',
    ip: '10.0.0.11',
    status: 'up',
    statusText: 'Up 1h:2m:3s',
    uptime: '1h 2m 3s',
    mac: 'aabbcc000001',
    serial: 'SN0001',
    ...overrides
  }
}

/**
 * In-memory controller for the job runner. State is computed from Date.now(), so it follows
 * vitest fake timers. `behavior(serial)` returns 'normal' | 'ignore' | 'reject' | 'lost' | 'partial' (reboots, applies name/group but not the IP).
 */
export function fakeController(aps, { behavior = () => 'normal', downAfterMs = 5000, upAfterMs = 60_000 } = {}) {
  const state = aps.map((a) => ({ ...a }))
  const transitions = [] // { serial, downAt, upAt, apply }
  const writes = []

  function current() {
    const now = Date.now()
    for (const t of transitions) {
      if (t.done) continue
      const a = state.find((x) => x.serial === t.serial)
      if (now >= t.upAt) {
        if (t.lost) a.status = 'down'
        else Object.assign(a, t.apply, { status: 'up' })
        t.done = true
      } else if (now >= t.downAt) a.status = 'rebooting'
    }
    return state.map((a) => ({ ...a }))
  }

  return {
    writes,
    /** Fake ICMP: an address answers while an Up (not rebooting) AP holds it. */
    async ping(ip) {
      return current().some((a) => a.ip === ip && a.status === 'up')
    },
    async listAccessPoints() {
      return current()
    },
    async getProvisioning() {
      return { found: false }
    },
    async provision(apRef, requested) {
      writes.push({ name: apRef.name, requested, at: Date.now() })
      const target = state.find((a) => a.name === apRef.name)
      const b = behavior(target.serial)
      if (b === 'reject') {
        const err = new Error('The controller rejected ap_prov: invalid value')
        err.code = 'EREJECTED'
        throw err
      }
      if (b === 'ignore') return
      const apply = {}
      if (requested.name) apply.name = requested.name
      if (requested.group) apply.group = requested.group
      if (requested.network?.mode === 'static' && b !== 'partial') apply.ip = requested.network.ip
      const now = Date.now()
      transitions.push({ serial: target.serial, downAt: now + downAfterMs, upAt: now + upAfterMs, apply, lost: b === 'lost' })
    }
  }
}

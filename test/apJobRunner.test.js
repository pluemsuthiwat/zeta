import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openDatabase } from '../src/main/db.js'
import { runJob, uptimeSeconds } from '../src/main/lib/apJobRunner.js'
import { ap, fakeController } from './helpers.js'

const APS = [
  ap({ name: 'A', serial: 'S1', mac: 'aabbcc000001', ip: '10.0.0.11' }),
  ap({ name: 'B', serial: 'S2', mac: 'aabbcc000002', ip: '10.0.0.12' }),
  ap({ name: 'C', serial: 'S3', mac: 'aabbcc000003', ip: '10.0.0.13' })
]

let store, controllerId
beforeEach(() => {
  vi.useFakeTimers()
  store = openDatabase(':memory:')
  controllerId = store.createController({
    name: 'MC',
    ipAddress: '10.0.0.2',
    port: 4343,
    mode: 'standalone',
    username: 'admin',
    passwordEncrypted: Buffer.from('x')
  }).id
})
afterEach(() => {
  vi.useRealTimers()
  store.close()
})

function item(row, apIndex, requested, extra = {}) {
  const a = APS[apIndex]
  return {
    rowNumber: row,
    serial: a.serial,
    mac: a.mac,
    risk: requested.network || requested.master ? 'high' : 'low',
    currentName: a.name,
    requested,
    changes: [],
    waitsFor: [],
    ...extra
  }
}

async function run(items, controller) {
  const job = store.createJob(controllerId, items)
  const done = runJob(job.id, { store, client: controller })
  await vi.advanceTimersByTimeAsync(30 * 60_000)
  await done
  const byRow = Object.fromEntries(store.getJobItems(job.id).map((i) => [i.rowNumber, i]))
  return { job: store.getJob(job.id), byRow }
}

describe('runJob', () => {
  it('verifies renames and static IPs, low risk first, 1.5 s apart', async () => {
    const c = fakeController(APS)
    const { job, byRow } = await run(
      [
        item(1, 0, { network: { mode: 'static', ip: '10.0.1.20', netmask: '255.255.255.0', gateway: '10.0.1.1' } }),
        item(2, 1, { name: 'B2' })
      ],
      c
    )
    expect(c.writes.map((w) => w.name)).toEqual(['B', 'A']) // low risk first
    expect(c.writes[1].at - c.writes[0].at).toBeGreaterThanOrEqual(1500)
    expect(byRow[1].status).toBe('ok')
    expect(byRow[2].status).toBe('ok')
    expect(byRow[1].before).toEqual({ name: 'A', group: 'default', ip: '10.0.0.11' })
    expect(job.status).toBe('done')
  })

  it('a new name shown before the reboot is not "Done" until the AP really rebooted', async () => {
    // fake controller that renames in its database at once, then reboots 20 s later
    const c = fakeController(APS, { downAfterMs: 20_000, upAfterMs: 80_000 })
    const provision = c.provision
    c.provision = async (apRef, req) => {
      await provision(apRef, req)
      const list = c.listAccessPoints
      const t = Date.now()
      c.listAccessPoints = async () =>
        (await list()).map((a) => (a.serial === 'S1' && Date.now() - t < 20_000 ? { ...a, name: req.name, uptime: '2h 0m 0s' } : a))
    }
    const job = store.createJob(controllerId, [item(1, 0, { name: 'A-NEW' })])
    const done = runJob(job.id, { store, client: c })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(store.getJobItems(job.id)[0].status).toBe('verifying') // new name visible, but no reboot yet
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await done
    const [it] = store.getJobItems(job.id)
    expect(it.status).toBe('ok')
    expect(it.finishedAt - it.startedAt).toBeGreaterThanOrEqual(80_000)
  })

  it('DHCP needs to see the AP leave Up before it counts as done', async () => {
    const c = fakeController(APS)
    const { byRow } = await run([item(1, 0, { network: { mode: 'dhcp' } })], c)
    expect(byRow[1].status).toBe('ok')
  })

  it('resends once when the AP never reboots, then fails', async () => {
    const c = fakeController(APS, { behavior: () => 'ignore' })
    const { job, byRow } = await run([item(1, 0, { network: { mode: 'dhcp' } })], c)
    expect(c.writes).toHaveLength(2)
    expect(byRow[1].status).toBe('failed')
    expect(byRow[1].attempts).toBe(2)
    expect(byRow[1].message).toMatch(/did not reboot/)
    expect(job.status).toBe('failed')
  })

  it('fails after 8 minutes when the AP never comes back', async () => {
    const c = fakeController(APS, { behavior: () => 'lost' })
    const { byRow } = await run([item(1, 0, { group: 'g2' })], c)
    expect(byRow[1].status).toBe('failed')
    expect(byRow[1].message).toMatch(/within 8 minutes/)
  })

  it('still times out when the AP list keeps failing after the write (never stuck in Verifying)', async () => {
    const c = fakeController(APS)
    const list = c.listAccessPoints
    let calls = 0
    c.listAccessPoints = async () => {
      if (++calls > 1) throw new Error('The controller did not answer within 8 seconds.')
      return list()
    }
    const { byRow } = await run([item(1, 0, { group: 'g2' })], c)
    expect(byRow[1].status).toBe('failed')
    expect(byRow[1].message).toMatch(/could not be read \(The controller did not answer/)
  })

  it('fails soon (not after 8 min) when the AP is back Up without the requested IP', async () => {
    const c = fakeController(APS, { behavior: () => 'partial' })
    const job = store.createJob(controllerId, [
      item(1, 0, { name: 'A-NEW', network: { mode: 'static', ip: '10.0.1.20', netmask: '255.255.255.0', gateway: '10.0.1.1' } })
    ])
    const done = runJob(job.id, { store, client: c })
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    await done
    const [it] = store.getJobItems(job.id)
    expect(it.status).toBe('failed')
    expect(it.message).toMatch(/Up again, but IP is 10\.0\.0\.11, not 10\.0\.1\.20/)
    expect(it.finishedAt - it.startedAt).toBeLessThan(4 * 60_000)
  })

  it('reports a controller rejection and keeps going with the other APs', async () => {
    const c = fakeController(APS, { behavior: (s) => (s === 'S1' ? 'reject' : 'normal') })
    const { byRow } = await run([item(1, 0, { group: 'g' }), item(2, 1, { group: 'g' })], c)
    expect(byRow[1].status).toBe('failed')
    expect(byRow[1].message).toMatch(/rejected ap_prov/)
    expect(byRow[2].status).toBe('ok')
  })

  it('marks master changes as Sent right after the write', async () => {
    const c = fakeController(APS)
    const { byRow } = await run([item(1, 0, { master: '10.9.9.9' })], c)
    expect(byRow[1].status).toBe('sent')
  })

  it('rename chain: holder first, and skips when the holder write is rejected', async () => {
    const ok = fakeController(APS)
    const r1 = await run([item(1, 0, { name: 'B' }, { waitsFor: [{ row: 2, reason: 'name', value: 'B' }] }), item(2, 1, { name: 'B2' })], ok)
    expect(ok.writes.map((w) => w.name)).toEqual(['B', 'A'])
    expect(ok.writes[1].at - ok.writes[0].at).toBeLessThan(2000) // no wait for the holder's reboot
    expect(r1.byRow[1].status).toBe('ok')

    const bad = fakeController(APS, { behavior: (s) => (s === 'S2' ? 'reject' : 'normal') })
    const r2 = await run([item(1, 0, { name: 'B' }, { waitsFor: [{ row: 2, reason: 'name', value: 'B' }] }), item(2, 1, { name: 'B2' })], bad)
    expect(r2.byRow[2].status).toBe('failed')
    expect(r2.byRow[1].status).toBe('skipped')
    expect(bad.writes).toHaveLength(1)
  })

  const net = (ip) => ({ network: { mode: 'static', ip, netmask: '255.255.255.0', gateway: '10.0.0.1' } })
  const chain = () => [
    item(1, 0, net('10.0.0.12'), { waitsFor: [{ row: 2, reason: 'ip', value: '10.0.0.12' }] }),
    item(2, 1, net('10.0.0.13'), { waitsFor: [{ row: 3, reason: 'ip', value: '10.0.0.13' }] }),
    item(3, 2, net('10.0.0.14'))
  ]
  async function runWith(items, controller, ping) {
    const job = store.createJob(controllerId, items)
    const done = runJob(job.id, { store, client: controller, ping })
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    await done
    return { job: store.getJob(job.id), byRow: Object.fromEntries(store.getJobItems(job.id).map((i) => [i.rowNumber, i])) }
  }

  it('IP chain (A + ping): each AP is sent only after the holder stopped answering on its IP', async () => {
    const c = fakeController(APS) // AP leaves Up 5 s after the write
    const pings = []
    const { job, byRow } = await runWith(chain(), c, async (ip) => {
      pings.push(ip)
      return c.ping(ip)
    })
    expect(c.writes.map((w) => w.name)).toEqual(['C', 'B', 'A'])
    for (const k of [1, 2]) {
      const gap = c.writes[k].at - c.writes[k - 1].at
      expect(gap).toBeGreaterThanOrEqual(5000) // never before the holder actually went down
      expect(gap).toBeLessThan(10_000) // ~1 s pings: fast, no full reboot per hop
    }
    expect(pings).toContain('10.0.0.13') // pinged C's old IP while B waited
    expect([1, 2, 3].map((r) => byRow[r].status)).toEqual(['ok', 'ok', 'ok'])
    expect(job.status).toBe('done')
  })

  it('IP chain without ping (AP subnet unreachable): released by the controller showing Rebooting', async () => {
    const c = fakeController(APS)
    const { byRow } = await runWith(chain(), c, async () => false) // never answers: ping can't prove anything
    expect(c.writes.map((w) => w.name)).toEqual(['C', 'B', 'A'])
    const gap = c.writes[1].at - c.writes[0].at
    expect(gap).toBeGreaterThanOrEqual(5000)
    expect(gap).toBeLessThan(12_000) // 3 s controller polls while a chain waits
    expect([1, 2, 3].map((r) => byRow[r].status)).toEqual(['ok', 'ok', 'ok'])
  })

  it('IP chain: lost pings (1–2 in a row) on a lossy link do not release the IP', async () => {
    const c = fakeController(APS, { behavior: (s) => (s === 'S2' ? 'ignore' : 'normal') }) // B never reboots
    let n = 0
    const lossy = async (ip) => (++n % 3 === 0 ? false : c.ping(ip)) // every 3rd ping lost
    const { byRow } = await runWith(chain().slice(0, 2), c, lossy)
    expect(c.writes.filter((w) => w.name === 'A')).toHaveLength(0)
    expect(byRow[1].status).toBe('skipped')
  })

  it('IP chain: a holder the controller accepted but that never reboots blocks its IP — no duplicate', async () => {
    const c = fakeController(APS, { behavior: (s) => (s === 'S2' ? 'ignore' : 'normal') })
    const { byRow } = await runWith(chain().slice(0, 2), c, (ip) => c.ping(ip))
    expect(byRow[2].status).toBe('failed') // B: accepted, never rebooted (resent once, then failed)
    expect(byRow[1].status).toBe('skipped') // A was never sent: B still holds .12
    expect(byRow[1].message).toMatch(/Row 2 keeps IP 10\.0\.0\.12/)
    expect(c.writes.filter((w) => w.name === 'A')).toHaveLength(0)
  })

  it('IP chain: if the holder write is rejected, the AP that wanted its IP is skipped', async () => {
    const c = fakeController(APS, { behavior: (s) => (s === 'S2' ? 'reject' : 'normal') })
    const net = (ip) => ({ network: { mode: 'static', ip, netmask: '255.255.255.0', gateway: '10.0.0.1' } })
    const { byRow } = await run([item(1, 0, net('10.0.0.12'), { waitsFor: [{ row: 2, reason: 'ip', value: '10.0.0.12' }] }), item(2, 1, net('10.0.0.13'))], c)
    expect(byRow[2].status).toBe('failed')
    expect(byRow[1].status).toBe('skipped')
    expect(byRow[1].message).toMatch(/Row 2 keeps IP 10\.0\.0\.12/)
    expect(c.writes.filter((w) => w.name === 'A')).toHaveLength(0)
  })

  it('skips APs that are not Up at start and fails ones that disappeared', async () => {
    const aps = [APS[0], { ...APS[1], status: 'down' }]
    const c = fakeController(aps)
    const { byRow } = await run([item(1, 1, { group: 'g' }), item(2, 2, { group: 'g' })], c)
    expect(byRow[1].status).toBe('skipped')
    expect(byRow[2].status).toBe('failed')
    expect(c.writes).toHaveLength(0)
  })
})

describe('uptimeSeconds', () => {
  it('parses the uptime forms AOS shows', () => {
    expect(uptimeSeconds('57s')).toBe(57)
    expect(uptimeSeconds('1m 6s')).toBe(66)
    expect(uptimeSeconds('2h 3m 4s')).toBe(7384)
    expect(uptimeSeconds('1d 0h 0m 1s')).toBe(86401)
    expect(uptimeSeconds('')).toBe(null)
  })
})

describe('store', () => {
  it('fails interrupted jobs on startup and keeps only 5 jobs per controller', () => {
    const items = [item(1, 0, { group: 'g' })]
    const j = store.createJob(controllerId, items)
    expect(store.activeJob(controllerId).id).toBe(j.id)
    expect(store.failStaleJobs(0, 'interrupted')).toBe(1)
    expect(store.getJob(j.id).status).toBe('failed')
    expect(store.getJobItems(j.id)[0]).toMatchObject({ status: 'failed', message: 'interrupted' })
    for (let i = 0; i < 6; i++) {
      const x = store.createJob(controllerId, items)
      store.updateJob(x.id, { status: 'done' })
    }
    expect(store.listJobs(controllerId)).toHaveLength(5)
  })
})

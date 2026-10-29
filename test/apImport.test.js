import { describe, it, expect } from 'vitest'
import { readWorkbook, validateRows, ImportFileError } from '../src/main/lib/apImport.js'
import { runLivePreview } from '../src/main/lib/apLivePreview.js'
import { buildTemplate } from '../src/main/lib/importTemplate.js'
import { makeXlsx, ap } from './helpers.js'

const APS = [
  ap({ name: 'A', serial: 'S1', mac: 'aabbcc000001', ip: '10.0.0.11' }),
  ap({ name: 'B', serial: 'S2', mac: 'aabbcc000002', ip: '10.0.0.12' }),
  ap({ name: 'C', serial: 'S3', mac: 'aabbcc000003', ip: '10.0.0.13', group: 'lobby' }),
  ap({ name: 'D', serial: 'S4', mac: 'aabbcc000004', ip: '10.0.0.14', status: 'down' })
]

async function check(header, rows, aps = APS) {
  const parsed = await readWorkbook(await makeXlsx(header, rows))
  return validateRows(parsed.rows, aps)
}

describe('readWorkbook', () => {
  it('maps header aliases case-insensitively and skips blank rows', async () => {
    const { rows, columns } = await readWorkbook(await makeXlsx(['S/N', 'NEW NAME', 'Default Gateway'], [['S1', 'X', ''], [], ['S2', 'Y', '']]))
    expect(columns).toEqual(['serial', 'name', 'gateway'])
    expect(rows.map((r) => [r.rowNumber, r.values.serial])).toEqual([[1, 'S1'], [2, 'S2']])
  })
  it('rejects a file without an identifier or change column', async () => {
    await expect(readWorkbook(await makeXlsx(['Name'], [['x']]))).rejects.toThrow(/Serial Number or MAC/)
    await expect(readWorkbook(await makeXlsx(['Serial'], [['S1']]))).rejects.toThrow(/at least one column/)
  })
  it('rejects .xls and non-xlsx bytes', async () => {
    await expect(readWorkbook(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]))).rejects.toThrow(/Save As .xlsx/)
    await expect(readWorkbook(Buffer.from('hello'))).rejects.toBeInstanceOf(ImportFileError)
  })
  it('rejects more than 2000 rows', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => [`S${i}`, `N${i}`])
    await expect(readWorkbook(await makeXlsx(['Serial', 'Name'], rows))).rejects.toThrow(/more than 2000/)
  })
  it('templates keep leading zeros and are readable', async () => {
    const { rows } = await readWorkbook(await buildTemplate('static'))
    expect(rows[0].values).toMatchObject({ serial: 'ABC123456', ip: '192.168.1.50', dns: '8.8.8.8' })
  })
})

describe('validateRows: identifying the AP', () => {
  it('finds by serial, or by MAC when serial is empty', async () => {
    const r = await check(['Serial', 'MAC', 'Name'], [['S1', '', 'A2'], ['', 'aa-bb-cc-00-00-02', 'B2']])
    expect(r.map((x) => x.status)).toEqual(['ready', 'ready'])
    expect(r[1].ap.name).toBe('B')
  })
  it('errors when serial and MAC disagree', async () => {
    const [r] = await check(['Serial', 'MAC', 'Name'], [['S1', 'aabbcc000002', 'Z']])
    expect(r.status).toBe('error')
    expect(r.errors[0]).toMatch(/belongs to MAC/)
  })
  it('errors on bad MAC, unknown AP, and missing identifier', async () => {
    const r = await check(['Serial', 'MAC', 'Name', 'Group'], [['', 'aabbcc', 'x', ''], ['NOPE', '', 'y', ''], ['', '', '', 'g']])
    expect(r[0].errors[0]).toMatch(/12 hexadecimal/)
    expect(r[1].errors[0]).toMatch(/No AP with Serial Number NOPE/)
    expect(r[2].errors[0]).toMatch(/no Serial Number or MAC/)
  })
  it('flags every row that targets the same AP, even via serial vs MAC', async () => {
    const r = await check(['Serial', 'MAC', 'Group'], [['S1', '', 'g1'], ['', 'aabbcc000001', 'g2']])
    expect(r[0].errors[0]).toMatch(/also in row 2/)
    expect(r[1].errors[0]).toMatch(/also in row 1/)
  })
})

describe('validateRows: names', () => {
  it('drops a name that is already the current name', async () => {
    const [r] = await check(['Serial', 'Name'], [['S1', 'A']])
    expect(r.status).toBe('nochange')
  })
  it('rejects duplicate new names inside the file (case-insensitive)', async () => {
    const r = await check(['Serial', 'Name'], [['S1', 'New'], ['S2', 'new']])
    expect(r.every((x) => x.status === 'error')).toBe(true)
  })
  it('rejects a name held by an AP that is not renamed in the file', async () => {
    const [r] = await check(['Serial', 'Name'], [['S1', 'B']])
    expect(r.errors[0]).toMatch(/Name "B" is already used by AP B \(Serial S2\)/)
  })
  it('allows a rename chain and records the dependency', async () => {
    const r = await check(['Serial', 'Name'], [['S1', 'B'], ['S2', 'C2']]) // A->B while B->C2
    expect(r.map((x) => x.status)).toEqual(['ready', 'ready'])
    expect(r[0].waitsFor).toEqual([{ row: 2, reason: 'name', value: 'B' }])
    expect(r[1].waitsFor).toEqual([])
  })
  it('allows a name swap (A↔B): the end state is unique', async () => {
    const r = await check(['Serial', 'Name'], [['S1', 'B'], ['S2', 'A']])
    expect(r.map((x) => x.status)).toEqual(['ready', 'ready'])
    expect(r[0].waitsFor).toEqual([]) // no holder-first order exists for a swap
  })
  it('rejects a chain whose holder row has errors', async () => {
    const r = await check(['Serial', 'Name', 'IP'], [['S1', 'B', ''], ['S2', 'B2', '1.2.3']])
    expect(r[1].status).toBe('error')
    expect(r[0].errors[0]).toMatch(/row 2, which has errors and will keep it/)
  })
})

describe('validateRows: IP and master', () => {
  const H = ['Serial', 'IP', 'Netmask', 'Gateway', 'DNS', 'Master']
  it('accepts a complete static set and marks it high risk', async () => {
    const [r] = await check(H, [['S1', '10.0.1.20', '255.255.255.0', '10.0.1.1', '8.8.8.8', '']])
    expect(r.status).toBe('ready')
    expect(r.risk).toBe('high')
    expect(r.requested.network).toEqual({ mode: 'static', ip: '10.0.1.20', netmask: '255.255.255.0', gateway: '10.0.1.1', dns: '8.8.8.8' })
  })
  it('rejects incomplete static sets and DNS on its own', async () => {
    const r = await check(H, [['S1', '10.0.1.20', '', '10.0.1.1', '', ''], ['S2', '', '', '', '8.8.8.8', '']])
    expect(r[0].errors).toContain('Static IP needs IP, Netmask and Gateway together.')
    expect(r[1].errors[0]).toMatch(/DNS can only be set together/)
  })
  it('DHCP requires netmask/gateway/dns to be empty', async () => {
    const r = await check(H, [['S1', 'dhcp', '', '', '', ''], ['S2', 'DHCP', '255.255.255.0', '', '', '']])
    expect(r[0].requested.network).toEqual({ mode: 'dhcp' })
    expect(r[1].errors[0]).toMatch(/must be empty/)
  })
  it('rejects leading zeros, bad masks, network/broadcast and off-subnet gateways', async () => {
    const r = await check(H, [
      ['S1', '010.0.1.20', '255.255.255.0', '10.0.1.1', '', ''],
      ['S2', '10.0.1.20', '255.0.255.0', '10.0.1.1', '', ''],
      ['S3', '10.0.1.0', '255.255.255.0', '10.0.1.1', '', ''],
      ['S4', '10.0.1.20', '255.255.255.0', '10.0.2.1', '', '']
    ])
    expect(r[0].errors[0]).toMatch(/not a valid IPv4/)
    expect(r[1].errors[0]).toMatch(/contiguous mask/)
    expect(r[2].errors[0]).toMatch(/network address/)
    expect(r[3].errors[0]).toMatch(/not in the same subnet/)
  })
  it('rejects IPs duplicated in the file or used by another AP', async () => {
    const r = await check(H, [
      ['S1', '10.0.1.20', '255.255.255.0', '10.0.1.1', '', ''],
      ['S2', '10.0.1.20', '255.255.255.0', '10.0.1.1', '', ''],
      ['S3', '10.0.0.11', '255.255.255.0', '10.0.0.1', '', '']
    ])
    expect(r[0].errors[0]).toMatch(/also used in row 2/)
    expect(r[2].errors[0]).toMatch(/IP 10\.0\.0\.11 is held by the AP in row 1, which has errors and will keep it/)
  })
  it('rejects an IP used by an AP that does not move off it', async () => {
    const [r] = await check(H, [['S1', '10.0.0.12', '255.255.255.0', '10.0.0.1', '', '']])
    expect(r.errors[0]).toMatch(/IP 10\.0\.0\.12 is already used by AP B/)
  })
  it('allows an IP shift chain (.11→.12 while .12→.13) and records who is written first', async () => {
    const r = await check(H, [
      ['S1', '10.0.0.12', '255.255.255.0', '10.0.0.1', '', ''],
      ['S2', '10.0.0.13', '255.255.255.0', '10.0.0.1', '', ''],
      ['S3', '10.0.0.15', '255.255.255.0', '10.0.0.1', '', ''] // .14 is held by D, which is not in the file
    ])
    expect(r.map((x) => x.status)).toEqual(['ready', 'ready', 'ready'])
    expect(r[0].waitsFor).toEqual([{ row: 2, reason: 'ip', value: '10.0.0.12' }])
    expect(r[1].waitsFor).toEqual([{ row: 3, reason: 'ip', value: '10.0.0.13' }])
    expect(r[2].waitsFor).toEqual([])
  })
  it('a holder switching to DHCP also frees its IP', async () => {
    const r = await check(H, [['S1', '10.0.0.12', '255.255.255.0', '10.0.0.1', '', ''], ['S2', 'DHCP', '', '', '', '']])
    expect(r[0].status).toBe('ready')
    expect(r[0].waitsFor[0]).toMatchObject({ row: 2, reason: 'ip' })
  })
  it('allows an IP swap (.11↔.12): the end state is unique', async () => {
    const r = await check(H, [['S1', '10.0.0.12', '255.255.255.0', '10.0.0.1', '', ''], ['S2', '10.0.0.11', '255.255.255.0', '10.0.0.1', '', '']])
    expect(r.map((x) => x.status)).toEqual(['ready', 'ready'])
  })
  it('scales to a 250-AP shift', async () => {
    const aps = Array.from({ length: 250 }, (_, i) => ap({ name: `AP${i}`, serial: `X${i}`, mac: (0xaabbcc000100 + i).toString(16), ip: `10.1.${Math.floor((i + 10) / 250)}.${(i + 10) % 250}` }))
    const rows = aps.map((a, i) => [a.serial, `10.1.${Math.floor((i + 11) / 250)}.${(i + 11) % 250}`, '255.255.0.0', '10.1.0.1', '', ''])
    // keep every address valid in /16 and off .0/.255 by construction
    const r = await check(H, rows, aps)
    expect(r.filter((x) => x.status === 'ready').length).toBe(250)
    expect(r.filter((x) => x.waitsFor.length === 1).length).toBe(249)
  })
  it('master must be IPv4', async () => {
    const r = await check(H, [['S1', '', '', '', '', 'mc.example.com'], ['S2', '', '', '', '', '10.9.9.9']])
    expect(r[0].errors[0]).toMatch(/must be an IPv4/)
    expect(r[1].requested.master).toBe('10.9.9.9')
  })
  it('warns (not errors) for an AP that is not Up', async () => {
    const [r] = await check(['Serial', 'Group'], [['S4', 'g']])
    expect(r.status).toBe('notup')
    expect(r.errors).toEqual([])
    expect(r.warnings[0]).toMatch(/down/)
  })
})

describe('runLivePreview', () => {
  const client = (prov) => ({
    listAccessPoints: async () => APS,
    getProvisioning: async (name) => prov[name] ?? { found: false }
  })
  const H = ['Serial', 'IP', 'Netmask', 'Gateway', 'Master']
  it('drops network/master values the AP already has, keeps unreadable ones', async () => {
    const file = await makeXlsx(H, [
      ['S1', '10.0.0.11', '255.255.255.0', '10.0.0.1', ''],
      ['S2', 'DHCP', '', '', '10.9.9.9'],
      ['S3', 'DHCP', '', '', '']
    ])
    const { rows, summary } = await runLivePreview(
      client({
        A: { found: true, ipMode: 'static', ip: '10.0.0.11', netmask: '255.255.255.0', gateway: '10.0.0.1', master: '' },
        B: { found: true, ipMode: 'dhcp', ip: '', master: '10.1.1.1' }
      }),
      file
    )
    expect(rows[0].status).toBe('nochange')
    expect(rows[1].requested).toEqual({ master: '10.9.9.9' })
    expect(rows[2].requested.network).toEqual({ mode: 'dhcp' }) // unreadable: assume it differs
    expect(summary).toMatchObject({ ready: 2, noChange: 1, unreadable: 1 })
  })
})

describe('runLivePreview at scale', () => {
  const N = 400
  const aps = Array.from({ length: N }, (_, i) =>
    ap({ name: `AP${i}`, serial: `Z${i}`, mac: (0xaabbcc100000 + i).toString(16), ip: `10.2.${Math.floor(i / 200)}.${(i % 200) + 2}` })
  )
  // half of them already have the master we ask for
  const prov = (i) => ({ found: true, ipMode: 'dhcp', ip: '', netmask: '', gateway: '', dns: '', master: i % 2 ? '10.9.9.9' : '10.1.1.1' })
  const makeClient = () => {
    const reads = []
    return {
      reads,
      listAccessPoints: async () => aps,
      getProvisioning: async (name) => {
        reads.push(name)
        return prov(Number(name.slice(2)))
      }
    }
  }
  const file = () => makeXlsx(['Serial', 'Master'], aps.map((a) => [a.serial, '10.9.9.9']))

  it('reads every AP (no 300 cap) and reports progress', async () => {
    const c = makeClient()
    const progress = []
    const { rows, summary } = await runLivePreview(c, await file(), { onProgress: (p) => progress.push(p) })
    expect(c.reads).toHaveLength(N)
    expect(summary).toMatchObject({ ready: N / 2, noChange: N / 2, unreadable: 0 })
    expect(rows.filter((r) => r.status === 'nochange').every((r) => Number(r.ap.name.slice(2)) % 2 === 1)).toBe(true)
    expect(progress.at(-1)).toEqual({ phase: 'details', done: N, total: N })
  })

  it('apply reuses "differs" reads and re-reads only rows that matched', async () => {
    const first = makeClient()
    const { provisioning } = await runLivePreview(first, await file())
    const again = makeClient()
    const { summary } = await runLivePreview(again, await file(), { known: provisioning })
    expect(again.reads).toHaveLength(N / 2) // only the "already matches" half
    expect(again.reads.every((n) => Number(n.slice(2)) % 2 === 1)).toBe(true)
    expect(summary).toMatchObject({ ready: N / 2, noChange: N / 2 })
  })
})

describe('AP group must exist on the controller', () => {
  const groupsClient = (groups) => ({
    listAccessPoints: async () => APS,
    getProvisioning: async () => ({ found: false }),
    listApGroups: async () => groups
  })
  it('rejects an unknown group, hints a case-only mismatch, warns on a master move', async () => {
    const file = await makeXlsx(['Serial', 'Group', 'Master'], [['S1', 'NOPE', ''], ['S2', 'test', ''], ['S3', 'TEST', ''], ['S4', 'FAR', '10.9.9.9']])
    const { rows } = await runLivePreview(groupsClient(['default', 'TEST']), file)
    expect(rows[0].errors[0]).toMatch(/AP Group "NOPE" does not exist on this controller\. Groups here: default, TEST/)
    expect(rows[1].errors[0]).toMatch(/Did you mean "TEST"\? \(names are case-sensitive\)/)
    expect(rows[2].status).toBe('ready')
    expect(rows[3].errors).toEqual([])
    expect(rows[3].warnings.some((w) => /must exist on the new controller 10\.9\.9\.9/.test(w))).toBe(true)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createArubaClient, createLock, forgetSession, parseFlagLegend, normalizeAp, parseApStatus, parseProvisioning, extractRows, buildProvisionPayload } from '../src/main/lib/arubaClient.js'
import { startMockController, makeAps } from '../scripts/mock-controller.mjs'

describe('parsing', () => {
  it('reads AP status and uptime', () => {
    expect(parseApStatus('Up 11m:19s')).toEqual({ status: 'up', uptime: '11m 19s' })
    expect(parseApStatus('Down')).toEqual({ status: 'down', uptime: '' })
    expect(parseApStatus('Rebooting')).toEqual({ status: 'rebooting', uptime: '' })
  })
  it('only trusts the provisioning section', () => {
    expect(parseProvisioning({ 'AP "x" Basic Information': [{ Item: 'IP Address', Value: '1.1.1.1' }] }).found).toBe(false)
    const p = parseProvisioning({
      'AP "x" Provisioning Parameters': [
        { Item: 'IP Address', Value: 'N/A' },
        { Item: 'Master', Value: '10.0.0.1' }
      ]
    })
    expect(p).toMatchObject({ found: true, ipMode: 'dhcp', master: '10.0.0.1', gateway: null })
  })
  it('skips _meta when finding rows', () => {
    expect(extractRows({ _meta: ['a'], 'AP Database': [{ Name: 'x' }] })).toEqual([{ Name: 'x' }])
  })
})

let mock
beforeAll(async () => {
  mock = await startMockController({ port: 0, aps: makeAps(5), rebootMs: 200 })
})
afterAll(() => mock?.server.close())

describe('against the mock controller (HTTPS, self-signed)', () => {
  const controller = () => ({ id: 'c1', ipAddress: '127.0.0.1', port: mock.port, username: 'admin', configNodePath: '/mm' })

  it('logs in, lists APs, and rejects a wrong password', async () => {
    forgetSession('c1')
    const c = createArubaClient(controller(), 'admin')
    const aps = await c.listAccessPoints()
    expect(aps).toHaveLength(5)
    expect(aps[0]).toMatchObject({ name: 'AP-001', serial: 'CNM100001', mac: '001a1e000001', status: 'up' })
    c.close()

    forgetSession('c2')
    const bad = createArubaClient({ ...controller(), id: 'c2' }, 'nope')
    await expect(bad.testConnection()).rejects.toThrow(/Login failed: Authentication failed/)
    bad.close()
  })

  it('shares one login between concurrent requests', async () => {
    forgetSession('c3')
    const c = createArubaClient({ ...controller(), id: 'c3' }, 'admin')
    const [a, b] = await Promise.all([c.listAccessPoints(), c.listAccessPoints()])
    expect(a.length).toBe(b.length)
    c.close()
  })

  it('provisions an AP and the change shows up after its reboot', async () => {
    forgetSession('c4')
    const c = createArubaClient({ ...controller(), id: 'c4' }, 'admin')
    const target = (await c.listAccessPoints()).find((a) => a.serial === 'CNM100002') // found by serial, like a job
    await c.provision(target, { name: 'Lobby-02', network: { mode: 'static', ip: '10.30.0.5', netmask: '255.255.255.0', gateway: '10.30.0.1' } })
    expect((await c.listAccessPoints()).find((a) => a.serial === 'CNM100002').status).toBe('rebooting')
    await new Promise((r) => setTimeout(r, 300))
    const after = (await c.listAccessPoints()).find((a) => a.serial === 'CNM100002')
    expect(after).toMatchObject({ name: 'Lobby-02', ip: '10.30.0.5', status: 'up' })
    expect(await c.getProvisioning(after)).toMatchObject({ found: true, ipMode: 'static', ip: '10.30.0.5', gateway: '10.30.0.1' })
    c.close()
  })

  it('reports which part the controller rejected', async () => {
    forgetSession('c5')
    const c = createArubaClient({ ...controller(), id: 'c5' }, 'admin')
    await expect(c.provision({ serial: 'NOPE', mac: 'aabbccddeeff', ip: '10.9.9.9' }, { group: 'g' })).rejects.toThrow(/rejected read_bootinfo: AP not found/)
    c.close()
  })
})

describe('real AOS 8.13.3.1 output (lab controller)', () => {
  it('reads the provisioning section, including "Conductor" and "IP Addr"', () => {
    const p = parseProvisioning({
      'AP ZNC-TMP-AP01 Basic Information': [{ Item: 'AP IP Address', Value: '172.31.254.250' }],
      'AP ZNC-TMP-AP01 Provisioning Parameters': [
        { Item: 'AP Name', Value: 'ZNC-TMP-AP01' },
        { Item: 'AP Group', Value: 'default' },
        { Item: 'Conductor', Value: '172.31.254.99' },
        { Item: 'Gateway', Value: 'N/A' },
        { Item: 'Netmask', Value: 'N/A' },
        { Item: 'IP Addr', Value: 'N/A' },
        { Item: 'DNS IP', Value: 'N/A' },
        { Item: 'Server IP', Value: '172.31.254.99' }
      ]
    })
    expect(p).toMatchObject({ found: true, ipMode: 'dhcp', ip: '', netmask: '', gateway: '', dns: '', master: '172.31.254.99' })
  })
})

describe('AP flags (real AOS 8.13.3.1 output, MAINLAB-WLC-1)', () => {
  const data = {
    _data: [
      'Flags: 1 = 802.1x authenticated AP use EAP-PEAP;   1+ = 802.1x use EST;    1- = 802.1x use factory cert',
      '2 = Using IKE version 2;                    4 = WiFi Uplink',
      'B = Built-in AP;                            C = Cellular RAP;       D = Dirty or no config',
      'G = No such group;        I = Inactive;     J = USB cert at AP;     L = Unlicensed',
      'N = Duplicate name;       P = PPPoe AP;     R = Remote AP;          R- = Remote AP requires Auth',
      'u = Custom-Cert RAP;           z = Datazone AP',
      '4'
    ]
  }
  it('parses the legend, including two-character flags like 1+ and R-', () => {
    const l = parseFlagLegend(data)
    expect(l).toMatchObject({
      1: '802.1x authenticated AP use EAP-PEAP',
      '1+': '802.1x use EST',
      '1-': '802.1x use factory cert',
      2: 'Using IKE version 2',
      4: 'WiFi Uplink',
      D: 'Dirty or no config',
      G: 'No such group',
      L: 'Unlicensed',
      N: 'Duplicate name',
      'R-': 'Remote AP requires Auth',
      z: 'Datazone AP'
    })
    expect(Object.keys(l)).not.toContain('4\n')
  })
  it('reads each AP\'s Flags column', () => {
    expect(normalizeAp({ Name: 'ZNC-TEMP-AP01', Flags: 'N2', Status: 'Down' }).flags).toBe('N2')
    expect(normalizeAp({ Name: 'x', Status: 'Up 1m' }).flags).toBe('')
  })
})

describe('buildProvisionPayload (field names verified on AOS 8.13.3.1)', () => {
  const AP = { name: 'ZNC-TEMP-AP02', serial: 'CNDPJ0T6DX', mac: '20a6cdc80bac', ip: '192.168.222.72' }
  it('static IP uses ipaddr / netmask / gatewayip / dnsip', () => {
    const p = buildProvisionPayload(AP, { name: 'N', network: { mode: 'static', ip: '10.0.0.5', netmask: '255.255.255.0', gateway: '10.0.0.1', dns: '8.8.8.8' } })
    expect(p.ap_prov).toMatchObject({
      ap_name: { _action: 'modify', 'ap-name': 'N' },
      ap_group: { _action: 'noop' },
      ipaddr: { _action: 'modify', ipaddr: '10.0.0.5' },
      netmask: { _action: 'modify', netmask: '255.255.255.0' },
      gatewayip: { _action: 'modify', gateway: '10.0.0.1' },
      dnsip: { _action: 'modify', 'dns-server-ip': '8.8.8.8' },
      master: { _action: 'noop' },
      serverip: { _action: 'noop' }
    })
    expect(Object.keys(p)).toEqual(['read_bootinfo', 'copy_provisioning_params', 'ap_prov', 'ap_reprovision'])
  })
  it('addresses the AP by MAC / IP / serial, never by name (only keys AOS accepts for each call)', () => {
    const p = buildProvisionPayload(AP, { name: 'N' })
    expect(p.read_bootinfo).toEqual({ 'wired-mac': '20:a6:cd:c8:0b:ac' }) // AOS wants XX:XX:XX:XX:XX:XX
    expect(p.copy_provisioning_params).toEqual({ 'ip-addr': '192.168.222.72' })
    expect(p.ap_reprovision).toEqual({ 'serial-num': 'CNDPJ0T6DX' })
    expect(JSON.stringify([p.read_bootinfo, p.copy_provisioning_params, p.ap_reprovision])).not.toContain('ap-name')
  })
  it('writes nothing for an AP without serial, MAC or IP', () => {
    expect(() => buildProvisionPayload({ ...AP, serial: '' }, { name: 'N' })).toThrow(/no Serial Number\. Nothing was written/)
    expect(() => buildProvisionPayload({ ...AP, mac: '' }, { name: 'N' })).toThrow(/no wired MAC/)
    expect(() => buildProvisionPayload({ ...AP, ip: '' }, { name: 'N' })).toThrow(/no IP address/)
  })
  it('DHCP deletes the four static fields; master sets master and server-ip', () => {
    const d = buildProvisionPayload(AP, { network: { mode: 'dhcp' } }).ap_prov
    for (const k of ['ipaddr', 'netmask', 'gatewayip', 'dnsip']) expect(d[k]).toEqual({ _action: 'delete' })
    const m = buildProvisionPayload(AP, { master: '10.9.9.9' }).ap_prov
    expect(m.master).toEqual({ _action: 'modify', master: '10.9.9.9' })
    expect(m.serverip).toEqual({ _action: 'modify', 'server-ip': '10.9.9.9' })
  })
})

describe('a controller that silently ignores a field', () => {
  let strict
  beforeAll(async () => {
    strict = await startMockController({ port: 0, aps: makeAps(3), rebootMs: 200, ignoreFields: ['ipaddr'] })
  })
  afterAll(() => strict?.server.close())
  it('fails before the reboot and leaves the AP untouched', async () => {
    forgetSession('strict')
    const c = createArubaClient({ id: 'strict', ipAddress: '127.0.0.1', port: strict.port, username: 'admin' }, 'admin')
    const target = (await c.listAccessPoints()).find((a) => a.serial === 'CNM100001')
    await expect(
      c.provision(target, { name: 'X', network: { mode: 'static', ip: '10.30.0.5', netmask: '255.255.255.0', gateway: '10.30.0.1' } })
    ).rejects.toMatchObject({ beforeReboot: true, message: expect.stringMatching(/ap_prov\.ipaddr: not recognized by this controller/) })
    const ap = (await c.listAccessPoints()).find((a) => a.serial === 'CNM100001')
    expect(ap).toMatchObject({ name: 'AP-001', status: 'up' })
    c.close()
  })
})

describe('source interface binding', () => {
  let m
  beforeAll(async () => {
    m = await startMockController({ port: 0, aps: makeAps(2), rebootMs: 200 })
  })
  afterAll(() => m?.server.close())
  it('connects from the bound address', async () => {
    forgetSession('bind1')
    const c = createArubaClient({ id: 'bind1', ipAddress: '127.0.0.1', port: m.port, username: 'admin' }, 'admin', { localAddress: '127.0.0.1', via: 'Loopback (lo0)' })
    expect(await c.listAccessPoints()).toHaveLength(2)
    c.close()
  })
  it('explains an address the computer no longer has', async () => {
    forgetSession('bind2')
    const c = createArubaClient({ id: 'bind2', ipAddress: '127.0.0.1', port: m.port, username: 'admin' }, 'admin', { localAddress: '10.255.255.254', via: 'LAN (en7)' })
    await expect(c.testConnection()).rejects.toThrow(/source interface LAN \(en7\) lost its IP address/)
    c.close()
  })
  it('follows the interface to its new address (Wi-Fi reconnect mid-job)', async () => {
    forgetSession('bind3')
    let addr = '10.255.255.254' // the address the interface had when the job started
    const c = createArubaClient({ id: 'bind3', ipAddress: '127.0.0.1', port: m.port, username: 'admin' }, 'admin', { localAddress: () => addr, via: 'Wi-Fi (en0)' })
    await expect(c.listAccessPoints()).rejects.toThrow(/lost its IP address/)
    addr = null // disconnected: no address at all, must not fall back to system routing
    await expect(c.listAccessPoints()).rejects.toThrow(/source interface Wi-Fi \(en0\) lost its IP address/)
    expect(c.localAddress).toBeNull()
    addr = '127.0.0.1' // reconnected with a new address
    expect(await c.listAccessPoints()).toHaveLength(2)
    expect(c.localAddress).toBe('127.0.0.1')
    c.close()
  })
})

describe('shared provisioning list (jobs side by side)', () => {
  let m
  beforeAll(async () => {
    m = await startMockController({ port: 0, aps: makeAps(3), rebootMs: 200 })
  })
  afterAll(() => m?.server.close())
  const client = (id) => createArubaClient({ id, ipAddress: '127.0.0.1', port: m.port, username: 'admin' }, 'admin')
  const ap = (aps, serial) => aps.find((a) => a.serial === serial)

  it('two clients on one controller take turns on the shared list (two jobs at once)', async () => {
    const lock = createLock()
    const a = createArubaClient({ id: 'g1', ipAddress: '127.0.0.1', port: m.port, username: 'admin' }, 'admin', { provisionLock: lock })
    const b = createArubaClient({ id: 'g2', ipAddress: '127.0.0.1', port: m.port, username: 'admin' }, 'admin', { provisionLock: lock })
    const list = await a.listAccessPoints()
    await Promise.all([a.provision(ap(list, 'CNM100001'), { name: 'G1' }), b.provision(ap(list, 'CNM100002'), { name: 'G2' })])
    await new Promise((r) => setTimeout(r, 300))
    const aps = await a.listAccessPoints()
    expect(ap(aps, 'CNM100001').name).toBe('G1')
    expect(ap(aps, 'CNM100002').name).toBe('G2')
    await Promise.all([a.close(), b.close()])
  })

  it('the lock runs one function at a time and survives a failure', async () => {
    const lock = createLock()
    const order = []
    const job = (n, fail) => lock(async () => {
      order.push(`start${n}`)
      await new Promise((r) => setTimeout(r, 10))
      order.push(`end${n}`)
      if (fail) throw new Error('x')
    })
    await Promise.allSettled([job(1, true), job(2)])
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2'])
  })

  it('logs out on close and does not count this computer as "someone else"', async () => {
    const before = m.sessionCount()
    const c = client('g3')
    await c.listAccessPoints()
    expect(m.sessionCount()).toBe(before + 1)
    expect(await c.otherSessions()).toEqual([]) // every session here comes from 127.0.0.1 = us
    await c.close()
    expect(m.sessionCount()).toBe(before)
  })
})

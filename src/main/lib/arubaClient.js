// Talks to the ArubaOS 8.x REST API. Runs only in the main process: controllers use
// self-signed certificates, so TLS verification is off and must never reach the renderer.
import https from 'node:https'
import { normalizeMac } from './macAddress.js'

const CONNECT_TIMEOUT_MS = 3000
const REQUEST_TIMEOUT_MS = 8000
const SESSION_TTL_MS = 15 * 60 * 1000

export class ArubaError extends Error {
  constructor(message, { code, status } = {}) {
    super(message)
    this.name = 'ArubaError'
    this.code = code
    this.status = status
  }
}

/**
 * Kept for callers that reset a controller's login (edit/delete). Each client now owns its
 * session and logs out on close(), so there is nothing shared to forget.
 */
export function forgetSession() {}

const IDLE_ACTIVE_S = 120 // another session idle less than this counts as "in use"
const parseIdle = (t) => String(t || '').split(':').reduce((acc, x) => acc * 60 + (Number(x) || 0), 0)

function rawRequest({ host, port, method, path, headers, body, agent, localAddress, via }) {
  return new Promise((resolve, reject) => {
    let connected = false
    let local = null // our side of the socket, as the controller sees it
    const req = https.request(
      { host, port, method, path, headers, agent, localAddress, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            localAddress: local
          })
        )
        res.on('error', reject)
      }
    )
    const connectTimer = setTimeout(() => {
      if (!connected) req.destroy(new ArubaError(`Could not connect to ${host}:${port} within 3 seconds.`, { code: 'ECONNECT' }))
    }, CONNECT_TIMEOUT_MS)
    req.on('socket', (socket) => {
      const up = () => {
        connected = true
        local = socket.localAddress || local
      }
      if (!socket.connecting) up()
      socket.once('secureConnect', up)
      socket.once('connect', up)
    })
    req.on('timeout', () =>
      req.destroy(new ArubaError(`The controller did not answer within 8 seconds.`, { code: 'ETIMEOUT' }))
    )
    req.on('error', (err) => {
      clearTimeout(connectTimer)
      reject(err instanceof ArubaError ? err : new ArubaError(describeNetError(err, host, port, via), { code: err.code }))
    })
    req.on('close', () => clearTimeout(connectTimer))
    if (body) req.write(body)
    req.end()
  })
}

function describeNetError(err, host, port, via) {
  switch (err.code) {
    case 'ECONNREFUSED':
      return `Connection refused by ${host}:${port}.`
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return via ? `${host} is not reachable through ${via}. Pick another source interface in the header.` : `${host} is unreachable from this computer.`
    case 'EADDRNOTAVAIL':
      return `The source interface ${via || ''} lost its IP address. Pick another one in the header.`
    case 'ENOTFOUND':
      return `Host ${host} was not found.`
    default:
      return err.message || String(err)
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function statusOk(s) {
  return s === 0 || s === '0'
}

/**
 * Creates a client for one controller.
 * @param {{id:string, ipAddress:string, port:number, configNodePath?:string, username:string}} controller
 * @param {string} password decrypted password, kept only in memory
 */
export function createArubaClient(controller, password, { localAddress, via } = {}) {
  const host = controller.ipAddress
  const port = controller.port || 4343
  const net = { localAddress, via } // source interface binding (undefined = system routing)
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 6 })

  async function login() {
    const body = new URLSearchParams({ username: controller.username, password }).toString()
    const res = await rawRequest({
      host,
      port,
      agent,
      ...net,
      method: 'POST',
      path: '/v1/api/login',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      body
    })
    const json = parseJson(res.body)
    const result = json?._global_result
    if (res.status !== 200 || !result || !statusOk(result.status) || !result.UIDARUBA) {
      const reason = result?.status_str || `HTTP ${res.status}`
      throw new ArubaError(`Login failed: ${reason}`, { code: 'ELOGIN', status: res.status })
    }
    const cookie = [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ')
    return {
      token: result.UIDARUBA,
      // AOS 8.10+ also returns a CSRF token that configuration writes must echo back.
      csrf: result['X-CSRF-Token'] || null,
      cookie: cookie || `SESSION=${result.UIDARUBA}`,
      expiresAt: Date.now() + SESSION_TTL_MS
    }
  }

  // One session per client (the window's and each job's), logged out on close() so the
  // controller doesn't collect idle API sessions. Single-flight: concurrent callers share a login.
  let current = null // { token, cookie, csrf, expiresAt } | { pending }
  let localIp = localAddress || null // our address as the controller sees it

  async function session(force = false) {
    if (!force && current?.pending) return current.pending
    if (!force && current?.token && current.expiresAt > Date.now()) return current
    const old = !current?.pending ? current : null
    const pending = login().then(
      (s) => {
        current = s
        return s
      },
      (err) => {
        current = null
        throw err
      }
    )
    current = { pending }
    if (old?.token) logout(old)
    return pending
  }

  function logout(s) {
    return rawRequest({
      host,
      port,
      agent,
      ...net,
      method: 'GET',
      path: `/v1/api/logout?${new URLSearchParams({ UIDARUBA: s.token })}`,
      headers: { Cookie: s.cookie, Accept: 'application/json' }
    }).catch(() => {})
  }

  async function call(method, path, { query = {}, json } = {}, retried = false) {
    const s = await session()
    const qs = new URLSearchParams({ ...query, UIDARUBA: s.token }).toString()
    const body = json ? JSON.stringify(json) : undefined
    const res = await rawRequest({
      host,
      port,
      agent,
      ...net,
      method,
      path: `${path}?${qs}`,
      headers: {
        Cookie: s.cookie,
        Accept: 'application/json',
        ...(s.csrf && method !== 'GET' ? { 'X-CSRF-Token': s.csrf } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
      },
      body
    })
    if (res.localAddress) localIp = res.localAddress.replace(/^::ffff:/, '')
    if (res.status === 401 && !retried) {
      await session(true)
      return call(method, path, { query, json }, true)
    }
    if (res.status === 401) {
      throw new ArubaError(
        'The controller rejected the request (401). If this controller needs a Config Node Path (e.g. /mm/mynode), set it in Edit.',
        { code: 'EAUTH', status: 401 }
      )
    }
    if (res.status !== 200) throw new ArubaError(`The controller answered HTTP ${res.status}.`, { status: res.status })
    const data = parseJson(res.body)
    if (data === null) throw new ArubaError('The controller sent a response that is not JSON.')
    return data
  }

  async function showCommand(command) {
    return call('GET', '/v1/configuration/showcommand', { query: { command } })
  }

  /** POSTs configuration objects. HTTP 200 is not success: every item must carry _result.status = 0. */
  async function postObjects(objects) {
    const query = controller.configNodePath ? { config_path: controller.configNodePath } : {}
    const data = await call('POST', '/v1/configuration/object', { query, json: objects })
    const rejected = []
    for (const [key, sent] of Object.entries(objects)) {
      const r = data?.[key]?._result
      if (!r || !statusOk(r.status)) rejected.push(`${key}${r?.status_str ? `: ${r.status_str}` : ''}`)
      // Nested fields: the controller silently ignores names it doesn't know (no _result at all),
      // so every field we asked to modify/delete must come back with its own status 0.
      for (const [sub, val] of Object.entries(sent || {})) {
        if (!val || typeof val !== 'object' || !['modify', 'delete'].includes(val._action)) continue
        const sr = data?.[key]?.[sub]?._result
        if (!sr) rejected.push(`${key}.${sub}: not recognized by this controller`)
        else if (!statusOk(sr.status)) rejected.push(`${key}.${sub}: ${sr.status_str || 'rejected'}`)
      }
    }
    const g = data?._global_result
    if (g && !statusOk(g.status) && rejected.length === 0) rejected.push(g.status_str || '_global_result')
    if (rejected.length) throw new ArubaError(`The controller rejected ${rejected.join(', ')}`, { code: 'EREJECTED' })
    return data
  }

  return {
    host,
    port,
    via,
    localAddress,

    async testConnection() {
      await session(true)
      return true
    },

    /** `show ap database long`, normalized. */
    async listAccessPoints() {
      const data = await showCommand('show ap database long')
      return extractRows(data).map(normalizeAp)
    },

    /** AP group names defined on this controller (`show ap-group`). */
    async listApGroups() {
      return extractRows(await showCommand('show ap-group'))
        .map((r) => pick(r, 'Name'))
        .filter(Boolean)
    },

    /** Provisioning values actually stored on the AP, or null fields when unreadable. */
    async getProvisioning(apName) {
      const data = await showCommand(`show ap details ap-name ${apName}`)
      return parseProvisioning(data)
    },

    /**
     * Back-to-back calls for one AP: select it, stage the new values, check the staging is ours,
     * then reprovision (the AP reboots).
     * - Staging is checked field by field first, so a value the controller ignored or refused
     *   never reboots the AP with half the change.
     * - The controller's provisioning list is shared by every session (another Zeta, the WebUI):
     *   right before the reboot we read it back and require exactly our AP with exactly our
     *   values. If someone else is using it, nothing is rebooted (one retry after 3 s).
     */
    async provision(ap, requested) {
      const { ap_reprovision, ...staging } = buildProvisionPayload(ap, requested)
      let conflict = ''
      for (let attempt = 1; attempt <= 2; attempt++) {
        await postObjects({
          clear_provisioning_ap_list: {},
          read_bootinfo: { 'ap-name': ap.name }
        })
        try {
          await postObjects(staging)
        } catch (err) {
          if (err.code === 'EREJECTED') err.message += '. The AP was not rebooted and nothing changed.'
          throw err
        }
        conflict = await stagingConflict(ap, requested)
        if (!conflict) {
          await postObjects({ ap_reprovision })
          return
        }
        if (attempt === 1) await new Promise((r) => setTimeout(r, 3000))
      }
      throw new ArubaError(
        `Another session is using this controller's provisioning list right now (another Zeta or the WebUI): ${conflict}. The AP was not rebooted.`,
        { code: 'ECONFLICT' }
      )
    },

    /** Other people active on the controller right now (not this computer), from `show loginsessions`. */
    async otherSessions() {
      const rows = extractRows(await showCommand('show loginsessions'))
      return rows
        .map((r) => ({ from: pick(r, 'Connection From'), user: pick(r, 'User Name'), idleS: parseIdle(pick(r, 'Idle Time')) }))
        .filter((x) => x.from && x.from !== localIp && x.idleS < IDLE_ACTIVE_S)
    },

    /** Logs out (best effort) and frees the sockets. */
    async close() {
      const s = current?.token ? current : null
      current = null
      if (s) await Promise.race([logout(s), new Promise((r) => setTimeout(r, 1500))])
      agent.destroy()
    }
  }

  /** '' when the shared list holds only our AP with exactly our staged values, else why not. */
  async function stagingConflict(ap, requested) {
    const list = extractRows(await showCommand('show provisioning-ap-list'))
    const serials = list.map((r) => pick(r, 'Serial #', 'Serial'))
    if (list.length !== 1 || (ap.serial && serials[0] !== ap.serial)) {
      return `the list holds ${list.length ? serials.join(', ') : 'nothing'} instead of only ${ap.serial || ap.name}`
    }
    const p = stagedParams(await showCommand('show provisioning-params'))
    const want = {
      'AP Name': requested.name || ap.name,
      ...(requested.group ? { 'AP Group': requested.group } : {}),
      ...(requested.network?.mode === 'static'
        ? { 'IP Addr': requested.network.ip, Netmask: requested.network.netmask, Gateway: requested.network.gateway }
        : requested.network?.mode === 'dhcp'
          ? { 'IP Addr': '' }
          : {}),
      ...(requested.network?.dns ? { 'DNS IP': requested.network.dns } : {}),
      ...(requested.master ? { Conductor: requested.master } : {})
    }
    for (const [k, v] of Object.entries(want)) {
      const got = (k === 'Conductor' ? (p.Conductor ?? p.Master) : p[k]) ?? '' // "Master" before AOS 8.10
      if (got !== v) return `staged ${k} is "${got || 'N/A'}", expected "${v || 'N/A'}"`
    }
    return ''
  }
}

/** `show provisioning-params` → { 'AP Name': …, 'IP Addr': '' (for N/A), … } */
export function stagedParams(data) {
  const out = {}
  for (const row of extractRows(data)) {
    const k = row.Parameter ?? row.Item
    if (k === undefined) continue
    const v = String(row.Value ?? '').trim()
    out[String(k).trim()] = UNSET.has(v.toLowerCase()) ? '' : v
  }
  return out
}

// ---------------------------------------------------------------------------
// Payload for the write. Field names verified against a real ArubaOS 8.13.3.1 controller
// (staged with `show provisioning-params`): the controller silently ignores sub-objects it
// doesn't know, so every name here was checked, not guessed.
//   ap_name{ap-name}  ap_group{ap-group}  ipaddr{ipaddr}  netmask{netmask}
//   gatewayip{gateway}  dnsip{dns-server-ip}  master{master}  serverip{server-ip}
// Unchanged fields are "noop"; switching to DHCP deletes the four static fields; a master
// change sets master and server-ip to the same value.
// ---------------------------------------------------------------------------
export const PROV_FIELDS = {
  name: ['ap_name', 'ap-name'],
  group: ['ap_group', 'ap-group'],
  ip: ['ipaddr', 'ipaddr'],
  netmask: ['netmask', 'netmask'],
  gateway: ['gatewayip', 'gateway'],
  dns: ['dnsip', 'dns-server-ip'],
  master: ['master', 'master'],
  serverIp: ['serverip', 'server-ip']
}

export function buildProvisionPayload(ap, requested) {
  const prov = {}
  const put = (field, action, value) => {
    const [obj, key] = PROV_FIELDS[field]
    prov[obj] = action === 'modify' ? { _action: 'modify', [key]: value } : { _action: action }
  }
  const net = requested.network
  requested.name ? put('name', 'modify', requested.name) : put('name', 'noop')
  requested.group ? put('group', 'modify', requested.group) : put('group', 'noop')
  if (net?.mode === 'dhcp') {
    for (const f of ['ip', 'netmask', 'gateway', 'dns']) put(f, 'delete')
  } else if (net?.mode === 'static') {
    put('ip', 'modify', net.ip)
    put('netmask', 'modify', net.netmask)
    put('gateway', 'modify', net.gateway)
    net.dns ? put('dns', 'modify', net.dns) : put('dns', 'noop')
  } else {
    for (const f of ['ip', 'netmask', 'gateway', 'dns']) put(f, 'noop')
  }
  if (requested.master) {
    put('master', 'modify', requested.master)
    put('serverIp', 'modify', requested.master)
  } else {
    put('master', 'noop')
    put('serverIp', 'noop')
  }
  return {
    copy_provisioning_params: { 'ap-name': ap.name },
    ap_prov: prov,
    ap_reprovision: { 'ap-name': ap.name }
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/** First array of row objects in a showcommand response (skips _meta/_data). */
export function extractRows(data) {
  if (!data || typeof data !== 'object') return []
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('_')) continue
    if (Array.isArray(value) && value.every((r) => r && typeof r === 'object')) return value
  }
  return []
}

function pick(row, ...names) {
  const keys = Object.keys(row)
  for (const name of names) {
    const k = keys.find((x) => x.toLowerCase() === name.toLowerCase())
    if (k !== undefined && row[k] !== null && row[k] !== undefined) return String(row[k]).trim()
  }
  return ''
}

/** "Up 11m:19s" -> { status: 'up', uptime: '11m 19s' } */
export function parseApStatus(text) {
  const t = String(text || '').trim()
  const m = t.match(/^(\w+)\s*(.*)$/)
  const word = (m?.[1] || '').toLowerCase()
  const rest = (m?.[2] || '').replace(/:/g, ' ').replace(/\s+/g, ' ').trim()
  const status = ['up', 'down', 'rebooting', 'upgrading'].includes(word) ? word : word || 'unknown'
  return { status, uptime: status === 'up' && rest ? rest : '' }
}

export function normalizeAp(row) {
  const statusText = pick(row, 'Status')
  const { status, uptime } = parseApStatus(statusText)
  const ip = pick(row, 'IP Address', 'IP Addr', 'IP')
  return {
    name: pick(row, 'Name', 'AP Name'),
    group: pick(row, 'Group', 'AP Group'),
    model: pick(row, 'AP Type', 'Model', 'Type'),
    ip: ip === '0.0.0.0' ? '' : ip,
    status,
    statusText,
    uptime,
    mac: normalizeMac(pick(row, 'Wired MAC Address', 'MAC Address', 'MAC', 'Ethernet MAC')) || '',
    serial: pick(row, 'Serial #', 'Serial Number', 'Serial', 'SN'),
    switchIp: pick(row, 'Switch IP')
  }
}

const UNSET = new Set(['', 'n/a', 'na', 'none', '-', '0.0.0.0'])

/**
 * Pulls the provisioned values out of `show ap details`. Only the provisioning section is
 * trusted; when it can't be found every field is null, and the caller treats null as "differs".
 */
export function parseProvisioning(data) {
  const out = { found: false, ipMode: null, ip: null, netmask: null, gateway: null, dns: null, master: null }
  if (!data || typeof data !== 'object') return out
  const section = Object.entries(data).find(([k]) => /provision/i.test(k))?.[1]
  if (!section) return out

  const map = new Map()
  const add = (k, v) => map.set(String(k).trim().toLowerCase(), String(v ?? '').trim())
  if (Array.isArray(section)) {
    for (const row of section) {
      if (!row || typeof row !== 'object') continue
      const item = row.Item ?? row.Parameter ?? row.Name
      if (item !== undefined) add(item, row.Value)
      else for (const [k, v] of Object.entries(row)) add(k, v)
    }
  } else {
    for (const [k, v] of Object.entries(section)) add(k, v)
  }
  if (map.size === 0) return out
  out.found = true

  const get = (...names) => {
    for (const n of names) if (map.has(n)) return map.get(n)
    return undefined
  }
  const val = (v) => (v === undefined ? null : UNSET.has(v.toLowerCase()) ? '' : v)

  const ip = val(get('ip address', 'ip addr', 'ip-addr', 'static ip'))
  out.ip = ip
  out.netmask = val(get('subnet mask', 'netmask', 'subnet-mask'))
  out.gateway = val(get('gateway', 'gateway ip', 'default gateway'))
  out.dns = val(get('dns server', 'dns-server-ip', 'dns server ip', 'dns ip'))
  // AOS 8.10+ renamed "Master" to "Conductor" (seen on 8.13.3.1)
  out.master = val(get('conductor', 'master', 'master ip', 'server ip', 'lms ip'))
  out.ipMode = ip === null ? null : ip === '' ? 'dhcp' : 'static'
  return out
}

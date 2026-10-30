// A fake ArubaOS 8 controller for trying Zeta without hardware.
//   node scripts/mock-controller.mjs [--port 4343] [--aps 60] [--reboot 20]
// Then add a controller in Zeta: IP 127.0.0.1, port 4343, user admin, password admin.
// It mirrors the payload Zeta sends, so it proves the app's plumbing, not compatibility with a real controller.
import https from 'node:https'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Throwaway self-signed cert for 127.0.0.1, committed so the mock runs on Windows without openssl.
// Never use it for anything else.
export function ensureCert(dir = join(ROOT, 'scripts', 'mock-cert')) {
  return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }
}

export function makeAps(n) {
  const models = ['AP-515', 'AP-535', 'AP-505', 'AP-635']
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1
    const hex = k.toString(16).padStart(6, '0')
    return {
      name: `AP-${String(k).padStart(3, '0')}`,
      group: k % 3 === 0 ? 'lobby' : k % 3 === 1 ? 'office' : 'warehouse',
      model: models[i % models.length],
      ip: `10.20.${Math.floor(k / 250)}.${(k % 250) + 2}`,
      mac: `00:1a:1e:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}`,
      serial: `CNM${String(100000 + k)}`,
      status: k % 17 === 0 ? 'down' : 'up',
      upSince: Date.now() - (k * 97_000),
      prov: { mode: 'dhcp', ip: '', netmask: '', gateway: '', dns: '', master: '10.20.0.1' },
      flags: k % 11 === 0 ? '1+2D' : k % 7 === 0 ? 'N2' : '2'
    }
  })
}

export function startMockController({ port = 4343, aps = makeAps(60), rebootMs = 20_000, username = 'admin', password = 'admin', ignoreFields = [] } = {}) {
  const sessions = new Map() // token -> { from, lastAt, startedAt }
  let selected = null

  const fmtUptime = (ms) => {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
    return h ? `${h}h:${m}m:${s % 60}s` : `${m}m:${s % 60}s`
  }
  const statusText = (a) => {
    if (a.rebootUntil && Date.now() < a.rebootUntil) return 'Rebooting'
    if (a.rebootUntil) {
      Object.assign(a, a.pendingApply || {})
      a.rebootUntil = null
      a.pendingApply = null
      a.upSince = Date.now()
    }
    return a.status === 'up' ? `Up ${fmtUptime(Date.now() - a.upSince)}` : 'Down'
  }

  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
  const authed = (req, url) => {
    const token = url.searchParams.get('UIDARUBA')
    const ok = token && sessions.has(token) && (req.headers.cookie || '').includes(`SESSION=${token}`)
    if (ok) sessions.get(token).lastAt = Date.now()
    return ok
  }
  const hms = (ms) => { const t = Math.floor(ms / 1000); return [t / 3600, (t % 3600) / 60, t % 60].map((x) => String(Math.floor(x)).padStart(2, '0')).join(':') }
  const ok = (extra = {}) => ({ _result: { status: 0, status_str: 'Success' }, ...extra })

  const server = https.createServer(ensureCert(), (req, res) => {
    const url = new URL(req.url, 'https://mock')
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.method === 'POST' && url.pathname === '/v1/api/login') {
        const p = new URLSearchParams(body)
        if (p.get('username') !== username || p.get('password') !== password) {
          return send(res, 200, { _global_result: { status: '1', status_str: 'Authentication failed' } })
        }
        const token = randomBytes(16).toString('hex')
        sessions.set(token, { from: req.socket.remoteAddress.replace(/^::ffff:/, ''), lastAt: Date.now(), startedAt: Date.now() })
        return send(res, 200, { _global_result: { status: '0', status_str: "You've logged in successfully.", UIDARUBA: token } }, {
          'Set-Cookie': `SESSION=${token}; Path=/; Secure; HttpOnly`
        })
      }
      if (!authed(req, url)) return send(res, 401, { error: 'unauthorized' })
      if (url.pathname === '/v1/api/logout') {
        sessions.delete(url.searchParams.get('UIDARUBA'))
        return send(res, 200, { _global_result: { status: '0', status_str: "You've logged out successfully." } })
      }

      if (req.method === 'GET' && url.pathname === '/v1/configuration/showcommand') {
        const cmd = url.searchParams.get('command') || ''
        if (cmd === 'show ap database long') {
          return send(res, 200, {
            'AP Database': aps.map((a) => ({
              Status: statusText(a), // first: it applies a finished reboot's new values
              Name: a.name,
              Group: a.group,
              'AP Type': a.model,
              'IP Address': a.status === 'up' || a.rebootUntil ? a.ip : '0.0.0.0',
              Flags: a.flags || '',
              'Switch IP': '127.0.0.1',
              'Wired MAC Address': a.mac,
              'Serial #': a.serial
            })),
            _meta: ['Name', 'Group', 'AP Type', 'IP Address', 'Status', 'Flags', 'Switch IP', 'Wired MAC Address', 'Serial #'],
            // legend as AOS 8.13.3.1 sends it (shortened)
            _data: [
              'Flags: 1 = 802.1x authenticated AP use EAP-PEAP;   1+ = 802.1x use EST;    1- = 802.1x use factory cert',
              '2 = Using IKE version 2;                    4 = WiFi Uplink',
              'B = Built-in AP;                            C = Cellular RAP;       D = Dirty or no config',
              'G = No such group;        I = Inactive;     J = USB cert at AP;     L = Unlicensed',
              'N = Duplicate name;       P = PPPoe AP;     R = Remote AP;          R- = Remote AP requires Auth',
              String(aps.length)
            ]
          })
        }
        if (cmd === 'show ap-group') {
          const names = [...new Set(['default', 'NoAuthApGroup', ...aps.map((a) => a.group)])]
          return send(res, 200, { 'AP group List': names.map((Name) => ({ Name, 'Profile Status': null })) })
        }
        if (cmd === 'show loginsessions') {
          return send(res, 200, {
            'Session Table': [...sessions.entries()].map(([, v], i) => ({
              'Connection From': v.from, ID: String(i + 1), 'Idle Time': hms(Date.now() - v.lastAt), Path: '/', 'Session Time': hms(Date.now() - v.startedAt), 'User Name': 'admin', 'User Role': 'root'
            }))
          })
        }
        if (cmd === 'show provisioning-ap-list') {
          return send(res, 200, { 'Access Points Provisioning List': selected ? [{ 'AP Name': selected.name, 'AP Group': selected.group, 'Serial #': selected.serial, 'Current IP': selected.ip }] : [] })
        }
        if (cmd === 'show provisioning-params') {
          const st = selected?.staged
          if (!st) return send(res, 200, { 'AP provisioning': [] })
          const na = (v) => v || 'N/A'
          return send(res, 200, {
            'AP provisioning': [
              { Parameter: 'AP Name', Value: st.name }, { Parameter: 'AP Group', Value: st.group }, { Parameter: 'Conductor', Value: na(st.prov.master) },
              { Parameter: 'Gateway', Value: na(st.prov.gateway) }, { Parameter: 'Netmask', Value: na(st.prov.netmask) }, { Parameter: 'IP Addr', Value: na(st.prov.ip) },
              { Parameter: 'DNS IP', Value: na(st.prov.dns) }
            ]
          })
        }
        const m = cmd.match(/^show ap details (ap-name|wired-mac) (.+)$/)
        if (m) {
          const a = aps.find((x) => (m[1] === 'ap-name' ? x.name === m[2] : x.mac.replace(/:/g, '').toLowerCase() === m[2].replace(/:/g, '').toLowerCase()))
          if (!a) return send(res, 200, { _data: [`AP ${m[2]} not found`] })
          return send(res, 200, {
            [`AP "${a.name}" Basic Information`]: [{ Item: 'AP IP Address', Value: a.ip }],
            [`AP "${a.name}" Provisioning Parameters`]: [
              { Item: 'IP Address', Value: a.prov.mode === 'dhcp' ? 'N/A' : a.prov.ip },
              { Item: 'Subnet Mask', Value: a.prov.netmask || 'N/A' },
              { Item: 'Gateway', Value: a.prov.gateway || 'N/A' },
              { Item: 'DNS Server', Value: a.prov.dns || 'N/A' },
              { Item: 'Master', Value: a.prov.master || 'N/A' }
            ]
          })
        }
        return send(res, 200, { _data: [] })
      }

      if (req.method === 'POST' && url.pathname === '/v1/configuration/object') {
        let json
        try {
          json = JSON.parse(body)
        } catch {
          return send(res, 400, { error: 'bad json' })
        }
        const out = { _global_result: { status: 0, status_str: 'Success' } }
        if ('clear_provisioning_ap_list' in json) {
          selected = null
          out.clear_provisioning_ap_list = ok()
        }
        // As measured on AOS 8.13.3.1: read_bootinfo takes ap-name / ip-addr / wired-mac (no serial;
        // MAC only as XX:XX:XX:XX:XX:XX), copy_provisioning_params takes ap-name / ip-addr and only
        // for the AP in the provisioning list, ap_reprovision also takes serial-num.
        const fail = (status_str) => ({ _result: { status: 1, status_str } })
        const hexMac = (m) => String(m).replace(/:/g, '').toLowerCase()
        if (json.read_bootinfo) {
          const q = json.read_bootinfo
          if (q['wired-mac'] !== undefined && !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(q['wired-mac'])) {
            out.read_bootinfo = fail('Error : Invalid MAC address. Expected format XX:XX:XX:XX:XX:XX')
          } else if (!('wired-mac' in q || 'ap-name' in q || 'ip-addr' in q)) {
            return send(res, 200, { Error: 'Exception raised while processing request' })
          } else {
            const found = aps.find((a) =>
              q['wired-mac'] !== undefined ? hexMac(a.mac) === hexMac(q['wired-mac']) : q['ap-name'] !== undefined ? a.name === q['ap-name'] : a.ip === q['ip-addr']
            )
            if (found) selected = found
            out.read_bootinfo = found ? ok() : fail('AP not found')
          }
        }
        if (json.copy_provisioning_params) {
          const q = json.copy_provisioning_params
          const found = aps.find((a) => (q['ip-addr'] !== undefined ? a.ip === q['ip-addr'] : a.name === q['ap-name']))
          if (!found) out.copy_provisioning_params = fail(q['ip-addr'] !== undefined ? `AP with IP address ${q['ip-addr']} not found.` : 'AP not found')
          else if (found !== selected) out.copy_provisioning_params = fail('AP is not in provisioning-ap-list')
          else {
            selected.staged = { name: selected.name, group: selected.group, prov: { ...selected.prov } }
            out.copy_provisioning_params = ok()
          }
        }
        if (json.ap_prov) {
          if (!selected) out.ap_prov = { _result: { status: 1, status_str: 'No AP selected' } }
          else {
            // Same field names as AOS 8.13.3.1; unknown sub-objects are echoed without _result,
            // which is how the real controller "accepts" what it ignores.
            const KNOWN = { ap_name: 'ap-name', ap_group: 'ap-group', ipaddr: 'ipaddr', netmask: 'netmask', gatewayip: 'gateway', dnsip: 'dns-server-ip', master: 'master', serverip: 'server-ip' }
            const f = json.ap_prov
            const res = { _result: { status: 0, status_str: '' } }
            const stage = selected.staged || (selected.staged = { name: selected.name, group: selected.group, prov: { ...selected.prov } })
            for (const [obj, v] of Object.entries(f)) {
              if (!(obj in KNOWN) || ignoreFields.includes(obj)) { res[obj] = v; continue }
              const key = KNOWN[obj]
              if (v._action === 'modify' && !(key in v)) { res[obj] = { ...v, _result: { status: 1, status_str: 'Invalid parameter specified' } }; continue }
              res[obj] = { ...v, _result: { status: 0, status_str: 'Success' } }
              const val = v._action === 'modify' ? v[key] : v._action === 'delete' ? '' : undefined
              if (val === undefined) continue
              if (obj === 'ap_name') stage.name = val
              else if (obj === 'ap_group') stage.group = val
              else if (obj === 'ipaddr') stage.prov.ip = val
              else if (obj === 'netmask') stage.prov.netmask = val
              else if (obj === 'gatewayip') stage.prov.gateway = val
              else if (obj === 'dnsip') stage.prov.dns = val
              else if (obj === 'master') stage.prov.master = val
            }
            stage.prov.mode = stage.prov.ip ? 'static' : 'dhcp'
            selected.pendingApply = { name: stage.name, group: stage.group, prov: stage.prov, ...(stage.prov.ip ? { ip: stage.prov.ip } : {}) }
            out.ap_prov = res
          }
        }
        if (json.ap_reprovision) {
          const q = json.ap_reprovision
          const target = aps.find((a) => (q['serial-num'] !== undefined ? a.serial === q['serial-num'] : a.name === q['ap-name']))
          if (!target) {
            out.ap_reprovision = fail(q['serial-num'] !== undefined ? `AP with serial number ${q['serial-num']} not found.` : 'AP not found')
            return send(res, 200, out)
          }
          if (target === selected && selected.pendingApply) {
            selected.staged = null
            selected.rebootUntil = Date.now() + rebootMs
            if (selected.pendingApply.prov.master !== '10.20.0.1') {
              // moved to another master: it disappears from this controller
              const gone = selected
              setTimeout(() => aps.splice(aps.indexOf(gone), 1), 500)
            }
          }
          out.ap_reprovision = ok()
        }
        return send(res, 200, out)
      }
      send(res, 404, { error: 'not found' })
    })
  })
  const hooks = {
    sessionCount: () => sessions.size
  }
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, aps, port: server.address().port, ...hooks })))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? Number(process.argv[i + 1]) : def
  }
  const { port } = await startMockController({ port: arg('port', 4343), aps: makeAps(arg('aps', 60)), rebootMs: arg('reboot', 20) * 1000 })
  console.log(`Mock Aruba controller on https://127.0.0.1:${port}  (admin / admin)`)
}

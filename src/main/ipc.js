// IPC surface between the window and the main process (replaces the web app's /api routes).
// Passwords only ever travel renderer -> main on add/edit; nothing secret is sent back.
import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createArubaClient, forgetSession } from './lib/arubaClient.js'
import { countApStats, summarizeAps } from './lib/apStats.js'
import { runLivePreview, toPreviewRow } from './lib/apLivePreview.js'
import { runJob } from './lib/apJobRunner.js'
import { buildTemplate, templateFileName } from './lib/importTemplate.js'
import { ImportFileError, MAX_BYTES } from './lib/apImport.js'
import { isIpv4 } from './lib/ipv4.js'
import { encryptPassword, decryptPassword } from './secrets.js'
import { checkRateLimit } from './rateLimit.js'
import { listInterfaces, resolveSource } from './netInterfaces.js'
import { pingOnce } from './ping.js'

const TERMINAL = ['ok', 'sent', 'failed', 'skipped']
export const runningJobs = new Set()

const LOGS_KEPT = 30

/** One JSON-lines file per job in <userData>/logs, for diagnosing what the controller showed. No passwords. */
function jobLogger(jobId) {
  const dir = join(app.getPath('userData'), 'logs')
  try {
    mkdirSync(dir, { recursive: true })
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('job-'))
      .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    for (const { f } of files.slice(LOGS_KEPT - 1)) unlinkSync(join(dir, f))
  } catch {
    /* logging must never break a job */
  }
  const file = join(dir, `job-${jobId}.log`)
  try {
    appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), event: 'app', version: app.getVersion(), platform: process.platform }) + '\n')
  } catch {
    /* ignore */
  }
  return (entry) => {
    try {
      appendFileSync(file, JSON.stringify(entry) + '\n')
    } catch {
      /* ignore */
    }
  }
}

export function registerIpc(store) {
  const clients = new Map()
  // log every cached session out when the app quits (jobs close their own clients)
  app.on('will-quit', () => {
    for (const c of clients.values()) c.close()
  })

  const SOURCE_KEY = 'sourceInterface'

  /** Every connection to a controller goes out through the chosen source interface. */
  async function newClient(controllerId) {
    const controller = store.getController(controllerId)
    if (!controller) throw new Error('This controller no longer exists.')
    const password = decryptPassword(store.getEncryptedPassword(controllerId))
    const { localAddress, label } = await resolveSource(store.getSetting(SOURCE_KEY))
    return createArubaClient(controller, password, { localAddress, via: label })
  }

  async function clientFor(controllerId) {
    let c = clients.get(controllerId)
    if (c) return c
    c = await newClient(controllerId)
    clients.set(controllerId, c)
    return c
  }

  function dropClient(controllerId) {
    clients.get(controllerId)?.close()
    clients.delete(controllerId)
    forgetSession(controllerId)
  }

  /** Every successful read marks the controller Online, every failure Error with the reason. */
  async function withController(controllerId, fn) {
    try {
      const out = await fn(await clientFor(controllerId))
      store.updateController(controllerId, { status: 'online', lastConnectedAt: Date.now(), lastError: null })
      return out
    } catch (err) {
      if (store.getController(controllerId)) store.updateController(controllerId, { status: 'error', lastError: err.message })
      throw err
    }
  }

  function jobSummary(job) {
    if (!job) return null
    const counts = store.jobCounts(job.id)
    const finished = TERMINAL.reduce((n, s) => n + (counts[s] || 0), 0)
    return { ...job, counts, finished }
  }

  function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...args, _event) }
      } catch (err) {
        if (!(err instanceof ImportFileError)) console.error(`[ipc] ${channel}:`, err.message)
        return { ok: false, error: err.message || String(err) }
      }
    })
  }

  function validateControllerInput(input, { requirePassword }) {
    const errors = []
    const name = String(input.name || '').trim()
    const ipAddress = String(input.ipAddress || '').trim()
    const port = input.port === '' || input.port === undefined || input.port === null ? 4343 : Number(input.port)
    const mode = input.mode
    const configNodePath = String(input.configNodePath || '').trim()
    const username = String(input.username || '').trim()
    const password = String(input.password || '')
    if (!name) errors.push('Name is required.')
    if (!isIpv4(ipAddress)) errors.push('IP Address must be a valid IPv4 address.')
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('Port must be a number from 1 to 65535.')
    if (!['standalone', 'managed'].includes(mode)) errors.push('Choose a Mode.')
    if (configNodePath && !configNodePath.startsWith('/')) errors.push('Config Node Path must start with "/", e.g. /mm/mynode.')
    if (!username) errors.push('Username is required.')
    if (requirePassword && !password) errors.push('Password is required.')
    if (errors.length) throw new Error(errors.join(' '))
    return { name, ipAddress, port, mode, configNodePath, username, password }
  }

  // ---- controllers ----
  handle('controllers:list', () =>
    store.listControllers().map((c) => ({ ...c, lastJob: jobSummary(store.listJobs(c.id)[0]) }))
  )
  handle('controllers:get', (id) => {
    const c = store.getController(id)
    if (!c) throw new Error('This controller no longer exists.')
    return c
  })
  handle('controllers:create', (input) => {
    const v = validateControllerInput(input, { requirePassword: true })
    return store.createController({ ...v, passwordEncrypted: encryptPassword(v.password) })
  })
  handle('controllers:update', (id, input) => {
    if (!store.getController(id)) throw new Error('This controller no longer exists.')
    const v = validateControllerInput(input, { requirePassword: false })
    const { password, ...rest } = v
    const patch = { ...rest, status: 'unknown', lastError: null }
    if (password) patch.passwordEncrypted = encryptPassword(password)
    dropClient(id) // don't reuse a session/cookie made with the old IP or password
    return store.updateController(id, patch)
  })
  handle('controllers:delete', (id) => {
    if (store.activeJob(id)) throw new Error('A provisioning job is still running on this controller.')
    dropClient(id)
    store.deleteController(id) // removes it from Zeta only; nothing on the controller is touched
    return true
  })
  handle('controllers:test', async (id) => {
    checkRateLimit('testConnection')
    dropClient(id)
    await withController(id, (c) => c.testConnection())
    return store.getController(id)
  })
  handle('controllers:apStats', async (id) => {
    try {
      const stats = await withController(id, async (c) => countApStats(await c.listAccessPoints()))
      store.updateController(id, { apStats: stats })
    } catch {
      // status + reason were saved by withController; the card shows them
    }
    return store.getController(id)
  })

  // ---- access points ----
  handle('aps:list', async (id) => {
    checkRateLimit('listAccessPoints')
    const aps = await withController(id, (c) => c.listAccessPoints())
    const summary = summarizeAps(aps)
    store.updateController(id, { apStats: { managed: summary.managed, up: summary.up, down: summary.down } })
    return { aps, summary }
  })

  // ---- import ----
  handle('template:save', async (type) => {
    const win = BrowserWindow.getFocusedWindow()
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: templateFileName(type),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, await buildTemplate(type))
    return filePath
  })

  function toBuffer(bytes) {
    const buf = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
    if (buf.length > MAX_BYTES) throw new ImportFileError('The file is larger than 2 MB.')
    return buf
  }

  // Provisioning read by the last preview of a file, kept in main only (10 min). Apply reuses the
  // reads that say "differs" (those rows are written anyway) and reads the rest again.
  const previewReads = new Map()
  const PREVIEW_READS_TTL = 10 * 60_000
  const readsKey = (id, buf) => `${id}:${createHash('sha256').update(buf).digest('hex')}`
  const progressTo = (event, kind) => (p) => {
    if (!event.sender.isDestroyed()) event.sender.send('import:progress', { kind, ...p })
  }

  handle('import:preview', async (id, bytes, event) => {
    checkRateLimit('preview')
    const buf = toBuffer(bytes)
    const { rows, summary, provisioning, otherSessions } = await withController(id, async (c) => ({
      ...(await runLivePreview(c, buf, { onProgress: progressTo(event, 'preview') })),
      // Someone else working on this controller can step on its shared provisioning list.
      otherSessions: await c.otherSessions().catch(() => [])
    }))
    previewReads.set(readsKey(id, buf), { provisioning, at: Date.now() })
    return { rows: rows.map(toPreviewRow), summary: { ...summary, otherSessions } }
  })

  // Apply never trusts the preview the window showed: it re-reads the same file bytes and
  // re-checks everything against the controller before creating the job.
  handle('import:apply', async (id, bytes, confirmReboot, event) => {
    checkRateLimit('apply')
    if (confirmReboot !== true) throw new Error('Confirm that every applied AP will reboot.')
    const busy = 'Another provisioning job is still running on this controller.'
    if (store.activeJob(id)) throw new Error(busy)
    const buf = toBuffer(bytes)
    const cached = previewReads.get(readsKey(id, buf))
    const known = cached && Date.now() - cached.at < PREVIEW_READS_TTL ? cached.provisioning : null
    const { rows } = await withController(id, (c) => runLivePreview(c, buf, { known, onProgress: progressTo(event, 'apply') }))
    const ready = rows.filter((r) => r.status === 'ready' || r.status === 'notup')
    if (!ready.length) throw new Error('Nothing in this file can be applied. Fix the errors and upload it again.')
    if (store.activeJob(id)) throw new Error(busy)
    const job = store.createJob(
      id,
      ready.map((r) => ({
        rowNumber: r.rowNumber,
        serial: r.ap.serial,
        mac: r.ap.mac,
        risk: r.risk,
        currentName: r.ap.name,
        requested: r.requested,
        changes: r.changes,
        waitsFor: r.waitsFor
      }))
    )
    startJob(job.id, id)
    return { jobId: job.id }
  })

  // The job gets its own client (own sockets), so Test Connection or Edit on the cached UI
  // client can never cut a write in flight.
  function startJob(jobId, controllerId) {
    runningJobs.add(jobId)
    newClient(controllerId).then(
      (client) => {
        // IP chains ping holders through the same source interface as the controller traffic
        const ping = (ip) => pingOnce(ip, { source: client.localAddress })
        runJob(jobId, { store, client, ping, log: jobLogger(jobId) })
          .catch((err) => console.error('[job]', err))
          .finally(() => {
            client.close()
            runningJobs.delete(jobId)
          })
      },
      (err) => {
        for (const item of store.getJobItems(jobId)) {
          store.updateItem(item.id, { status: 'failed', message: 'Nothing was written.', finishedAt: Date.now() })
        }
        store.updateJob(jobId, { status: 'failed', message: `Could not start: ${err.message}`, finishedAt: Date.now() })
        runningJobs.delete(jobId)
      }
    )
  }

  // ---- source interface ----
  handle('net:list', async () => ({ selected: store.getSetting(SOURCE_KEY), interfaces: await listInterfaces() }))
  handle('net:set', async (name) => {
    const value = name || null
    if (value) await resolveSource(value) // must exist and have an IPv4 address now
    store.setSetting(SOURCE_KEY, value)
    // New connections only: cached sessions/sockets were made through the old interface.
    // A running job keeps the client it started with.
    for (const id of [...clients.keys()]) dropClient(id)
    return value
  })

  // ---- jobs ----
  handle('jobs:list', (id) => store.listJobs(id).map(jobSummary))
  handle('jobs:get', (jobId) => {
    const job = store.getJob(jobId)
    if (!job) throw new Error('This job no longer exists.')
    return { job: jobSummary(job), items: store.getJobItems(jobId) }
  })
}

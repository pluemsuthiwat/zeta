// Local SQLite store (node:sqlite, built into Electron's Node — no native module to rebuild).
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

const SCHEMA_VERSION = 3
const JOBS_KEPT_PER_CONTROLLER = 5

const MIGRATIONS = {
  1: `
    CREATE TABLE controllers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 4343,
      mode TEXT NOT NULL,
      config_node_path TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL,
      password_encrypted BLOB NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_connected_at INTEGER,
      last_error TEXT,
      ap_stats TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      controller_id TEXT NOT NULL REFERENCES controllers(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      message TEXT,
      heartbeat_at INTEGER,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX jobs_controller ON jobs(controller_id, created_at DESC);
    CREATE TABLE job_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      serial TEXT,
      mac TEXT,
      risk TEXT NOT NULL,
      current_name TEXT,
      requested TEXT NOT NULL,
      before TEXT,
      changes TEXT,
      waits_for_row INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX job_items_job ON job_items(job_id, row_number);
  `,
  // name and IP chains: a row can wait on several rows, each for a reason
  2: `ALTER TABLE job_items ADD COLUMN waits_for TEXT;`,
  3: `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`
}

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v))
const parse = (v) => (v === null || v === undefined ? null : JSON.parse(v))

function controllerFromRow(r) {
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    ipAddress: r.ip_address,
    port: r.port,
    mode: r.mode,
    configNodePath: r.config_node_path,
    username: r.username,
    status: r.status,
    lastConnectedAt: r.last_connected_at,
    lastError: r.last_error,
    apStats: parse(r.ap_stats),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function jobFromRow(r) {
  if (!r) return null
  return {
    id: r.id,
    controllerId: r.controller_id,
    status: r.status,
    message: r.message,
    heartbeatAt: r.heartbeat_at,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }
}

function itemFromRow(r) {
  return {
    id: r.id,
    jobId: r.job_id,
    rowNumber: r.row_number,
    serial: r.serial,
    mac: r.mac,
    risk: r.risk,
    currentName: r.current_name,
    requested: parse(r.requested),
    before: parse(r.before),
    changes: parse(r.changes) || [],
    waitsFor: parse(r.waits_for) || (r.waits_for_row ? [{ row: r.waits_for_row, reason: 'name' }] : []),
    status: r.status,
    message: r.message,
    attempts: r.attempts,
    lastSeen: parse(r.last_seen),
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }
}

const ITEM_COLUMNS = {
  currentName: ['current_name', (v) => v],
  before: ['before', json],
  status: ['status', (v) => v],
  message: ['message', (v) => v],
  attempts: ['attempts', (v) => v],
  lastSeen: ['last_seen', json],
  startedAt: ['started_at', (v) => v],
  finishedAt: ['finished_at', (v) => v]
}
const JOB_COLUMNS = {
  status: 'status',
  message: 'message',
  heartbeatAt: 'heartbeat_at',
  startedAt: 'started_at',
  finishedAt: 'finished_at'
}
const CONTROLLER_COLUMNS = {
  name: ['name', (v) => v],
  ipAddress: ['ip_address', (v) => v],
  port: ['port', (v) => v],
  mode: ['mode', (v) => v],
  configNodePath: ['config_node_path', (v) => v],
  username: ['username', (v) => v],
  passwordEncrypted: ['password_encrypted', (v) => v],
  status: ['status', (v) => v],
  lastConnectedAt: ['last_connected_at', (v) => v],
  lastError: ['last_error', (v) => v],
  apStats: ['ap_stats', json]
}

function buildSet(patch, columns) {
  const sets = []
  const values = []
  for (const [k, v] of Object.entries(patch)) {
    const col = columns[k]
    if (!col) continue
    const [name, conv] = Array.isArray(col) ? col : [col, (x) => x]
    sets.push(`${name} = ?`)
    values.push(conv(v) ?? null)
  }
  return { sets, values }
}

export function openDatabase(file) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')

  const version = db.prepare('PRAGMA user_version').get().user_version
  for (let v = version + 1; v <= SCHEMA_VERSION; v++) {
    transaction(() => {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v}`)
    })
  }

  function transaction(fn) {
    db.exec('BEGIN')
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  const store = {
    close: () => db.close(),

    // ---- settings ----
    getSetting(key) {
      const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
      return r ? JSON.parse(r.value) : null
    },
    setSetting(key, value) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
    },

    // ---- controllers ----
    listControllers() {
      return db.prepare('SELECT * FROM controllers ORDER BY name COLLATE NOCASE').all().map(controllerFromRow)
    },
    getController(id) {
      return controllerFromRow(db.prepare('SELECT * FROM controllers WHERE id = ?').get(id))
    },
    getEncryptedPassword(id) {
      const r = db.prepare('SELECT password_encrypted FROM controllers WHERE id = ?').get(id)
      return r ? Buffer.from(r.password_encrypted) : null
    },
    createController(data) {
      const id = randomUUID()
      const now = Date.now()
      db.prepare(
        `INSERT INTO controllers (id, name, ip_address, port, mode, config_node_path, username, password_encrypted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, data.name, data.ipAddress, data.port, data.mode, data.configNodePath || '', data.username, data.passwordEncrypted, now, now)
      return store.getController(id)
    },
    updateController(id, patch) {
      const { sets, values } = buildSet(patch, CONTROLLER_COLUMNS)
      if (!sets.length) return store.getController(id)
      db.prepare(`UPDATE controllers SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, Date.now(), id)
      return store.getController(id)
    },
    deleteController(id) {
      db.prepare('DELETE FROM controllers WHERE id = ?').run(id)
    },

    // ---- jobs ----
    createJob(controllerId, items) {
      const id = randomUUID()
      const now = Date.now()
      transaction(() => {
        db.prepare(`INSERT INTO jobs (id, controller_id, status, heartbeat_at, created_at) VALUES (?, ?, 'queued', ?, ?)`).run(
          id,
          controllerId,
          now,
          now
        )
        const ins = db.prepare(
          `INSERT INTO job_items (job_id, row_number, serial, mac, risk, current_name, requested, changes, waits_for)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const it of items) {
          ins.run(id, it.rowNumber, it.serial || null, it.mac || null, it.risk, it.currentName || null, json(it.requested), json(it.changes), json(it.waitsFor || []))
        }
        // keep the latest N finished jobs per controller
        const old = db
          .prepare(
            `SELECT id FROM jobs WHERE controller_id = ? AND status IN ('done', 'failed')
             ORDER BY created_at DESC LIMIT -1 OFFSET ?`
          )
          .all(controllerId, JOBS_KEPT_PER_CONTROLLER - 1)
        const del = db.prepare('DELETE FROM jobs WHERE id = ?')
        for (const o of old) del.run(o.id)
      })
      return store.getJob(id)
    },
    getJob(id) {
      return jobFromRow(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id))
    },
    getJobItems(jobId) {
      return db.prepare('SELECT * FROM job_items WHERE job_id = ? ORDER BY row_number').all(jobId).map(itemFromRow)
    },
    updateJob(id, patch) {
      const { sets, values } = buildSet(patch, JOB_COLUMNS)
      if (sets.length) db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    },
    updateItem(id, patch) {
      const { sets, values } = buildSet(patch, ITEM_COLUMNS)
      if (sets.length) db.prepare(`UPDATE job_items SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    },
    listJobs(controllerId) {
      return db
        .prepare('SELECT * FROM jobs WHERE controller_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(controllerId, JOBS_KEPT_PER_CONTROLLER)
        .map(jobFromRow)
    },
    activeJob(controllerId) {
      return jobFromRow(
        db.prepare(`SELECT * FROM jobs WHERE controller_id = ? AND status IN ('queued', 'running') LIMIT 1`).get(controllerId)
      )
    },
    anyActiveJob() {
      return jobFromRow(db.prepare(`SELECT * FROM jobs WHERE status IN ('queued', 'running') LIMIT 1`).get())
    },
    /** Counts per status for a job, for cards and the progress banner. */
    jobCounts(jobId) {
      const rows = db.prepare('SELECT status, COUNT(*) AS n FROM job_items WHERE job_id = ? GROUP BY status').all(jobId)
      const c = { total: 0 }
      for (const r of rows) {
        c[r.status] = r.n
        c.total += r.n
      }
      return c
    },
    /**
     * Marks jobs whose heartbeat is older than `staleMs` as failed (all of them when staleMs = 0,
     * which is what startup does: nothing can be running before this process started).
     */
    failStaleJobs(staleMs, message) {
      const cutoff = Date.now() - staleMs
      const stale = db
        .prepare(`SELECT id FROM jobs WHERE status IN ('queued', 'running') AND (? = 0 OR heartbeat_at < ?)`)
        .all(staleMs, cutoff)
      const now = Date.now()
      transaction(() => {
        for (const { id } of stale) {
          db.prepare(
            `UPDATE job_items SET status = 'failed', message = ?, finished_at = ?
             WHERE job_id = ? AND status IN ('pending', 'writing', 'verifying')`
          ).run(message, now, id)
          db.prepare(`UPDATE jobs SET status = 'failed', message = ?, finished_at = ? WHERE id = ?`).run(
            'The job stopped unexpectedly (the app was closed or crashed).',
            now,
            id
          )
        }
      })
      return stale.length
    }
  }
  return store
}

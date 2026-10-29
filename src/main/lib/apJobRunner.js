// Runs one provisioning job to the end in the main process. Writes are pipelined (one AP every
// 1.5 s, not waiting for reboots) and success is decided by what the controller shows afterwards,
// never by the write call's own "status 0".

export const DEFAULT_TIMINGS = {
  writeGapMs: 1500,
  pollMs: 10_000,
  // IP chains (A + ping): while a row waits for the AP holding its IP to let go of it, read the
  // AP list this often and ping the holder's old IP every pingMs. Only an AP that answered ping
  // before can be released by ping, and only after `pingMisses` misses in a row (3, so one or two
  // lost packets on a lossy link don't count). If the AP never answers (this computer can't reach
  // the AP subnet), ping proves nothing and the controller showing Rebooting/Down releases it.
  chainPollMs: 3000,
  pingMs: 1000,
  pingMisses: 3,
  noRebootMs: 90_000,
  verifyTimeoutMs: 8 * 60_000,
  // After a reboot the AP shows its new values as soon as it is Up again; if it stays Up with
  // other values this long, the controller did not apply them and waiting longer won't help.
  settleMs: 60_000,
  heartbeatMs: 15_000,
  maxJobMs: 6 * 60 * 60_000
}

const TERMINAL = new Set(['ok', 'sent', 'failed', 'skipped'])
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms))

function findAp(aps, item) {
  if (item.serial) {
    const s = item.serial.toLowerCase()
    const ap = aps.find((a) => a.serial && a.serial.toLowerCase() === s)
    if (ap) return ap
  }
  return item.mac ? aps.find((a) => a.mac === item.mac) || null : null
}

const snapshot = (ap) => ({ name: ap.name, group: ap.group, ip: ap.ip })

/** "1h 2m 3s" / "57s" (from "Up 1h:2m:3s") -> seconds, or null when unknown. */
export function uptimeSeconds(text) {
  if (!text) return null
  let total = 0
  let any = false
  for (const [, n, u] of String(text).matchAll(/(\d+)\s*([dhms])/g)) {
    total += Number(n) * { d: 86400, h: 3600, m: 60, s: 1 }[u]
    any = true
  }
  return any ? total : null
}

function describeSeen(seen) {
  if (!seen) return 'nothing (the AP was never seen again)'
  if (seen.status === 'missing') return 'the AP is not listed on this controller'
  return `name ${seen.name || '-'}, group ${seen.group || '-'}, IP ${seen.ip || '-'}, status ${seen.status}`
}

/**
 * @param {string} jobId
 * @param {{ store, client, timings?, sleep?, now?, onUpdate? }} deps
 */
export async function runJob(jobId, deps) {
  const t = { ...DEFAULT_TIMINGS, ...deps.timings }
  const { store, client } = deps
  const sleep = deps.sleep || sleepReal
  const now = deps.now || Date.now
  const notify = deps.onUpdate || (() => {})
  const log = (event, data) => deps.log?.({ t: new Date(now()).toISOString(), event, ...data })

  const items = store.getJobItems(jobId)
  const byRow = new Map(items.map((i) => [i.rowNumber, i]))
  const extra = new Map(items.map((i) => [i.id, { sentAt: 0, seenDown: false, pingSeen: false, pingMiss: 0, pingGone: false, pingAt: 0 }]))
  const ping = deps.ping || null // async (ip) => boolean: does it answer right now

  const set = (item, patch) => {
    Object.assign(item, patch)
    if (TERMINAL.has(patch.status)) item.finishedAt = patch.finishedAt = now()
    if (patch.status) log('status', { row: item.rowNumber, status: patch.status, message: patch.message ?? item.message })
    store.updateItem(item.id, patch)
  }

  const startedAt = now()
  store.updateJob(jobId, { status: 'running', startedAt, heartbeatAt: startedAt })
  notify()
  const heartbeat = setInterval(() => store.updateJob(jobId, { heartbeatAt: now() }), t.heartbeatMs)

  try {
    // Read the list once more before writing: missing or not-Up APs are never written, and the
    // values seen now are kept as `before`, the only record for rolling back.
    const aps = await client.listAccessPoints()
    for (const item of items) {
      const ap = findAp(aps, item)
      if (!ap) set(item, { status: 'failed', message: 'The AP is no longer on this controller. Nothing was written.' })
      else if (ap.status !== 'up')
        set(item, { status: 'skipped', message: `The AP was ${ap.status} when the job started. Nothing was written.` })
      else set(item, { before: snapshot(ap), currentName: ap.name })
    }
    notify()

    // Low-risk (name/group) first, then network/master; row order inside each.
    const queue = items
      .filter((i) => i.status === 'pending')
      .sort((a, b) => (a.risk === b.risk ? a.rowNumber - b.rowNumber : a.risk === 'low' ? -1 : 1))

    // Chains (.10→.11 while .11→.12): the holder is always written first.
    //  - name: the next row goes once the controller accepted the holder's write (the controller
    //    tolerates a duplicate name for the seconds until the reboot).
    //  - IP (A + ping): the next row goes only once the holder has really let go of the address —
    //    the controller shows it Rebooting/Down, or its old IP stopped answering ping — so two APs
    //    never come up on one IP, even if the controller accepted a holder that never reboots.
    // A holder that fails or is skipped skips every row waiting on it.
    const leftIp = (d) => {
      const x = extra.get(d.id)
      return x.seenDown || x.pingGone
    }
    const released = (dep) => {
      const d = byRow.get(dep.row)
      if (!d) return true
      if (d.status === 'ok' || d.status === 'sent') return true
      if (d.status !== 'verifying') return false
      return dep.reason === 'ip' ? leftIp(d) : true
    }
    /** Holders that rows are waiting on to leave their IP. */
    const ipHolders = () => {
      const out = new Set()
      for (const i of items) {
        if (i.status !== 'pending') continue
        for (const dep of i.waitsFor || []) {
          const d = byRow.get(dep.row)
          if (dep.reason === 'ip' && d?.status === 'verifying' && !leftIp(d)) out.add(d)
        }
      }
      return [...out]
    }
    const pingHolders = async (holders) => {
      if (!ping) return
      const due = holders.filter((d) => now() - extra.get(d.id).pingAt >= t.pingMs && d.before?.ip)
      await Promise.all(
        due.map(async (d) => {
          const x = extra.get(d.id)
          x.pingAt = now()
          const alive = await ping(d.before.ip).catch(() => true)
          if (alive) {
            x.pingSeen = true
            x.pingMiss = 0
          } else if (x.pingSeen && ++x.pingMiss >= t.pingMisses) {
            x.pingGone = true
            log('ip-released', { row: d.rowNumber, ip: d.before.ip, by: 'ping' })
          }
        })
      )
    }
    const pickNext = () => {
      for (const item of queue) {
        if (item.status !== 'pending') continue
        const blocking = (item.waitsFor || []).filter((dep) => !released(dep))
        const dead = blocking.find((dep) => TERMINAL.has(byRow.get(dep.row)?.status))
        if (dead) {
          const d = byRow.get(dead.row)
          set(item, {
            status: 'skipped',
            message: `Row ${d.rowNumber} keeps ${dead.reason === 'ip' ? `IP ${dead.value}` : `the name "${dead.value}"`} (its write ended ${d.status}), so this AP was not written, to avoid a duplicate.`
          })
          continue
        }
        if (blocking.length) {
          const ipDep = blocking.find((dep) => dep.reason === 'ip')
          const msg = ipDep ? `Waiting for row ${ipDep.row} to leave IP ${ipDep.value} (rebooting) before sending this AP.` : null
          if (msg && item.message !== msg) set(item, { message: msg })
          continue
        }
        return item
      }
      return null
    }

    const write = async (item) => {
      set(item, { status: 'writing', attempts: item.attempts + 1, startedAt: item.startedAt || now(), message: null })
      notify()
      log('write', { row: item.rowNumber, serial: item.serial, name: item.currentName, attempt: item.attempts, requested: item.requested })
      try {
        await client.provision({ name: item.currentName, serial: item.serial, mac: item.mac }, item.requested)
        log('write-ok', { row: item.rowNumber })
      } catch (err) {
        log('write-error', { row: item.rowNumber, error: err.message, code: err.code })
        set(item, {
          status: 'failed',
          message:
            err.code === 'EREJECTED' || err.code === 'ECONFLICT'
              ? err.message
              : `${err.message} The command may or may not have reached the AP; check it on the controller.`
        })
        return
      }
      if (item.requested.master) {
        set(item, {
          status: 'sent',
          message: `Sent to new master ${item.requested.master}. The AP leaves this controller; check it on the new one.`
        })
        return
      }
      const x = extra.get(item.id)
      x.sentAt = now()
      x.seenDown = false
      set(item, { status: 'verifying', message: 'Sent. Waiting for the AP to reboot and come back.' })
    }

    let pollError = null
    const verify = async () => {
      let aps = null
      try {
        aps = await client.listAccessPoints()
        pollError = null
      } catch (err) {
        // Keep waiting, but the 8-minute limit below must still apply: a controller that keeps
        // failing to answer must not leave items in Verifying forever.
        pollError = err.message
        log('poll-error', { error: err.message })
      }
      for (const item of items) {
        if (item.status !== 'verifying') continue
        const x = extra.get(item.id)
        if (!aps) {
          if (now() - x.sentAt >= t.verifyTimeoutMs) {
            set(item, {
              status: 'failed',
              message: `Could not confirm the result within 8 minutes: the controller's AP list could not be read (${pollError}). Check this AP on the controller.`,
              lastSeen: item.lastSeen
            })
          }
          continue
        }
        const ap = findAp(aps, item)
        const req = item.requested
        const before = item.before
        if (!ap || ap.status !== 'up') {
          if (!x.seenDown) log('left-up', { row: item.rowNumber, serial: item.serial, status: ap ? ap.statusText : 'missing' })
          x.seenDown = true
          item.lastSeen = ap ? { ...snapshot(ap), status: ap.status } : { status: 'missing' }
        } else {
          item.lastSeen = { ...snapshot(ap), status: ap.status }
          item.currentName = ap.name
          const wantIp = req.network?.mode === 'static' ? req.network.ip : null
          const matches =
            (!req.name || ap.name === req.name) && (!req.group || ap.group === req.group) && (!wantIp || ap.ip === wantIp)
          const distinguishable =
            (req.name && req.name !== before.name) ||
            (req.group && req.group !== before.group) ||
            (wantIp && wantIp !== before.ip)
          const unchanged = ap.name === before.name && ap.group === before.group && ap.ip === before.ip
          log('seen', {
            row: item.rowNumber,
            serial: item.serial,
            ap: { name: ap.name, group: ap.group, ip: ap.ip, status: ap.status, statusText: ap.statusText },
            requested: req,
            before,
            matches,
            distinguishable: Boolean(distinguishable),
            uptime: ap.uptime,
            seenDown: x.seenDown,
            elapsedS: Math.round((now() - x.sentAt) / 1000)
          })

          if (!matches && x.seenDown) {
            x.backUpAt ||= now()
            if (now() - x.backUpAt >= t.settleMs) {
              const diff = []
              if (req.name && ap.name !== req.name) diff.push(`name is ${ap.name}, not ${req.name}`)
              if (req.group && ap.group !== req.group) diff.push(`group is ${ap.group}, not ${req.group}`)
              if (wantIp && ap.ip !== wantIp) diff.push(`IP is ${ap.ip || '-'}, not ${wantIp}`)
              set(item, {
                status: 'failed',
                message: `The AP rebooted and is Up again, but ${diff.join('; ')}. The controller did not apply the change.`,
                lastSeen: item.lastSeen,
                currentName: ap.name
              })
              continue
            }
          }
          // The controller can show a new name in its AP database before the AP has even
          // rebooted (seen on 8.13 with a name swap), so "Done" always needs proof of the reboot:
          // we saw it leave Up, or its uptime is shorter than the time since our write.
          const up = uptimeSeconds(ap.uptime)
          const rebooted = x.seenDown || (up !== null && up < (now() - x.sentAt) / 1000)
          if (matches && rebooted) {
            set(item, {
              status: 'ok',
              message: 'Verified: the AP is back Up with the requested values.',
              lastSeen: item.lastSeen,
              currentName: ap.name
            })
            continue
          }
          if (!x.seenDown && unchanged && now() - x.sentAt >= t.noRebootMs) {
            if (item.attempts < 2) {
              set(item, { status: 'pending', message: 'No reboot seen after 90 seconds; sending once more.' })
              queue.splice(queue.indexOf(item), 1)
              queue.unshift(item)
            } else {
              set(item, {
                status: 'failed',
                message: 'The AP did not reboot and still has its old values after two attempts. Nothing was changed.',
                lastSeen: item.lastSeen
              })
            }
            continue
          }
        }
        if (now() - x.sentAt >= t.verifyTimeoutMs) {
          set(item, {
            status: 'failed',
            message: `The AP did not come back with the new values within 8 minutes. Last seen: ${describeSeen(item.lastSeen)}.`,
            lastSeen: item.lastSeen
          })
        } else {
          store.updateItem(item.id, { lastSeen: item.lastSeen, currentName: item.currentName })
        }
      }
    }

    let nextWriteAt = now()
    let nextPollAt = now() + t.pollMs
    while (items.some((i) => !TERMINAL.has(i.status))) {
      if (now() - startedAt >= t.maxJobMs) {
        for (const i of items) if (!TERMINAL.has(i.status)) set(i, { status: 'failed', message: 'The job ran out of time.' })
        break
      }
      const verifying = items.some((i) => i.status === 'verifying')
      const holders = ipHolders()
      if (holders.length) {
        await pingHolders(holders)
        nextPollAt = Math.min(nextPollAt, now() + t.chainPollMs)
      }
      if (verifying && now() >= nextPollAt) {
        await verify()
        nextPollAt = now() + (ipHolders().length ? t.chainPollMs : t.pollMs)
        notify()
      }
      let wrote = false
      if (now() >= nextWriteAt) {
        const next = pickNext()
        if (next) {
          await write(next)
          nextWriteAt = now() + t.writeGapMs
          wrote = true
          notify()
        }
      }
      if (!items.some((i) => !TERMINAL.has(i.status))) break
      if (!verifying && !wrote && !items.some((i) => i.status === 'verifying')) {
        // Nothing in flight and nothing writable: every pending item waits on something that
        // can no longer finish. pickNext() already skipped those whose dependency ended.
        if (!pickNext()) {
          for (const i of items)
            if (i.status === 'pending') set(i, { status: 'skipped', message: 'Waiting on a rename that never completed.' })
          break
        }
      }
      const hasPending = items.some((i) => i.status === 'pending')
      const wake = Math.min(
        hasPending ? nextWriteAt : Infinity,
        items.some((i) => i.status === 'verifying') ? nextPollAt : Infinity,
        holders.length && ping ? now() + t.pingMs : Infinity
      )
      await sleep(Math.max(50, Math.min(wake - now(), t.pollMs)))
    }

    const failed = items.filter((i) => i.status === 'failed').length
    const counts = (s) => items.filter((i) => i.status === s).length
    const message = `${counts('ok')} done, ${counts('sent')} sent to new master, ${failed} failed, ${counts('skipped')} skipped`
    store.updateJob(jobId, { status: failed ? 'failed' : 'done', message, finishedAt: now(), heartbeatAt: now() })
  } catch (err) {
    for (const i of items) {
      if (!TERMINAL.has(i.status)) set(i, { status: 'failed', message: `The job stopped: ${err.message} Check this AP on the controller.` })
    }
    store.updateJob(jobId, { status: 'failed', message: `The job stopped: ${err.message}`, finishedAt: now() })
  } finally {
    clearInterval(heartbeat)
    notify()
  }
}

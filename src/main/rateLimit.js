// Per-action limits that protect the controllers (each login or big show command costs them).
const LIMITS = {
  testConnection: 10,
  listAccessPoints: 40,
  preview: 10,
  apply: 5
}
const WINDOW_MS = 60_000
const hits = new Map()

export class RateLimitError extends Error {}

export function checkRateLimit(action) {
  const limit = LIMITS[action]
  if (!limit) return
  const now = Date.now()
  const list = (hits.get(action) || []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= limit) {
    const wait = Math.ceil((WINDOW_MS - (now - list[0])) / 1000)
    throw new RateLimitError(`Too many requests. Try again in ${wait} seconds.`)
  }
  list.push(now)
  hits.set(action, list)
}

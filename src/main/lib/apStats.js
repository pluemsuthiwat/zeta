/** Managed / Up / Down counts for a controller card. Everything not Up counts as Down. */
export function countApStats(aps) {
  const managed = aps.length
  const up = aps.filter((a) => a.status === 'up').length
  return { managed, up, down: managed - up }
}

/** Summary for the detail page: totals, upgrading, and per-group counts. */
export function summarizeAps(aps) {
  const groups = {}
  for (const ap of aps) groups[ap.group || '(none)'] = (groups[ap.group || '(none)'] || 0) + 1
  return {
    ...countApStats(aps),
    upgrading: aps.filter((a) => a.status === 'upgrading').length,
    groups
  }
}

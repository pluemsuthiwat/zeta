/** Status filter bucket for an AP: 'up', 'down', or 'other' (rebooting, upgrading, unknown …). */
export function statusBucket(ap) {
  return ap.status === 'up' || ap.status === 'down' ? ap.status : 'other'
}

/**
 * Filters the AP table by group, status and a search query.
 * Contains mode matches part of the serial, name, IP or MAC; exact mode needs a whole field.
 * The MAC is only searched when the query looks like a MAC (hex digits and : - . separators),
 * so "1g3t" never matches an AP whose MAC happens to contain "13".
 */
export function filterAps(aps, { group = '', status = '', query = '', exact = false } = {}) {
  const q = query.trim().toLowerCase()
  const qMac = /^[0-9a-f:.\-\s]+$/.test(q) ? q.replace(/[^0-9a-f]/g, '') : ''
  const hit = exact ? (v, s) => v === s : (v, s) => v.includes(s)
  return aps.filter((a) => {
    if (group && (a.group || '(none)') !== group) return false
    if (status && statusBucket(a) !== status) return false
    if (!q) return true
    return (
      hit(a.name.toLowerCase(), q) ||
      hit(a.serial.toLowerCase(), q) ||
      hit(a.ip, q) ||
      (qMac.length >= 2 && hit(a.mac.toLowerCase().replace(/[^0-9a-f]/g, ''), qMac))
    )
  })
}

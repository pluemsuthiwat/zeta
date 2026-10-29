export function formatDateTime(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatMac(mac) {
  if (!mac) return ''
  const hex = String(mac).replace(/[^0-9a-f]/gi, '').toLowerCase()
  return hex.length === 12 ? hex.match(/../g).join(':') : mac
}

export function modeLabel(mode) {
  return mode === 'managed' ? 'Managed by MM' : 'Standalone'
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

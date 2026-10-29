// MAC addresses arrive as aa:bb:cc:dd:ee:ff, AA-BB-CC-DD-EE-FF, aabb.ccdd.eeff or aabbccddeeff.

/** Returns 12 lowercase hex chars, or null when the value is not a full MAC. */
export function normalizeMac(value) {
  if (value === null || value === undefined) return null
  const hex = String(value).trim().replace(/[:\-.\s]/g, '').toLowerCase()
  return /^[0-9a-f]{12}$/.test(hex) ? hex : null
}

/** aabbccddeeff -> aa:bb:cc:dd:ee:ff */
export function formatMac(value) {
  const hex = normalizeMac(value)
  return hex ? hex.match(/../g).join(':') : String(value ?? '')
}

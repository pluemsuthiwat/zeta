// Strict IPv4 helpers. A wrong value here can make an installed AP unreachable,
// so anything ambiguous is rejected instead of being "fixed up".

const OCTET = /^(0|[1-9]\d{0,2})$/

/** Returns the address as a 32-bit unsigned int, or null when not strict dotted-quad. */
export function parseIpv4(value) {
  if (typeof value !== 'string') return null
  const parts = value.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!OCTET.test(p)) return null // rejects "010" (octal vs decimal), "", "+1"
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

export function isIpv4(value) {
  return parseIpv4(value) !== null
}

export function formatIpv4(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

/** Prefix length of a contiguous netmask, or null. */
export function netmaskPrefix(value) {
  const n = parseIpv4(value)
  if (n === null) return null
  const inverted = ~n >>> 0
  // contiguous mask => inverted is 2^k - 1
  if ((inverted & (inverted + 1)) !== 0) return null
  let prefix = 32
  for (let x = inverted; x; x >>>= 1) prefix--
  return prefix
}

/** Netmask must be contiguous and between /8 and /30. */
export function isValidNetmask(value) {
  const p = netmaskPrefix(value)
  return p !== null && p >= 8 && p <= 30
}

export function subnetInfo(ip, netmask) {
  const a = parseIpv4(ip)
  const m = parseIpv4(netmask)
  if (a === null || m === null) return null
  const network = (a & m) >>> 0
  const broadcast = (network | (~m >>> 0)) >>> 0
  return { network, broadcast }
}

/**
 * Validates a complete static set. Returns a list of error messages (empty = ok).
 * Assumes the individual values already passed isIpv4 / isValidNetmask.
 */
export function staticSetErrors({ ip, netmask, gateway }) {
  const errors = []
  const s = subnetInfo(ip, netmask)
  if (!s) return errors
  const a = parseIpv4(ip)
  const g = parseIpv4(gateway)
  if (a === s.network) errors.push(`IP ${ip} is the network address of its subnet.`)
  if (a === s.broadcast) errors.push(`IP ${ip} is the broadcast address of its subnet.`)
  if (g !== null) {
    if (g === a) errors.push(`Gateway ${gateway} is the same as the IP.`)
    if (((g & parseIpv4(netmask)) >>> 0) !== s.network) {
      errors.push(`Gateway ${gateway} is not in the same subnet as ${ip}/${netmaskPrefix(netmask)}.`)
    } else if (g === s.network || g === s.broadcast) {
      errors.push(`Gateway ${gateway} is the network or broadcast address of the subnet.`)
    }
  }
  return errors
}

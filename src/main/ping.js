// One ICMP echo through the system `ping` (Node has no raw sockets without native code).
// Used by IP chains to see the moment an AP lets go of its old address.
import { execFile } from 'node:child_process'
import { isIpv4 } from './lib/ipv4.js'

/**
 * @param {string} ip
 * @param {{ source?: string, timeoutMs?: number }} [opts] source = bind address (source interface)
 * @returns {Promise<boolean>} true when a reply came back
 */
export function pingOnce(ip, { source, timeoutMs = 1000 } = {}) {
  if (!isIpv4(ip)) return Promise.resolve(false)
  let args
  if (process.platform === 'win32') {
    args = ['-n', '1', '-w', String(timeoutMs), ...(source ? ['-S', source] : []), ip]
  } else if (process.platform === 'darwin') {
    args = ['-c', '1', '-W', String(timeoutMs), ...(source ? ['-S', source] : []), ip] // macOS: -W in ms
  } else {
    args = ['-c', '1', '-W', String(Math.max(1, Math.round(timeoutMs / 1000))), ...(source ? ['-I', source] : []), ip]
  }
  return new Promise((resolve) => {
    execFile('ping', args, { timeout: timeoutMs + 1500, windowsHide: true }, (err, stdout) => {
      // Windows exits 0 for "Destination host unreachable" sent by a router, so require a real
      // echo reply ("TTL=" / "ttl=") rather than trusting the exit code alone.
      resolve(!err && /ttl=/i.test(String(stdout)))
    })
  })
}

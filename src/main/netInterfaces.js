// Source-interface selection. Sockets are bound to the chosen interface's IPv4 address
// (`localAddress`): macOS then uses that interface's scoped routes, and Windows sends from the
// interface that owns the address. The setting stores the interface name, not the address,
// so a DHCP renewal on that interface is picked up automatically.
import os from 'node:os'
import { execFile } from 'node:child_process'

let macLabels = null // en0 -> "Wi-Fi", from `networksetup -listallhardwareports`

function loadMacLabels() {
  if (process.platform !== 'darwin' || macLabels) return Promise.resolve()
  return new Promise((resolve) => {
    execFile('networksetup', ['-listallhardwareports'], { timeout: 3000 }, (err, stdout) => {
      macLabels = new Map()
      if (!err) {
        for (const block of stdout.split(/\n\s*\n/)) {
          const port = block.match(/Hardware Port: (.+)/)?.[1]
          const dev = block.match(/Device: (\S+)/)?.[1]
          if (port && dev) macLabels.set(dev, port)
        }
      }
      resolve()
    })
  })
}

function labelFor(name) {
  // Windows already names interfaces "Ethernet", "Wi-Fi"…; macOS uses BSD names (en0).
  const friendly = macLabels?.get(name)
  return friendly ? `${friendly} (${name})` : name
}

/** IPv4, non-loopback interfaces that currently have an address. */
export async function listInterfaces() {
  await loadMacLabels()
  const out = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    const v4 = (addrs || []).find((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    if (v4) out.push({ name, label: labelFor(name), address: v4.address, netmask: v4.netmask })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

export class SourceInterfaceError extends Error {}

/**
 * The address to bind for the saved interface name, or undefined for "Auto".
 * Throws when the interface is gone or has no IPv4 address right now.
 */
export async function resolveSource(name) {
  if (!name) return { localAddress: undefined, label: null }
  await loadMacLabels()
  const addrs = os.networkInterfaces()[name]
  const v4 = (addrs || []).find((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
  if (!v4) {
    throw new SourceInterfaceError(
      `The selected source interface ${labelFor(name)} has no IPv4 address (disconnected?). Pick another one in the header, or Auto.`
    )
  }
  return { localAddress: v4.address, label: labelFor(name) }
}

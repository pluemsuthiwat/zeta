// Controller passwords are encrypted with the OS keystore via Electron safeStorage:
// Keychain on macOS, DPAPI on Windows. The key never lives in the app's files, so a copied
// zeta.db cannot be decrypted on another computer or user account.
import { safeStorage } from 'electron'

export function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this computer, so the password cannot be saved safely.')
  }
}

export function encryptPassword(plain) {
  assertEncryptionAvailable()
  return safeStorage.encryptString(plain)
}

export function decryptPassword(buffer) {
  try {
    return safeStorage.decryptString(Buffer.from(buffer))
  } catch {
    throw new Error('The saved password cannot be decrypted on this computer. Open Edit and enter the password again.')
  }
}

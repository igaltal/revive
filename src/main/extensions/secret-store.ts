import { safeStorage } from 'electron'

/**
 * Extension point for the keys wizard (Phase 2). Secrets are encrypted with
 * Electron safeStorage (macOS Keychain-backed) and never leave the main process.
 * Not used in Phase 1.
 */
export interface SecretStore {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
}

export const safeStorageSecretStore: SecretStore = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher)
}

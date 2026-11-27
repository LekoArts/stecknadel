import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** The subset of Electron's `safeStorage` used here (injected so it can be mocked). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export class SecretsUnavailableError extends Error {
  constructor() {
    super(
      'This computer offers no secure storage for the API key (the OS keychain is unavailable), so Stecknadel won’t save it',
    )
  }
}

/**
 * The Dawarich API key, encrypted with the OS keychain via `safeStorage` in `secrets.bin`. The key
 * only ever leaves main as the bearer header; the renderer sees `hasKey()`.
 */
export class Secrets {
  constructor(
    private readonly file: string,
    private readonly storage: SafeStorageLike,
  ) {}

  available(): boolean {
    return this.storage.isEncryptionAvailable()
  }

  async setKey(key: string): Promise<void> {
    if (!this.storage.isEncryptionAvailable()) throw new SecretsUnavailableError()
    const encrypted = this.storage.encryptString(key)
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, encrypted, { mode: 0o600 })
    await rename(tmp, this.file)
  }

  async getKey(): Promise<string | null> {
    if (!this.storage.isEncryptionAvailable()) return null
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.file)
    } catch {
      return null
    }
    try {
      return this.storage.decryptString(encrypted)
    } catch {
      return null // e.g. encrypted under another OS user or keychain
    }
  }

  async hasKey(): Promise<boolean> {
    return (await this.getKey()) !== null
  }

  async clearKey(): Promise<void> {
    await rm(this.file, { force: true })
  }
}

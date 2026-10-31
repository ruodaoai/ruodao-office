import { get, set, del } from 'idb-keyval'
import type { LibrarySnapshot } from '../types'

const LIBRARY_KEY = 'ruodao.library.v1'

export async function loadLibrary(): Promise<LibrarySnapshot | undefined> {
  try {
    return await get<LibrarySnapshot>(LIBRARY_KEY)
  } catch {
    return undefined
  }
}

export async function saveLibrary(snapshot: LibrarySnapshot): Promise<void> {
  await set(LIBRARY_KEY, snapshot)
}

export async function clearLibrary(): Promise<void> {
  await del(LIBRARY_KEY)
}

export interface BackupFile extends LibrarySnapshot {
  app: 'ruodao-office'
  version: 1
  exportedAt: number
}

export async function exportBackup(snapshot: LibrarySnapshot): Promise<BackupFile> {
  return { app: 'ruodao-office', version: 1, exportedAt: Date.now(), ...snapshot }
}

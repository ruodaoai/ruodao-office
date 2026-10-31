import { create } from 'zustand'
import type {
  DocRecord,
  DocSourceFile,
  FileKind,
  LibrarySnapshot,
  NoteRecord,
  SheetRecord,
  SheetSourceFile,
  SheetTab,
} from '../types'
import { uid } from '../lib/utils'
import { createSeedSnapshot } from '../seed'
import { loadLibrary } from '../lib/db'

const DEFAULT_ROWS = 80
const DEFAULT_COLS = 18

function blankTab(name = '工作表 1'): SheetTab {
  return { id: uid(), name, cells: {}, rows: DEFAULT_ROWS, cols: DEFAULT_COLS, colWidths: {} }
}

const LEGACY_WELCOME_ROW = '<tr><td>买断而非订阅</td><td>一次授权，永久使用全部本地功能</td></tr>'
const WELCOME_ROW = '<tr><td>开源免费</td><td>全部功能开放，不收订阅费或授权费</td></tr>'
const LEGACY_PRINCIPLE = '## 二、买断，而不是租用\n一次付费，永久使用。不需要为了导出 PDF 再买一次会员。'
const PRINCIPLE = '## 二、开源免费\n若道办公以开源方式发布，全部功能免费使用。没有订阅、授权码，也不会为了导出 PDF 再收一次费。'

function dropLegacyPricing(snapshot: LibrarySnapshot): LibrarySnapshot {
  const docs = snapshot.docs.map((doc) =>
    doc.html.includes(LEGACY_WELCOME_ROW)
      ? { ...doc, html: doc.html.split(LEGACY_WELCOME_ROW).join(WELCOME_ROW) }
      : doc,
  )
  const notes = snapshot.notes.map((note) =>
    note.content.includes(LEGACY_PRINCIPLE)
      ? { ...note, content: note.content.split(LEGACY_PRINCIPLE).join(PRINCIPLE) }
      : note,
  )
  return { ...snapshot, docs, notes }
}

interface LibraryState extends LibrarySnapshot {
  hydrated: boolean
  hydrate: () => Promise<void>
  createDoc: (options?: { title?: string; html?: string; sourceDocx?: DocSourceFile }) => string
  createSheet: (options?: { title?: string; tabs?: SheetTab[]; source?: SheetSourceFile }) => string
  createNote: (options?: { title?: string; content?: string }) => string
  updateDoc: (id: string, patch: Partial<Pick<DocRecord, 'title' | 'html' | 'sourceDocx'>>) => void
  updateSheet: (id: string, patch: Partial<Pick<SheetRecord, 'title' | 'tabs' | 'activeTab' | 'source'>>) => void
  updateSheetTab: (id: string, tabIndex: number, updater: (tab: SheetTab) => SheetTab) => void
  updateNote: (id: string, patch: Partial<Pick<NoteRecord, 'title' | 'content'>>) => void
  deleteFile: (kind: FileKind, id: string) => void
  setActive: (kind: FileKind, id: string | null) => void
  replaceAll: (snapshot: LibrarySnapshot) => void
  clearAll: () => void
  snapshot: () => LibrarySnapshot
}

function uniqueTitle(existing: string[], base: string): string {
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base} ${i}`)) i += 1
  return `${base} ${i}`
}

export const useLibrary = create<LibraryState>((set, get) => ({
  docs: [],
  sheets: [],
  notes: [],
  activeDocId: null,
  activeSheetId: null,
  activeNoteId: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    const saved = await loadLibrary()
    const snapshot = saved ? dropLegacyPricing(saved) : createSeedSnapshot()
    set({ ...snapshot, hydrated: true })
  },

  createDoc: ({ title, html, sourceDocx } = {}) => {
    const now = Date.now()
    const record: DocRecord = {
      id: uid(),
      kind: 'doc',
      title: title?.trim() || uniqueTitle(get().docs.map((d) => d.title), '未命名文档'),
      html: html ?? '',
      sourceDocx,
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({ docs: [record, ...s.docs], activeDocId: record.id }))
    return record.id
  },

  createSheet: ({ title, tabs, source } = {}) => {
    const now = Date.now()
    const record: SheetRecord = {
      id: uid(),
      kind: 'sheet',
      title: title?.trim() || uniqueTitle(get().sheets.map((d) => d.title), '未命名表格'),
      tabs: tabs?.length ? tabs : [blankTab()],
      activeTab: 0,
      source,
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({ sheets: [record, ...s.sheets], activeSheetId: record.id }))
    return record.id
  },

  createNote: ({ title, content } = {}) => {
    const now = Date.now()
    const record: NoteRecord = {
      id: uid(),
      kind: 'note',
      title: title?.trim() || uniqueTitle(get().notes.map((d) => d.title), '未命名笔记'),
      content: content ?? '# 未命名笔记\n\n',
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({ notes: [record, ...s.notes], activeNoteId: record.id }))
    return record.id
  },

  updateDoc: (id, patch) => {
    set((s) => ({
      docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)),
    }))
  },

  updateSheet: (id, patch) => {
    set((s) => ({
      sheets: s.sheets.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)),
    }))
  },

  updateSheetTab: (id, tabIndex, updater) => {
    set((s) => ({
      sheets: s.sheets.map((sheet) => {
        if (sheet.id !== id) return sheet
        const tabs = sheet.tabs.map((tab, i) => (i === tabIndex ? updater(tab) : tab))
        return { ...sheet, tabs, updatedAt: Date.now() }
      }),
    }))
  },

  updateNote: (id, patch) => {
    set((s) => ({
      notes: s.notes.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)),
    }))
  },

  deleteFile: (kind, id) => {
    set((s) => {
      if (kind === 'doc') {
        const docs = s.docs.filter((d) => d.id !== id)
        return { docs, activeDocId: s.activeDocId === id ? docs[0]?.id ?? null : s.activeDocId }
      }
      if (kind === 'sheet') {
        const sheets = s.sheets.filter((d) => d.id !== id)
        return { sheets, activeSheetId: s.activeSheetId === id ? sheets[0]?.id ?? null : s.activeSheetId }
      }
      const notes = s.notes.filter((d) => d.id !== id)
      return { notes, activeNoteId: s.activeNoteId === id ? notes[0]?.id ?? null : s.activeNoteId }
    })
  },

  setActive: (kind, id) => {
    if (kind === 'doc') set({ activeDocId: id })
    else if (kind === 'sheet') set({ activeSheetId: id })
    else set({ activeNoteId: id })
  },

  replaceAll: (snapshot) => {
    set({ ...dropLegacyPricing(snapshot), hydrated: true })
  },

  clearAll: () => {
    set({
      docs: [],
      sheets: [],
      notes: [],
      activeDocId: null,
      activeSheetId: null,
      activeNoteId: null,
      hydrated: true,
    })
  },

  snapshot: () => {
    const { docs, sheets, notes, activeDocId, activeSheetId, activeNoteId } = get()
    return { docs, sheets, notes, activeDocId, activeSheetId, activeNoteId }
  },
}))

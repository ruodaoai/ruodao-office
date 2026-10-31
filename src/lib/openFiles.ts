import type { ModuleId } from '../types'
import { useLibrary } from '../store/library'
import { useUI } from '../store/ui'
import { importDocumentFile } from './importDocs'
import { sha256Hex } from './utils'
import { readSheetsFromFile } from './xlsx'

export interface DesktopFilePayload {
  name: string
  type?: string
  data?: ArrayBuffer | Uint8Array
  error?: string
}

const DOC_EXT = /\.(docx|html?|txt|markdown|md)$/i
const SHEET_EXT = /\.(xlsx|xls|csv|tsv)$/i
const PDF_EXT = /\.pdf$/i
const CONVERT_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|avif|ico|zip|cbz|json|epub)$/i

function fileBase(name: string): string {
  return name.replace(/\.[^.]+$/, '') || name
}

export interface ImportedDocInfo {
  reused: boolean
  title: string
  warnings: number
  hasSource: boolean
}

export async function importDocFile(file: File): Promise<ImportedDocInfo> {
  const { docs, createDoc, updateDoc, setActive } = useLibrary.getState()
  const imported = await importDocumentFile(file)
  const hash = imported.sourceDocx?.hash
  const existing = hash
    ? docs.find((doc) => {
        const source = doc.sourceDocx
        if (!source) return false
        const known = source.originHash ?? source.hash
        return known ? known === hash : source.name === file.name
      })
    : undefined
  if (existing) {
    if (existing.sourceDocx && !existing.sourceDocx.hash) {
      updateDoc(existing.id, {
        sourceDocx: {
          ...existing.sourceDocx,
          hash,
          originHash: hash,
          size: imported.sourceDocx?.size ?? existing.sourceDocx.size,
        },
      })
    }
    setActive('doc', existing.id)
    return { reused: true, title: existing.title, warnings: 0, hasSource: Boolean(existing.sourceDocx) }
  }
  createDoc({ title: imported.title, html: imported.html, sourceDocx: imported.sourceDocx })
  return {
    reused: false,
    title: imported.title,
    warnings: imported.warnings,
    hasSource: Boolean(imported.sourceDocx),
  }
}

export interface ImportedSheetInfo {
  reused: boolean
  title: string
  tabs: number
}

export async function importSheetFile(file: File): Promise<ImportedSheetInfo> {
  const { sheets, createSheet, updateSheet, setActive } = useLibrary.getState()
  const buffer = await file.arrayBuffer()
  const hash = await sha256Hex(buffer)
  const tabs = await readSheetsFromFile(file)
  const title = fileBase(file.name)
  const existing = sheets.find((sheet) =>
    sheet.source ? sheet.source.hash === hash : sheet.title === title && Object.keys(sheet.tabs[0]?.cells ?? {}).length > 0,
  )
  if (existing) {
    if (!existing.source) {
      updateSheet(existing.id, {
        source: {
          name: file.name,
          type: file.type || 'application/vnd.ms-excel',
          hash,
          size: file.size,
          importedAt: Date.now(),
        },
      })
    }
    setActive('sheet', existing.id)
    return { reused: true, title: existing.title, tabs: existing.tabs.length }
  }
  createSheet({
    title,
    tabs,
    source: {
      name: file.name,
      type: file.type || 'application/vnd.ms-excel',
      hash,
      size: file.size,
      importedAt: Date.now(),
    },
  })
  return { reused: false, title, tabs: tabs.length }
}

export async function openFiles(files: File[]): Promise<void> {
  if (!files.length) return
  const docs: File[] = []
  const sheets: File[] = []
  const pdfs: File[] = []
  const converts: File[] = []
  const unsupported: string[] = []

  const { toast, setModule } = useUI.getState()
  let target: ModuleId | null = null

  for (const file of files) {
    const name = file.name
    if (DOC_EXT.test(name)) docs.push(file)
    else if (SHEET_EXT.test(name)) sheets.push(file)
    else if (PDF_EXT.test(name)) pdfs.push(file)
    else if (CONVERT_EXT.test(name)) converts.push(file)
    else if (/\.doc$/i.test(name)) toast(`${name}：旧版 .doc 暂不支持，请另存为 .docx`, 'error')
    else if (/\.(pptx?|ppt)$/i.test(name)) toast(`${name}：演示文稿暂未开放`, 'error')
    else unsupported.push(name)
  }

  for (const file of docs) {
    toast(`正在打开 ${file.name}`, 'info')
    try {
      const info = await importDocFile(file)
      if (info.reused) toast(`《${info.title}》已有编辑版本，已为你打开`, 'info')
      target ??= 'docs'
    } catch (error) {
      toast(`${file.name}：${(error as Error).message || '无法打开'}`, 'error')
    }
  }

  for (const file of sheets) {
    toast(`正在打开 ${file.name}`, 'info')
    try {
      const info = await importSheetFile(file)
      if (info.reused) toast(`《${info.title}》已经打开过，已切换到已有表格`, 'info')
      target ??= 'sheets'
    } catch (error) {
      toast(`${file.name}：${(error as Error).message || '无法打开'}`, 'error')
    }
  }

  if (pdfs.length) {
    target ??= 'pdf'
    window.dispatchEvent(new CustomEvent<File[]>('ruodao:open-pdf', { detail: pdfs }))
  }

  if (converts.length) {
    target ??= 'convert'
    window.dispatchEvent(new CustomEvent<File[]>('ruodao:open-convert', { detail: converts }))
  }

  if (unsupported.length) {
    const names = unsupported.slice(0, 3).join('、')
    toast(`暂不支持打开 ${names}${unsupported.length > 3 ? ` 等 ${unsupported.length} 个文件` : ''}`, 'error')
  }

  if (target) setModule(target)
}

export async function openDesktopFiles(items: DesktopFilePayload[]): Promise<void> {
  const files: File[] = []
  for (const item of items) {
    if (item.error) {
      useUI.getState().toast(`${item.name}：${item.error}`, 'error')
      continue
    }
    if (!item.data) continue
    const parts: BlobPart[] = [
      item.data instanceof ArrayBuffer ? item.data : item.data.slice().buffer,
    ]
    files.push(new File(parts, item.name, { type: item.type || '' }))
  }
  await openFiles(files)
}

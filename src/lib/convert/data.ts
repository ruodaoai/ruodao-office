import { documentToHtml } from './docs'
import { escapeHtml } from '../utils'
import { t } from '../../i18n'
import { fileBase, fileExtension } from './formats'

export interface DataSheet {
  name: string
  rows: string[][]
}

type XlsxModule = typeof import('xlsx')

let xlsxPromise: Promise<XlsxModule> | null = null
function loadXlsx(): Promise<XlsxModule> {
  if (!xlsxPromise) xlsxPromise = import('xlsx')
  return xlsxPromise
}

function cellText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function trimRows(rows: string[][]): string[][] {
  const cleaned = rows.map((row) => {
    const next = row.map((cell) => String(cell ?? ''))
    while (next.length && !next[next.length - 1].trim()) next.pop()
    return next
  })
  while (cleaned.length && !cleaned[cleaned.length - 1].some((cell) => cell.trim())) cleaned.pop()
  return cleaned
}

async function readWorkbook(file: File, XLSX: XlsxModule): Promise<DataSheet[]> {
  const ext = fileExtension(file.name)
  let source: ArrayBuffer | string
  const buffer = await file.arrayBuffer()
  if (ext === 'csv' || ext === 'tsv') {
    const bytes = new Uint8Array(buffer)
    let text = new TextDecoder('utf-8').decode(bytes)
    if (text.includes('\uFFFD')) {
      try {
        text = new TextDecoder('gbk').decode(bytes)
      } catch {
        // keep UTF-8 output when the runtime cannot decode GBK
      }
    }
    source = text.replace(/^\uFEFF/, '')
  } else {
    source = buffer
  }
  let workbook: import('xlsx').WorkBook
  try {
    workbook = XLSX.read(source, {
      type: typeof source === 'string' ? 'string' : 'array',
      cellDates: true,
    })
  } catch {
    throw new Error(t('无法解析这个表格文件，请检查文件是否损坏'))
  }
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const matrix = sheet
      ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false }) as unknown[][])
      : []
    return {
      name: name.trim() || t('工作表'),
      rows: trimRows(matrix.map((row) => (Array.isArray(row) ? row.map(cellText) : [cellText(row)]))),
    }
  }).filter((sheet) => sheet.rows.length)
  if (!sheets.length) throw new Error(t('这个表格文件里没有可转换的数据'))
  return sheets
}

function rowsFromArray(value: unknown[]): string[][] {
  if (!value.length) return []
  if (value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
    const keys: string[] = []
    value.forEach((item) => {
      Object.keys(item as Record<string, unknown>).forEach((key) => {
        if (!keys.includes(key)) keys.push(key)
      })
    })
    const rows = value.map((item) =>
      keys.map((key) => cellText((item as Record<string, unknown>)[key])),
    )
    return [keys, ...rows]
  }
  if (value.every((item) => Array.isArray(item))) {
    return value.map((row) => (row as unknown[]).map(cellText))
  }
  return [[t('值')], ...value.map((item) => [cellText(item)])]
}

export function jsonToSheets(value: unknown): DataSheet[] {
  if (value == null) throw new Error(t('JSON 内容为空'))
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.sheets)) {
      const sheets = record.sheets
        .map((item, index) => {
          if (!item || typeof item !== 'object') return null
          const sheet = item as Record<string, unknown>
          const rows = Array.isArray(sheet.rows)
            ? (sheet.rows as unknown[]).map((row) => (Array.isArray(row) ? row.map(cellText) : [cellText(row)]))
            : Array.isArray(sheet.data)
              ? rowsFromArray(sheet.data)
              : []
          return { name: cellText(sheet.name) || t('工作表 {n}', { n: index + 1 }), rows: trimRows(rows) }
        })
        .filter((sheet): sheet is DataSheet => Boolean(sheet && sheet.rows.length))
      if (sheets.length) return sheets
    }
    const arrayEntries = Object.entries(record).filter(([, item]) => Array.isArray(item))
    if (arrayEntries.length) {
      return arrayEntries.map(([key, item]) => ({
        name: key || t('工作表'),
        rows: trimRows(rowsFromArray(item as unknown[])),
      }))
    }
    const rows = Object.entries(record).map(([key, item]) => [key, cellText(item)])
    if (!rows.length) throw new Error(t('JSON 里没有可转换的数据'))
    return [{ name: t('数据'), rows: [[t('键'), t('值')], ...rows] }]
  }
  if (Array.isArray(value)) {
    const rows = trimRows(rowsFromArray(value))
    if (!rows.length) throw new Error(t('JSON 数组为空'))
    return [{ name: t('数据'), rows }]
  }
  return [{ name: t('数据'), rows: [[t('值')], [cellText(value)]] }]
}

export async function readDataFile(file: File): Promise<DataSheet[]> {
  const XLSX = await loadXlsx()
  if (fileExtension(file.name) === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      throw new Error(t('JSON 格式有误，请检查逗号与引号'))
    }
    return jsonToSheets(parsed)
  }
  return readWorkbook(file, XLSX)
}

function rowsToJson(rows: string[][]): unknown {
  if (!rows.length) return []
  if (rows.length === 1) return rows[0].length === 1 ? [rows[0][0]] : [rows[0]]
  const header = rows[0].map((cell) => cell.trim())
  const usable =
    header.length > 0 &&
    header.every(Boolean) &&
    new Set(header).size === header.length
  if (!usable) return rows
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {}
    header.forEach((key, index) => {
      record[key] = row[index] ?? ''
    })
    return record
  })
}

export function sheetsToJson(sheets: DataSheet[]): string {
  if (sheets.length === 1) return JSON.stringify(rowsToJson(sheets[0].rows), null, 2)
  const output: Record<string, unknown> = {}
  const names = new Set<string>()
  sheets.forEach((sheet, index) => {
    let name = sheet.name || t('工作表 {n}', { n: index + 1 })
    if (names.has(name)) name = `${name} ${index + 1}`
    names.add(name)
    output[name] = rowsToJson(sheet.rows)
  })
  return JSON.stringify(output, null, 2)
}

function csvCell(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function rowsToCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
}

function safeSheetName(name: string, index: number, used: Set<string>): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || t('工作表 {n}', { n: index + 1 })
  let result = base
  let suffix = 2
  while (used.has(result)) {
    result = `${base} ${suffix}`
    suffix += 1
  }
  used.add(result)
  return result
}

function markdownTable(rows: string[][]): string {
  if (!rows.length) return ''
  const cols = Math.max(...rows.map((row) => row.length))
  const filled = rows.map((row) =>
    Array.from({ length: cols }, (_, index) => (row[index] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')),
  )
  return [
    `| ${filled[0].join(' | ')} |`,
    `| ${filled[0].map(() => '---').join(' | ')} |`,
    ...filled.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function sheetsToHtml(title: string, sheets: DataSheet[]): string {
  const body = sheets
    .map((sheet, index) => {
      const rows = sheet.rows
      const thead = rows[0]
        ? `<thead><tr>${rows[0].map((cell) => `<th>${escapeHtml(cell) || '&nbsp;'}</th>`).join('')}</tr></thead>`
        : ''
      const tbody = rows
        .slice(1)
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell) || '&nbsp;'}</td>`).join('')}</tr>`)
        .join('')
      return `<section><h2>${escapeHtml(sheet.name)}</h2><table>${thead}<tbody>${tbody}</tbody></table><p class="sheet-meta">${t(
        '{rows} 行 · {cols} 列',
        { rows: Math.max(0, rows.length - 1), cols: rows[0]?.length ?? 0 },
      )}</p></section>`
    })
    .join('\n')
  return documentToHtml(title, body, t('表格数据 · {n} 个工作表', { n: sheets.length }))
}

function sheetsToMarkdown(sheets: DataSheet[]): string {
  return sheets.map((sheet) => `## ${sheet.name}\n\n${markdownTable(sheet.rows)}`).join('\n\n')
}

export async function sheetsToXlsxBlob(sheets: DataSheet[]): Promise<Blob> {
  const XLSX = await loadXlsx()
  const workbook = XLSX.utils.book_new()
  const used = new Set<string>()
  sheets.forEach((sheet, index) => {
    const rows = sheet.rows.length ? sheet.rows : [['']]
    const worksheet = XLSX.utils.aoa_to_sheet(rows)
    const cols = Math.max(...rows.map((row) => row.length))
    worksheet['!cols'] = Array.from({ length: cols }, (_, col) => {
      const width = Math.max(6, ...rows.map((row) => (row[col] ?? '').length))
      return { wch: Math.min(48, width + 2) }
    })
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheet.name, index, used).slice(0, 31))
  })
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export interface DataConversion {
  blob: Blob
  ext: string
  note?: string
}

export async function convertData(
  file: File,
  target: 'sheet-xlsx' | 'sheet-csv' | 'sheet-json' | 'sheet-html' | 'sheet-md' | 'json-xlsx' | 'json-csv' | 'json-html',
  onProgress?: (ratio: number) => void,
): Promise<DataConversion> {
  onProgress?.(0.08)
  const sheets = await readDataFile(file)
  onProgress?.(0.4)
  const format = target.split('-')[1]
  const base = fileBase(file.name)
  const sheetNote = t('{n} 个工作表', { n: sheets.length })
  if (format === 'xlsx') {
    const blob = await sheetsToXlsxBlob(sheets)
    onProgress?.(1)
    return { blob, ext: 'xlsx', note: sheetNote }
  }
  if (format === 'json') {
    const text = sheetsToJson(sheets)
    onProgress?.(1)
    return { blob: new Blob([text], { type: 'application/json;charset=utf-8' }), ext: 'json', note: sheetNote }
  }
  if (format === 'html') {
    const html = sheetsToHtml(base, sheets)
    onProgress?.(1)
    return { blob: new Blob([html], { type: 'text/html;charset=utf-8' }), ext: 'html', note: sheetNote }
  }
  if (format === 'md') {
    onProgress?.(1)
    return { blob: new Blob([sheetsToMarkdown(sheets)], { type: 'text/markdown;charset=utf-8' }), ext: 'md', note: sheetNote }
  }
  if (format === 'csv') {
    if (sheets.length === 1) {
      onProgress?.(1)
      return { blob: new Blob([rowsToCsv(sheets[0].rows)], { type: 'text/csv;charset=utf-8' }), ext: 'csv' }
    }
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    const used = new Set<string>()
    sheets.forEach((sheet, index) => {
      zip.file(`${safeSheetName(sheet.name, index, used)}.csv`, `\uFEFF${sheet.rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`)
    })
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    onProgress?.(1)
    return { blob, ext: 'zip', note: t('{n} 个 CSV 已打包', { n: sheets.length }) }
  }
  throw new Error(t('未知的表格输出格式'))
}

import type { CellAlign, CellData, CellStyle, NumberFormat, SheetTab } from '../types'
import { clamp, estimateTextWidth, estimateWrappedLines, uid } from './utils'
import { cellKey, refToPos } from './sheetRefs'
import { SheetEvaluator, isFormulaError } from './formula'

export interface SheetBounds {
  rows: number
  cols: number
}

function normalizeRgb(value: string | null): string | undefined {
  if (!value) return undefined
  const raw = value.replace(/^#/, '')
  if (/^[0-9a-f]{8}$/i.test(raw)) return `#${raw.slice(2)}`
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`
  return undefined
}

interface XlsxExtras {
  styles: Map<string, Map<string, CellStyle>>
  rowHeights: Map<string, Record<number, number>>
}

async function readXlsxExtras(buffer: ArrayBuffer): Promise<XlsxExtras> {
  const result: XlsxExtras = { styles: new Map(), rowHeights: new Map() }
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)
    const stylesFile = zip.file('xl/styles.xml')
    const workbookFile = zip.file('xl/workbook.xml')
    const relsFile = zip.file('xl/_rels/workbook.xml.rels')
    if (!stylesFile || !workbookFile || !relsFile) return result

    const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
    const stylesDoc = parse(await stylesFile.async('string'))
    if (stylesDoc.getElementsByTagName('parsererror').length) return result

    const fontsRoot = stylesDoc.getElementsByTagName('fonts')[0]
    const fonts = fontsRoot
      ? Array.from(fontsRoot.children).map((font) => {
          const children = Array.from(font.children)
          const colorNode = children.find((node) => node.nodeName === 'color')
          return {
            bold: children.some((node) => node.nodeName === 'b'),
            italic: children.some((node) => node.nodeName === 'i'),
            color: normalizeRgb(colorNode?.getAttribute('rgb') ?? null),
          }
        })
      : []

    const fillsRoot = stylesDoc.getElementsByTagName('fills')[0]
    const fills = fillsRoot
      ? Array.from(fillsRoot.children).map((fill) => {
          const pattern = fill.getElementsByTagName('patternFill')[0]
          if (!pattern || pattern.getAttribute('patternType') !== 'solid') return undefined
          const fg = pattern.getElementsByTagName('fgColor')[0]
          return normalizeRgb(fg?.getAttribute('rgb') ?? null)
        })
      : []

    const xfsRoot = stylesDoc.getElementsByTagName('cellXfs')[0]
    const xfs = xfsRoot
      ? Array.from(xfsRoot.children)
          .filter((node) => node.nodeName === 'xf')
          .map((xf) => {
            const alignment = Array.from(xf.children).find((node) => node.nodeName === 'alignment')
            const horizontal = alignment?.getAttribute('horizontal')
            const vertical = alignment?.getAttribute('vertical')
            const wrap = alignment?.getAttribute('wrapText')
            return {
              fontId: Number(xf.getAttribute('fontId') ?? 0),
              fillId: Number(xf.getAttribute('fillId') ?? 0),
              applyAlignment: xf.getAttribute('applyAlignment') !== '0',
              wrapText: wrap === '1' || wrap === 'true',
              align:
                horizontal === 'left' || horizontal === 'center' || horizontal === 'right'
                  ? (horizontal as CellAlign)
                  : undefined,
              valign:
                vertical === 'top' || vertical === 'center' || vertical === 'bottom'
                  ? vertical === 'center'
                    ? ('middle' as const)
                    : (vertical as 'top' | 'bottom')
                  : undefined,
            }
          })
      : []

    const workbookDoc = parse(await workbookFile.async('string'))
    const relsDoc = parse(await relsFile.async('string'))
    const relMap = new Map<string, string>()
    Array.from(relsDoc.getElementsByTagName('Relationship')).forEach((rel) => {
      const id = rel.getAttribute('Id')
      const target = rel.getAttribute('Target')
      if (id && target) relMap.set(id, target)
    })

    const sheetNodes = Array.from(workbookDoc.getElementsByTagName('sheet'))
    await Promise.all(
      sheetNodes.map(async (node) => {
        const name = node.getAttribute('name')
        if (!name) return
        const relId =
          node.getAttribute('r:id') ??
          node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
        const target = relId ? relMap.get(relId) : undefined
        if (!target) return
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
        const sheetFile = zip.file(path)
        if (!sheetFile) return
        const sheetDoc = parse(await sheetFile.async('string'))
        if (sheetDoc.getElementsByTagName('parsererror').length) return
        const map = new Map<string, CellStyle>()
        Array.from(sheetDoc.getElementsByTagName('c')).forEach((cell) => {
          const ref = cell.getAttribute('r')
          const styleIndex = cell.getAttribute('s')
          if (!ref || styleIndex === null) return
          const xf = xfs[Number(styleIndex)]
          if (!xf) return
          const style: CellStyle = {}
          const font = fonts[xf.fontId]
          if (font?.bold) style.bold = true
          if (font?.italic) style.italic = true
          if (font?.color) style.color = font.color
          const bg = fills[xf.fillId]
          if (bg) style.bg = bg
          if (xf.align) style.align = xf.align
          if (xf.valign) style.valign = xf.valign
          if (xf.wrapText) style.wrap = true
          if (Object.keys(style).length) map.set(ref, style)
        })
        const heights: Record<number, number> = {}
        Array.from(sheetDoc.getElementsByTagName('row')).forEach((rowNode) => {
          const index = Number(rowNode.getAttribute('r'))
          const ht = Number(rowNode.getAttribute('ht'))
          if (!Number.isFinite(index) || index < 1 || !Number.isFinite(ht) || ht <= 0) return
          heights[index - 1] = clamp(Math.round((ht * 4) / 3), 20, 320)
        })
        result.styles.set(name, map)
        result.rowHeights.set(name, heights)
      }),
    )
  } catch {
    return { styles: new Map(), rowHeights: new Map() }
  }
  return result
}

export function usedBounds(tab: SheetTab): SheetBounds {
  let rows = 0
  let cols = 0
  Object.entries(tab.cells).forEach(([key, cell]) => {
    if (!cell.raw.trim() && !cell.style) return
    const [row, col] = key.split(':').map(Number)
    rows = Math.max(rows, row + 1)
    cols = Math.max(cols, col + 1)
  })
  return { rows: Math.max(rows, 1), cols: Math.max(cols, 1) }
}

export interface SheetBlock {
  r1: number
  r2: number
  c1: number
  c2: number
}

export function contentBlock(tab: SheetTab): SheetBlock {
  const used = usedBounds(tab)
  const filled = (row: number, col: number) => Boolean(tab.cells[`${row}:${col}`]?.raw.trim())
  const rowHasContent = (row: number) => {
    for (let col = 0; col < used.cols; col += 1) if (filled(row, col)) return true
    return false
  }
  let r1 = 0
  while (r1 < used.rows && !rowHasContent(r1)) r1 += 1
  if (r1 >= used.rows) return { r1: 0, r2: 0, c1: 0, c2: 0 }
  let r2 = r1
  for (let row = r1 + 1; row < used.rows; row += 1) {
    if (!rowHasContent(row)) break
    r2 = row
  }
  const firstFilledCol = (row: number) => {
    for (let col = 0; col < used.cols; col += 1) if (filled(row, col)) return col
    return -1
  }
  while (r2 > r1) {
    const col = firstFilledCol(r2)
    const text = col >= 0 ? (tab.cells[`${r2}:${col}`]?.raw ?? '').trim() : ''
    if (!/(合计|总计|小计|^total$|^sum$)/i.test(text)) break
    r2 -= 1
  }
  const columnHasContent = (col: number) => {
    for (let row = r1; row <= r2; row += 1) if (filled(row, col)) return true
    return false
  }
  let c1 = 0
  while (c1 < used.cols && !columnHasContent(c1)) c1 += 1
  let c2 = used.cols - 1
  while (c2 > c1 && !columnHasContent(c2)) c2 -= 1
  return { r1, r2, c1, c2 }
}

function formatImportDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function applyWrapHeuristic(cells: Record<string, CellData>, colWidths: Record<number, number>) {
  const filledPerRow = new Map<number, number>()
  Object.entries(cells).forEach(([key, cell]) => {
    if (!cell.raw.trim()) return
    const row = Number(key.split(':')[0])
    filledPerRow.set(row, (filledPerRow.get(row) ?? 0) + 1)
  })
  Object.entries(cells).forEach(([key, cell]) => {
    const raw = cell.raw.trim()
    if (!raw || cell.style?.wrap) return
    if (raw.startsWith('=') || /^[+-]?[\d,]+(?:\.\d+)?%?$/.test(raw) || /^(true|false)$/i.test(raw)) return
    if (/^\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2})?/.test(raw)) return
    if (/^[¥￥$€£]\s?[\d,]+(?:\.\d+)?$/.test(raw)) return
    const [row, col] = key.split(':').map(Number)
    if ((filledPerRow.get(row) ?? 0) < 3) return
    const width = Math.max(40, (colWidths[col] ?? 108) - 18)
    if (estimateTextWidth(raw) <= width * 1.12) return
    if (estimateWrappedLines(raw, width) < 2) return
    cells[key] = { ...cell, style: { ...(cell.style ?? {}), wrap: true } }
  })
}

export async function readSheetsFromFile(file: File): Promise<SheetTab[]> {
  if (file.size > 30 * 1024 * 1024) throw new Error('文件不能超过 30MB')
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  let workbook: import('xlsx').WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: true, cellStyles: true })
  } catch {
    throw new Error('无法解析这个表格文件，请检查格式')
  }
  const extras: XlsxExtras = /\.xls[xm]$/i.test(file.name)
    ? await readXlsxExtras(buffer)
    : { styles: new Map(), rowHeights: new Map() }

  const tabs = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const cells: Record<string, CellData> = {}
    const colWidths: Record<number, number> = {}
    let maxRow = 0
    let maxCol = 0

    if (sheet && sheet['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref'])
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        for (let col = range.s.c; col <= range.e.c; col += 1) {
          const source = sheet[XLSX.utils.encode_cell({ r: row, c: col })]
          if (!source) continue
          let raw = ''
          if (source.f) raw = `=${source.f}`
          else if (source.t === 'n') {
            const format = typeof source.z === 'string' ? source.z : ''
            if (source.v instanceof Date) raw = formatImportDate(source.v)
            else if (/[ymd]/i.test(format) && source.w) raw = String(source.w)
            else if (Number.isFinite(source.v)) raw = String(source.v)
          } else if (source.t === 'b') raw = source.v ? 'TRUE' : 'FALSE'
          else if (source.t === 'd' && source.v instanceof Date) raw = formatImportDate(source.v)
          else if (source.t === 'e') raw = String(source.w ?? '#ERROR')
          else raw = String(source.w ?? source.v ?? '')
          if (!raw) continue

          const style: CellStyle = {}
          const format = typeof source.z === 'string' ? source.z : ''
          if (format.includes('%')) style.fmt = 'percent'
          else if (/[¥￥$€£]|\[\$[A-Za-z0-9-]+\]/.test(format)) style.fmt = 'currency'

          cells[cellKey(row, col)] = Object.keys(style).length ? { raw, style } : { raw }
          maxRow = Math.max(maxRow, row)
          maxCol = Math.max(maxCol, col)
        }
      }
    }

    const columns = sheet?.['!cols'] as Array<{ wch?: number }> | undefined
    columns?.forEach((info, col) => {
      if (!info?.wch) return
      colWidths[col] = clamp(Math.round(info.wch * 7 + 16), 58, 360)
    })

    const nativeMerges = sheet?.['!merges'] as Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> | undefined
    const merges = (nativeMerges ?? [])
      .map((range) => ({
        r1: Math.min(range.s.r, range.e.r),
        r2: Math.max(range.s.r, range.e.r),
        c1: Math.min(range.s.c, range.e.c),
        c2: Math.max(range.s.c, range.e.c),
      }))
      .filter((merge) => merge.r1 >= 0 && merge.c1 >= 0 && (merge.r2 > merge.r1 || merge.c2 > merge.c1))
    merges.forEach((merge) => {
      maxRow = Math.max(maxRow, merge.r2)
      maxCol = Math.max(maxCol, merge.c2)
    })

    const styleMap = extras.styles.get(name)
    styleMap?.forEach((style, ref) => {
      const pos = refToPos(ref)
      if (!pos) return
      const key = cellKey(pos.row, pos.col)
      const existing = cells[key]
      if (existing) {
        cells[key] = { ...existing, style: { ...style, ...existing.style } }
        maxRow = Math.max(maxRow, pos.row)
        maxCol = Math.max(maxCol, pos.col)
      } else if (style.bg) {
        cells[key] = { raw: '', style }
        maxRow = Math.max(maxRow, pos.row)
        maxCol = Math.max(maxCol, pos.col)
      }
    })

    applyWrapHeuristic(cells, colWidths)

    const rowHeights: Record<number, number> = { ...extras.rowHeights.get(name) }
    const nativeRows = sheet?.['!rows'] as Array<{ hpx?: number; hpt?: number }> | undefined
    nativeRows?.forEach((info, row) => {
      if (!info) return
      const px = info.hpx ?? (info.hpt ? (info.hpt * 4) / 3 : undefined)
      if (!px || px < 20) return
      rowHeights[row] = clamp(Math.round(px), 20, 320)
    })

    return {
      id: uid(),
      name: name.slice(0, 31) || '工作表',
      cells,
      rows: Math.max(80, maxRow + 6),
      cols: Math.max(18, maxCol + 3),
      colWidths,
      ...(Object.keys(rowHeights).length ? { rowHeights } : {}),
      ...(merges.length ? { merges } : {}),
    }
  })

  if (!tabs.length) throw new Error('这个文件里没有工作表')
  return tabs
}

function usedExportSize(tab: SheetTab): SheetBounds {
  const bounds = usedBounds(tab)
  return {
    rows: Math.max(bounds.rows, 8),
    cols: Math.max(bounds.cols, 5),
  }
}

function numberFormatCode(fmt: NumberFormat | undefined): string | undefined {
  switch (fmt) {
    case 'percent':
      return '0.00%'
    case 'currency':
      return '¥#,##0.00'
    case 'number':
      return '#,##0.00'
    case 'text':
      return '@'
    default:
      return undefined
  }
}

function toXlsxStyle(style: CellStyle | undefined): Record<string, unknown> | undefined {
  if (!style) return undefined
  const output: Record<string, unknown> = {}
  const font: Record<string, unknown> = {}
  if (style.bold) font.bold = true
  if (style.italic) font.italic = true
  const color = normalizeRgb(style.color ?? null)
  if (color) font.color = { rgb: `FF${color.slice(1).toUpperCase()}` }
  if (Object.keys(font).length) output.font = font
  const bg = normalizeRgb(style.bg ?? null)
  if (bg) output.fill = { patternType: 'solid', fgColor: { rgb: `FF${bg.slice(1).toUpperCase()}` } }
  const alignment: Record<string, unknown> = {}
  if (style.align) alignment.horizontal = style.align
  if (style.valign) alignment.vertical = style.valign === 'middle' ? 'center' : style.valign
  if (style.wrap) alignment.wrapText = true
  if (Object.keys(alignment).length) output.alignment = alignment
  return Object.keys(output).length ? output : undefined
}

export async function workbookToXlsxBlob(tabs: SheetTab[]): Promise<Blob> {
  const XLSX = await import('xlsx-js-style')
  const workbook = XLSX.utils.book_new()
  const names = new Set<string>()

  tabs.forEach((tab, index) => {
    const evaluator = new SheetEvaluator(tab)
    const { rows, cols } = usedExportSize(tab)
    const matrix: Array<Array<string | number | boolean | null>> = []

    for (let row = 0; row < rows; row += 1) {
      const line: Array<string | number | boolean | null> = []
      for (let col = 0; col < cols; col += 1) {
        const cell = tab.cells[cellKey(row, col)]
        if (!cell || !cell.raw.trim()) {
          line.push(null)
          continue
        }
        if (cell.raw.startsWith('=')) {
          const value = evaluator.valueAt(row, col)
          if (isFormulaError(value)) line.push(value.code)
          else line.push(value)
          continue
        }
        const raw = cell.raw
        if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) line.push(Number(raw))
        else if (/^true$/i.test(raw.trim())) line.push(true)
        else if (/^false$/i.test(raw.trim())) line.push(false)
        else line.push(raw)
      }
      matrix.push(line)
    }

    const worksheet = XLSX.utils.aoa_to_sheet(matrix)
    Object.entries(tab.cells).forEach(([key, cell]) => {
      const [row, col] = key.split(':').map(Number)
      if (row >= rows || col >= cols) return
      const address = XLSX.utils.encode_cell({ r: row, c: col })
      const formatCode = numberFormatCode(cell.style?.fmt)
      const style = toXlsxStyle(cell.style)
      if (!cell.raw.trim()) {
        if (style) (worksheet as Record<string, unknown>)[address] = { t: 's', v: '', s: style }
        return
      }
      if (!cell.raw.startsWith('=')) {
        const target = worksheet[address] as Record<string, unknown> | undefined
        if (target) {
          if (formatCode) target.z = formatCode
          if (style) target.s = style
        }
        return
      }
      const value = evaluator.valueAt(row, col)
      const formulaCell: Record<string, unknown> = { f: cell.raw.slice(1) }
      if (typeof value === 'number') {
        formulaCell.t = 'n'
        formulaCell.v = value
      } else if (typeof value === 'boolean') {
        formulaCell.t = 'b'
        formulaCell.v = value
      } else if (typeof value === 'string') {
        formulaCell.t = 's'
        formulaCell.v = value
      } else if (isFormulaError(value)) {
        formulaCell.t = 'e'
        formulaCell.v = value.code
      }
      if (formatCode) formulaCell.z = formatCode
      if (style) formulaCell.s = style
      ;(worksheet as Record<string, unknown>)[address] = formulaCell
    })

    worksheet['!cols'] = Array.from({ length: cols }, (_, col) => ({
      wch: Math.max(7, Math.round((tab.colWidths[col] ?? 108) / 7)),
    }))

    const rowInfo = tab.rowHeights ?? {}
    if (Object.keys(rowInfo).length) {
      worksheet['!rows'] = Array.from({ length: rows }, (_, row) => {
        const height = rowInfo[row]
        return height ? { hpt: Math.round((height * 3) / 4) } : {}
      })
    }

    const merges = (tab.merges ?? [])
      .filter((merge) => merge.r1 < rows && merge.c1 < cols && merge.r2 > merge.r1 && merge.c2 > merge.c1)
      .map((merge) => ({
        s: { r: merge.r1, c: merge.c1 },
        e: { r: Math.min(merge.r2, rows - 1), c: Math.min(merge.c2, cols - 1) },
      }))
    if (merges.length) worksheet['!merges'] = merges

    let name = tab.name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || `工作表${index + 1}`
    if (names.has(name)) name = `工作表${index + 1}`
    names.add(name)
    XLSX.utils.book_append_sheet(workbook, worksheet, name)
  })

  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function csvCell(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function tabToCsv(tab: SheetTab): string {
  const evaluator = new SheetEvaluator(tab)
  const { rows, cols } = usedExportSize(tab)
  const lines: string[] = []
  for (let row = 0; row < rows; row += 1) {
    const line: string[] = []
    for (let col = 0; col < cols; col += 1) {
      const cell = tab.cells[cellKey(row, col)]
      if (!cell || !cell.raw.trim()) {
        line.push('')
        continue
      }
      if (cell.raw.startsWith('=')) {
        const value = evaluator.valueAt(row, col)
        line.push(isFormulaError(value) ? value.code : String(value))
      } else {
        line.push(cell.raw)
      }
    }
    lines.push(line.map(csvCell).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

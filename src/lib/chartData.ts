import type {
  CellStyle,
  ConditionalRule,
  ConditionalTone,
  NumberFormat,
  SheetChart,
  SheetChartKind,
  SheetTab,
} from '../types'
import { SheetEvaluator } from './formula'
import { cellKey, colToName } from './sheetRefs'
import { clamp, formatCellNumber } from './utils'
import { contentBlock, type SheetBlock } from './xlsx'
import { isEnglish, t } from '../i18n'

export const CHART_COLORS = ['#c8442b', '#2f7457', '#a9772d', '#35587a', '#7a4b8a', '#b5654f']

export const CHART_KIND_LABELS: Record<SheetChartKind, string> = {
  column: '簇状柱形图',
  stackedColumn: '堆积柱形图',
  percentColumn: '百分比柱形图',
  bar: '簇状条形图',
  stackedBar: '堆积条形图',
  line: '折线图',
  area: '面积图',
  stackedArea: '堆积面积图',
  pie: '饼图',
  donut: '圆环图',
  scatter: 'XY 散点图',
  radar: '雷达图',
  combo: '组合图',
}

export interface ChartSeries {
  name: string
  values: number[]
}

export interface ChartData {
  categories: string[]
  series: ChartSeries[]
}

export interface SheetColumn {
  col: number
  name: string
  numeric: boolean
  filled: number
  numericCount: number
  unique: number
}

export interface SheetSchema {
  headerRow: number | null
  usedRows: number
  block: SheetBlock
  columns: SheetColumn[]
}

export type AggregateOp = 'sum' | 'avg' | 'count' | 'max' | 'min'

export interface GroupRow {
  label: string
  value: number
  count: number
  share: number
}

export interface ConditionalPaint {
  bg?: string
  color?: string
  bar?: { ratio: number; color: string }
  bold?: boolean
}

const TONES: Record<ConditionalTone, { bg: string; ink: string; solid: string; scale: string; bar: string }> = {
  accent: { bg: '#fbe9e3', ink: '#8d2f1d', solid: '#c8442b', scale: '#f0c3b3', bar: 'rgba(200, 68, 43, 0.22)' },
  green: { bg: '#e9f2ec', ink: '#24624a', solid: '#2f7457', scale: '#c7dfd1', bar: 'rgba(47, 116, 87, 0.2)' },
  amber: { bg: '#fdf3dd', ink: '#745111', solid: '#a9772d', scale: '#f3dca6', bar: 'rgba(169, 119, 45, 0.22)' },
  blue: { bg: '#eaf0f5', ink: '#2f516f', solid: '#35587a', scale: '#c7d8e6', bar: 'rgba(53, 88, 122, 0.2)' },
}

export function cellText(tab: SheetTab, evaluator: SheetEvaluator, row: number, col: number): string {
  const cell = tab.cells[cellKey(row, col)]
  if (!cell || !cell.raw.trim()) return ''
  const value = evaluator.valueAt(row, col)
  if (typeof value === 'number') return formatCellNumber(value, cell.style?.fmt ?? 'general')
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'string') return value
  return cell.raw
}

export function cellNumber(evaluator: SheetEvaluator, row: number, col: number): number | null {
  const value = evaluator.valueAt(row, col)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function labelForRow(tab: SheetTab, evaluator: SheetEvaluator, row: number, col: number, headerCol: boolean): string {
  if (headerCol) {
    const text = cellText(tab, evaluator, row, col)
    if (text) return text
  }
  return t('第 {n} 行', { n: row + 1 })
}

export function chartRangeOf(chart: SheetChart, tab: SheetTab) {
  return {
    r1: clamp(chart.r1, 0, tab.rows - 1),
    r2: clamp(chart.r2, 0, tab.rows - 1),
    c1: clamp(chart.c1, 0, tab.cols - 1),
    c2: clamp(chart.c2, 0, tab.cols - 1),
  }
}

export function buildChartData(tab: SheetTab, chart: SheetChart, evaluator = new SheetEvaluator(tab)): ChartData {
  const { r1, r2, c1, c2 } = chartRangeOf(chart, tab)
  const colIndexes: number[] = []
  for (let col = c1; col <= c2; col += 1) colIndexes.push(col)
  const allRows: number[] = []
  for (let row = r1; row <= r2; row += 1) allRows.push(row)

  if (!colIndexes.length || !allRows.length) return { categories: [], series: [] }

  const headerRow = chart.headerRow && r1 < r2
  const candidateRows = (headerRow ? allRows.slice(1) : allRows).filter((row) =>
    colIndexes.some((col) => {
      const cell = tab.cells[cellKey(row, col)]
      return Boolean(cell?.raw.trim())
    }),
  )
  const valueCols = chart.headerCol && colIndexes.length > 1 ? colIndexes.slice(1) : colIndexes
  const dataRows = candidateRows.filter((row) => valueCols.some((col) => cellNumber(evaluator, row, col) !== null))
  if (!dataRows.length) return { categories: [], series: [] }

  if (headerRow && dataRows.length === 1 && !chart.headerCol) {
    return {
      categories: valueCols.map((col) => cellText(tab, evaluator, r1, col) || colToName(col)),
      series: [{ name: t('数值'), values: valueCols.map((col) => cellNumber(evaluator, dataRows[0], col) ?? 0) }],
    }
  }

  if (chart.headerCol && valueCols.length === 0) {
    return {
      categories: dataRows.map((row) => labelForRow(tab, evaluator, row, c1, true)),
      series: [{ name: t('数值'), values: dataRows.map((row) => cellNumber(evaluator, row, c1) ?? 0) }],
    }
  }

  const categories = dataRows.map((row) => labelForRow(tab, evaluator, row, c1, chart.headerCol))
  const series: ChartSeries[] = valueCols.map((col, index) => {
    const header = headerRow ? cellText(tab, evaluator, r1, col) : ''
    return {
      name: header || t('系列 {n}', { n: index + 1 }),
      values: dataRows.map((row) => cellNumber(evaluator, row, col) ?? 0),
    }
  })

  return { categories, series }
}

export function detectChartOptions(tab: SheetTab, r1: number, r2: number, c1: number, c2: number) {
  const evaluator = new SheetEvaluator(tab)
  let headerRow = false
  let headerCol = false
  if (r2 > r1) {
    let textOnly = true
    let filled = 0
    let numericBelow = false
    for (let col = c1; col <= c2; col += 1) {
      const cell = tab.cells[cellKey(r1, col)]
      if (cell?.raw.trim()) filled += 1
      if (cellNumber(evaluator, r1, col) !== null) textOnly = false
    }
    for (let row = r1 + 1; row <= Math.min(r2, r1 + 30); row += 1) {
      for (let col = c1; col <= c2; col += 1) {
        if (cellNumber(evaluator, row, col) !== null) numericBelow = true
      }
    }
    headerRow = filled > 0 && textOnly && numericBelow
  }
  if (c2 > c1) {
    const firstCell = tab.cells[cellKey(r1, c1)]
    const firstIsText = Boolean(firstCell?.raw.trim()) && cellNumber(evaluator, r1, c1) === null
    let numericRight = false
    for (let row = r1 + 1; row <= Math.min(r2, r1 + 40) && !numericRight; row += 1) {
      for (let col = c1 + 1; col <= Math.min(c2, c1 + 8); col += 1) {
        if (cellNumber(evaluator, row, col) !== null) {
          numericRight = true
          break
        }
      }
    }
    headerCol = firstIsText && numericRight && r2 > r1
  }
  return { headerRow, headerCol }
}

export function inspectSheet(tab: SheetTab, block = contentBlock(tab)): SheetSchema {
  const evaluator = new SheetEvaluator(tab)
  let headerRow: number | null = null
  if (block.r2 > block.r1) {
    let firstRowText = 0
    let firstRowNumbers = 0
    for (let col = block.c1; col <= block.c2; col += 1) {
      const cell = tab.cells[cellKey(block.r1, col)]
      if (!cell?.raw.trim()) continue
      if (cellNumber(evaluator, block.r1, col) === null) firstRowText += 1
      else firstRowNumbers += 1
    }
    if (firstRowText > 0 && firstRowNumbers === 0) headerRow = block.r1
  }

  const columns: SheetColumn[] = []
  for (let col = block.c1; col <= block.c2; col += 1) {
    let filled = 0
    let numericCount = 0
    const unique = new Set<string>()
    for (let row = headerRow === null ? block.r1 : headerRow + 1; row <= block.r2; row += 1) {
      const cell = tab.cells[cellKey(row, col)]
      if (!cell?.raw.trim()) continue
      filled += 1
      if (cellNumber(evaluator, row, col) !== null) numericCount += 1
      else unique.add(cellText(tab, evaluator, row, col))
      if (unique.size > 40) break
    }
    const name = headerRow !== null ? cellText(tab, evaluator, headerRow, col) || colToName(col) : colToName(col)
    columns.push({
      col,
      name,
      numeric: numericCount >= 2 && numericCount >= filled * 0.6,
      filled,
      numericCount,
      unique: unique.size,
    })
  }

  return { headerRow, usedRows: block.r2 + 1, block, columns }
}

export function aggregateGroups(
  tab: SheetTab,
  dimensionCol: number,
  measureCol: number,
  op: AggregateOp,
  schema: SheetSchema,
): GroupRow[] {
  const evaluator = new SheetEvaluator(tab)
  const start = schema.headerRow === null ? schema.block.r1 : schema.headerRow + 1
  const end = Math.max(start, schema.block.r2)
  const groups = new Map<string, { total: number; count: number }>()

  for (let row = start; row <= end; row += 1) {
    const labelCell = tab.cells[cellKey(row, dimensionCol)]
    if (!labelCell?.raw.trim()) continue
    const label = cellText(tab, evaluator, row, dimensionCol)
    if (!label) continue
    const current = groups.get(label) ?? { total: 0, count: 0 }
    if (op === 'count') {
      current.count += 1
      current.total += 1
    } else {
      const value = cellNumber(evaluator, row, measureCol)
      if (value === null) continue
      current.count += 1
      if (op === 'sum') current.total += value
      else if (op === 'avg') current.total += value
      else if (op === 'max') current.total = current.count === 1 ? value : Math.max(current.total, value)
      else current.total = current.count === 1 ? value : Math.min(current.total, value)
    }
    groups.set(label, current)
  }

  const entries = Array.from(groups.entries())
    .map(([label, group]) => ({
      label,
      value: op === 'avg' && group.count > 0 ? group.total / group.count : group.total,
      count: group.count,
    }))
    .sort((a, b) => b.value - a.value)

  const total = entries.reduce((sum, entry) => sum + entry.value, 0)
  return entries.map((entry) => ({
    ...entry,
    share: total > 0 ? entry.value / total : 0,
  }))
}

function mixHex(from: string, to: string, ratio: number): string {
  const parse = (hex: string) => {
    const raw = hex.replace('#', '')
    return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)]
  }
  const a = parse(from)
  const b = parse(to)
  const value = a.map((channel, index) => Math.round(channel + (b[index] - channel) * ratio))
  return `#${value.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function ruleTone(rule: ConditionalRule) {
  return TONES[rule.tone ?? 'accent']
}

export function buildConditionalIndex(tab: SheetTab, rules: ConditionalRule[] | undefined): Map<string, ConditionalPaint> {
  const result = new Map<string, ConditionalPaint>()
  if (!rules?.length) return result
  const evaluator = new SheetEvaluator(tab)

  for (const rule of rules) {
    const values: Array<{ row: number; col: number; value: number | null; text: string }> = []
    for (let row = rule.r1; row <= rule.r2; row += 1) {
      for (let col = rule.c1; col <= rule.c2; col += 1) {
        const cell = tab.cells[cellKey(row, col)]
        if (!cell?.raw.trim()) continue
        const number = cellNumber(evaluator, row, col)
        values.push({ row, col, value: number, text: cellText(tab, evaluator, row, col) })
      }
    }
    if (!values.length) continue
    const numbers = values.map((item) => item.value).filter((value): value is number => value !== null)
    const min = numbers.length ? Math.min(...numbers) : 0
    const max = numbers.length ? Math.max(...numbers) : 0
    const tone = ruleTone(rule)
    const counts = new Map<string, number>()

    if (rule.kind === 'duplicate') {
      values.forEach((item) => counts.set(item.text, (counts.get(item.text) ?? 0) + 1))
    }

    for (const item of values) {
      const key = cellKey(item.row, item.col)
      const paint = result.get(key) ?? {}
      let matched = false
      if (rule.kind === 'greater' && item.value !== null && rule.value !== undefined) matched = item.value > rule.value
      else if (rule.kind === 'less' && item.value !== null && rule.value !== undefined) matched = item.value < rule.value
      else if (rule.kind === 'equal' && rule.value !== undefined) {
        matched = item.value !== null ? item.value === rule.value : item.text === String(rule.value)
      } else if (rule.kind === 'between' && item.value !== null && rule.value !== undefined && rule.value2 !== undefined) {
        const low = Math.min(rule.value, rule.value2)
        const high = Math.max(rule.value, rule.value2)
        matched = item.value >= low && item.value <= high
      } else if (rule.kind === 'duplicate') matched = (counts.get(item.text) ?? 0) > 1

      if (matched) {
        paint.bg = tone.bg
        paint.color = tone.ink
        paint.bold = true
      }

      if (rule.kind === 'dataBar' && item.value !== null) {
        const span = max - min
        const ratio = span > 0 ? (item.value - min) / span : 1
        paint.bar = { ratio: clamp(ratio, 0.02, 1), color: tone.bar }
      } else if (rule.kind === 'colorScale' && item.value !== null) {
        const span = max - min
        const ratio = span > 0 ? (item.value - min) / span : 1
        paint.bg = mixHex('#fffdf9', tone.scale, clamp(ratio, 0, 1))
        paint.color = '#201e1a'
      }

      if (Object.keys(paint).length) result.set(key, paint)
    }
  }
  return result
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (isEnglish()) {
    if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`
    if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`
    if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 1 : 2)}K`
    return value.toLocaleString('en-US', { maximumFractionDigits: abs >= 1 ? 2 : 3 })
  }
  if (abs >= 1e8) return `${(value / 1e8).toFixed(abs >= 1e9 ? 1 : 2)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(abs >= 1e5 ? 1 : 2)}万`
  if (abs >= 1000) return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  if (abs >= 1) return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  if (abs === 0) return '0'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
}

export function formatWithFormat(value: number, fmt?: NumberFormat): string {
  return formatCellNumber(value, fmt ?? 'general')
}

export function styleNumberFormat(style?: CellStyle): NumberFormat {
  return style?.fmt ?? 'general'
}

export function niceScale(minValue: number, maxValue: number, tickCount = 4) {
  let min = minValue
  let max = maxValue
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }
  if (min === max) {
    if (min === 0) max = 1
    else {
      min = Math.min(0, min)
      max = max * 1.2
    }
  }
  if (min > 0) min = 0
  if (max < 0) max = 0
  const range = max - min
  const rough = range / Math.max(1, tickCount)
  const power = Math.pow(10, Math.floor(Math.log10(rough || 1)))
  const normalized = rough / power
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = niceMin; value <= niceMax + step * 0.5; value += step) {
    ticks.push(Math.abs(value) < step * 1e-6 ? 0 : value)
  }
  return { min: niceMin, max: niceMax, ticks }
}

export function toneOf(tone: ConditionalTone = 'accent') {
  return TONES[tone]
}

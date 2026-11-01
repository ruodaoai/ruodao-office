import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownUp,
  Bold,
  ChartColumn,
  Check,
  ChevronDown,
  CopyX,
  Crosshair,
  Database,
  Download,
  Eye,
  FileDown,
  FileSpreadsheet,
  Filter,
  Italic,
  LayoutDashboard,
  Leaf,
  ListChecks,
  Lock,
  LockOpen,
  Merge,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  PaintBucket,
  Paintbrush,
  Plus,
  Redo2,
  Sigma,
  Snowflake,
  Sparkles,
  SplitSquareHorizontal,
  Table2,
  Trash2,
  Undo2,
  WrapText,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type {
  CellData,
  CellStyle,
  ConditionalKind,
  ConditionalRule,
  NumberFormat,
  SheetChart,
  SheetChartKind,
  SheetFilterRange,
  SheetMerge,
  SheetRecord,
  SheetTab,
  SheetValidation,
} from '../../types'
import { ConfirmDialog, Dropdown } from '../../components/ui'
import { t, useT } from '../../i18n'
import { registerAiContext, registerAiInsert } from '../../lib/aiContext'
import {
  buildConditionalIndex,
  cellText,
  CHART_KIND_LABELS,
  detectChartOptions,
} from '../../lib/chartData'
import { SheetEvaluator, isFormulaError } from '../../lib/formula'
import { cellKey, colToName, formatRange, type CellPos } from '../../lib/sheetRefs'
import { contentBlock, tabToCsv, usedBounds, workbookToXlsxBlob } from '../../lib/xlsx'
import {
  clamp,
  cn,
  downloadBlob,
  downloadText,
  estimateTextWidth,
  estimateWrappedLines,
  formatCellNumber,
  safeFilename,
  uid,
} from '../../lib/utils'
import { useLibrary } from '../../store/library'
import { useUI } from '../../store/ui'
import { ChartDialog, type ChartEditorValue } from './ChartDialog'
import { CommentDialog } from './CommentDialog'
import { ConditionalDialog } from './ConditionalDialog'
import { DedupeDialog, SplitDialog, ValidationDialog, type ValidationDraft } from './DataToolsDialogs'
import { FilterDialog } from './FilterDialog'
import { SheetDashboard } from './SheetDashboard'

const DEFAULT_COL_WIDTH = 108
const MIN_COL_WIDTH = 54
const MAX_COL_WIDTH = 360
const ROW_HEAD_WIDTH = 44
const HISTORY_LIMIT = 60
const MAX_PASTE_ROWS = 300
const MAX_PASTE_COLS = 40

const TEXT_COLORS = ['#201e1a', '#7a7369', '#c8442b', '#b23a2f', '#a9772d', '#2f7457', '#35587a', '#7a4b8a']
const FILL_COLORS = ['#f7e7e0', '#faf5ec', '#f2ece1', '#e9f2ec', '#eaf0f5', '#f3eef8', '#fff0c9', '#f1ede4']
const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.5]

const NUMBER_FORMATS: Array<{ value: NumberFormat; label: string }> = [
  { value: 'general', label: '常规' },
  { value: 'number', label: '数字' },
  { value: 'percent', label: '百分比' },
  { value: 'currency', label: '货币' },
  { value: 'text', label: '文本' },
]

interface Selection {
  anchor: CellPos
  focus: CellPos
}

interface RangeBox {
  r1: number
  r2: number
  c1: number
  c2: number
  rows: number
  cols: number
}

interface TabSnapshot {
  cells: Record<string, CellData>
  colWidths: Record<number, number>
  rowHeights?: Record<number, number>
  rows: number
  cols: number
  charts?: SheetChart[]
  merges?: SheetMerge[]
  freeze?: SheetTab['freeze']
  filters?: SheetFilterRange
  conditional?: ConditionalRule[]
  validations?: SheetValidation[]
  comments?: Record<string, string>
  protected?: boolean
}

type StylePatch = { [K in keyof CellStyle]?: CellStyle[K] | null }

function rectsOverlap(
  a: { r1: number; r2: number; c1: number; c2: number },
  b: { r1: number; r2: number; c1: number; c2: number },
): boolean {
  return a.r2 >= b.r1 && a.r1 <= b.r2 && a.c2 >= b.c1 && a.c1 <= b.c2
}

function validationAt(tab: SheetTab, row: number, col: number): SheetValidation | undefined {
  return tab.validations?.find(
    (rule) => row >= rule.r1 && row <= rule.r2 && col >= rule.c1 && col <= rule.c2,
  )
}

function validationProblem(rule: SheetValidation, raw: string): string | null {
  const value = raw.trim()
  if (!value) return rule.allowBlank ? null : rule.message || t('这个单元格不能留空')
  if (rule.type === 'list') {
    if (rule.list.includes(value)) return null
    return rule.message || t('请从下拉列表中选择：{options}', { options: rule.list.join(t('、')) })
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return rule.message || t('请输入数字')
  if (rule.min !== undefined && numeric < rule.min) return rule.message || t('数值不能小于 {min}', { min: rule.min })
  if (rule.max !== undefined && numeric > rule.max) return rule.message || t('数值不能大于 {max}', { max: rule.max })
  return null
}

function splitText(raw: string, delimiter: string): string[] {
  if (delimiter === ' ') return raw.split(/\s+/).filter(Boolean)
  return raw.split(delimiter).map((part) => part.trim())
}

function toRange(selection: Selection, maxRows: number, maxCols: number): RangeBox {
  const r1 = clamp(Math.min(selection.anchor.row, selection.focus.row), 0, maxRows - 1)
  const r2 = clamp(Math.max(selection.anchor.row, selection.focus.row), 0, maxRows - 1)
  const c1 = clamp(Math.min(selection.anchor.col, selection.focus.col), 0, maxCols - 1)
  const c2 = clamp(Math.max(selection.anchor.col, selection.focus.col), 0, maxCols - 1)
  return { r1, r2, c1, c2, rows: r2 - r1 + 1, cols: c2 - c1 + 1 }
}

function clampSelection(selection: Selection, maxRows: number, maxCols: number): Selection {
  return {
    anchor: {
      row: clamp(selection.anchor.row, 0, maxRows - 1),
      col: clamp(selection.anchor.col, 0, maxCols - 1),
    },
    focus: {
      row: clamp(selection.focus.row, 0, maxRows - 1),
      col: clamp(selection.focus.col, 0, maxCols - 1),
    },
  }
}

function displayValue(tab: SheetTab, evaluator: SheetEvaluator, row: number, col: number): string {
  const cell = tab.cells[cellKey(row, col)]
  if (!cell || !cell.raw.trim()) return ''
  const value = evaluator.valueAt(row, col)
  if (isFormulaError(value)) return value.code
  if (typeof value === 'number') return formatCellNumber(value, cell.style?.fmt ?? 'general')
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return value
}

function textToMatrix(text: string): string[][] {
  let source = text.replace(/\r\n?/g, '\n').trim()
  if (!source) return []
  if (source.startsWith('```')) {
    source = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('```'))
      .join('\n')
  }
  const lines = source.split('\n')
  const isPipeTable = lines.filter((line) => line.trim()).every((line) => line.trim().startsWith('|'))
  if (isPipeTable) {
    return lines
      .filter((line) => line.trim() && !/^\s*\|?[\s:|-]+\|?\s*$/.test(line))
      .map((line) =>
        line
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim()),
      )
  }
  return lines.map((line) => line.split('\t'))
}

export function SheetWorkbook({ sheet }: { sheet: SheetRecord }) {
  const updateSheet = useLibrary((s) => s.updateSheet)
  const updateSheetTab = useLibrary((s) => s.updateSheetTab)
  const deleteFile = useLibrary((s) => s.deleteFile)
  const toast = useUI((s) => s.toast)
  const openAiTask = useUI((s) => s.openAiTask)
  const t = useT()

  const tabIndex = clamp(sheet.activeTab, 0, Math.max(0, sheet.tabs.length - 1))
  const tab = sheet.tabs[tabIndex]

  const [selection, setSelection] = useState<Selection>(() => ({
    anchor: { row: 0, col: 0 },
    focus: { row: 0, col: 0 },
  }))
  const [editing, setEditing] = useState<CellPos | null>(null)
  const [titleDraft, setTitleDraft] = useState(sheet.title)
  const [renamingTab, setRenamingTab] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [liveWidths, setLiveWidths] = useState<Record<number, number> | null>(null)
  const [confirmDeleteSheet, setConfirmDeleteSheet] = useState(false)
  const [confirmDeleteTab, setConfirmDeleteTab] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<'grid' | 'dashboard'>('grid')
  const [chartEditor, setChartEditor] = useState<ChartEditorValue | null>(null)
  const [chartToDelete, setChartToDelete] = useState<SheetChart | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterCol, setFilterCol] = useState(0)
  const [conditionalOpen, setConditionalOpen] = useState(false)
  const [conditionalKind, setConditionalKind] = useState<ConditionalKind>('dataBar')
  const [conditionalScope, setConditionalScope] = useState<RangeBox | null>(null)
  const [dataTool, setDataTool] = useState<'validation' | 'split' | 'dedupe' | null>(null)
  const [dataScope, setDataScope] = useState<RangeBox | null>(null)
  const [commentCell, setCommentCell] = useState<CellPos | null>(null)
  const [protectPrompt, setProtectPrompt] = useState(false)
  const [crosshair, setCrosshair] = useState(false)
  const [eyeCare, setEyeCare] = useState(false)
  const [zoom, setZoom] = useState(1)

  const gridRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLInputElement>(null)
  const cellInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef('')
  const editOriginRef = useRef('')
  const editingRef = useRef<CellPos | null>(null)
  const focusTargetRef = useRef<'cell' | 'bar'>('cell')
  const selectAllOnFocusRef = useRef(false)
  const draggingRef = useRef(false)
  const clipboardRef = useRef('')
  const historyRef = useRef(new Map<string, { undo: TabSnapshot[]; redo: TabSnapshot[] }>())
  const titleTimerRef = useRef<number | null>(null)
  const applyMatrixRef = useRef<(row: number, col: number, matrix: string[][]) => void>(() => {})

  const evaluator = useMemo(() => new SheetEvaluator(tab), [tab])
  const range = useMemo(() => toRange(selection, tab.rows, tab.cols), [selection, tab.rows, tab.cols])

  const sheetRef = useRef(sheet)
  sheetRef.current = sheet
  const tabRef = useRef(tab)
  tabRef.current = tab
  const tabIndexRef = useRef(tabIndex)
  tabIndexRef.current = tabIndex
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const anchorCell = tab.cells[cellKey(selection.anchor.row, selection.anchor.col)]
  const anchorStyle: CellStyle = anchorCell?.style ?? {}
  const anchorValue = evaluator.valueAt(selection.anchor.row, selection.anchor.col)
  const anchorAlign =
    anchorStyle.align ?? (typeof anchorValue === 'number' || typeof anchorValue === 'boolean' ? 'right' : 'left')

  const widths = useMemo(() => {
    const map: Record<number, number> = {}
    for (let col = 0; col < tab.cols; col += 1) {
      map[col] = liveWidths?.[col] ?? tab.colWidths[col] ?? DEFAULT_COL_WIDTH
    }
    return map
  }, [tab.colWidths, tab.cols, liveWidths])

  const gridTemplate = useMemo(
    () => `${ROW_HEAD_WIDTH}px ${Array.from({ length: tab.cols }, (_, col) => `${widths[col]}px`).join(' ')}`,
    [tab.cols, widths],
  )

  const activeFilter = tab.filters
  const filterActive = Boolean(activeFilter?.rules.length)
  const hiddenRows = useMemo(() => {
    const hidden = new Set<number>()
    if (!activeFilter?.rules.length) return hidden
    for (let row = activeFilter.r1 + 1; row <= activeFilter.r2; row += 1) {
      for (const rule of activeFilter.rules) {
        const cell = tab.cells[cellKey(row, rule.col)]
        const text = cell?.raw.trim() ? displayValue(tab, evaluator, row, rule.col) : ''
        if (!rule.values.includes(text)) {
          hidden.add(row)
          break
        }
      }
    }
    return hidden
  }, [activeFilter, evaluator, tab])
  const displayRows = useMemo(() => {
    const rows: number[] = []
    for (let row = 0; row < tab.rows; row += 1) {
      if (!hiddenRows.has(row)) rows.push(row)
    }
    return rows
  }, [hiddenRows, tab.rows])
  const displayIndex = useMemo(() => {
    const map = new Map<number, number>()
    displayRows.forEach((row, index) => map.set(row, index))
    return map
  }, [displayRows])

  const merges = tab.merges ?? []
  const mergesEnabled = merges.length > 0 && !filterActive
  const mergeCover = useMemo(() => {
    const map = new Map<string, SheetMerge>()
    if (!mergesEnabled) return map
    for (const merge of merges) {
      for (let row = merge.r1; row <= merge.r2; row += 1) {
        for (let col = merge.c1; col <= merge.c2; col += 1) {
          map.set(cellKey(row, col), merge)
        }
      }
    }
    return map
  }, [merges, mergesEnabled])

  const conditionalIndex = useMemo(() => buildConditionalIndex(tab, tab.conditional), [tab])

  const validationIndex = useMemo(() => {
    const map = new Map<string, SheetValidation>()
    const rules = tab.validations ?? []
    if (!rules.length) return map
    for (const rule of rules) {
      if (rule.type !== 'list' || !rule.list.length) continue
      const rowEnd = Math.min(rule.r2, tab.rows - 1)
      const colEnd = Math.min(rule.c2, tab.cols - 1)
      for (let row = Math.max(0, rule.r1); row <= rowEnd; row += 1) {
        for (let col = Math.max(0, rule.c1); col <= colEnd; col += 1) {
          map.set(cellKey(row, col), rule)
        }
      }
    }
    return map
  }, [tab.cols, tab.rows, tab.validations])

  const freezeRows = clamp(tab.freeze?.rows ?? 0, 0, Math.max(0, displayRows.length - 1))
  const freezeCols = clamp(tab.freeze?.cols ?? 0, 0, Math.max(0, tab.cols - 1))
  const frozenColLeft = useMemo(() => {
    const offsets: Record<number, number> = {}
    let left = ROW_HEAD_WIDTH
    for (let col = 0; col < tab.cols; col += 1) {
      offsets[col] = left
      left += widths[col] ?? DEFAULT_COL_WIDTH
    }
    return offsets
  }, [tab.cols, widths])

  const rowHeights = useMemo(() => {
    const explicit = tab.rowHeights ?? {}
    const map: Record<number, number> = {}
    for (const row of displayRows) {
      let height = explicit[row] ?? 0
      for (let col = 0; col < tab.cols; col += 1) {
        const cell = tab.cells[cellKey(row, col)]
        if (!cell?.raw.trim() || !cell.style?.wrap) continue
        const merge = mergeCover.get(cellKey(row, col))
        if (merge && (merge.r1 !== row || merge.c1 !== col)) continue
        const spanCols = merge ? merge.c2 - merge.c1 + 1 : 1
        const spanRows = merge ? merge.r2 - merge.r1 + 1 : 1
        let width = 0
        for (let offset = 0; offset < spanCols; offset += 1) width += widths[col + offset] ?? DEFAULT_COL_WIDTH
        const lines = estimateWrappedLines(displayValue(tab, evaluator, row, col), Math.max(24, width - 18))
        height = Math.max(height, (lines * 17 + 11) / spanRows)
      }
      map[row] = clamp(Math.round(height || 28), 28, 320)
    }
    return map
  }, [displayRows, tab, evaluator, mergeCover, widths])

  const gridRows = useMemo(
    () => `28px ${displayRows.map((row) => `${rowHeights[row] ?? 28}px`).join(' ')}`,
    [displayRows, rowHeights],
  )

  const frozenRowTop = useMemo(() => {
    const tops: Record<number, number> = {}
    let top = 28
    for (let visible = 0; visible < freezeRows && visible < displayRows.length; visible += 1) {
      tops[visible] = top
      top += rowHeights[displayRows[visible]] ?? 28
    }
    return tops
  }, [displayRows, freezeRows, rowHeights])

  const liveTab = useCallback((): SheetTab => {
    const library = useLibrary.getState()
    const record = library.sheets.find((item) => item.id === sheetRef.current.id)
    const index = tabIndexRef.current
    return record?.tabs[index] ?? tabRef.current
  }, [])

  const historyFor = useCallback((tabId: string) => {
    let entry = historyRef.current.get(tabId)
    if (!entry) {
      entry = { undo: [], redo: [] }
      historyRef.current.set(tabId, entry)
    }
    return entry
  }, [])

  const snapshotOf = (source: SheetTab): TabSnapshot => ({
    cells: { ...source.cells },
    colWidths: { ...source.colWidths },
    rowHeights: source.rowHeights ? { ...source.rowHeights } : undefined,
    rows: source.rows,
    cols: source.cols,
    charts: source.charts?.map((chart) => ({ ...chart })),
    merges: source.merges?.map((merge) => ({ ...merge })),
    freeze: source.freeze ? { ...source.freeze } : undefined,
    filters: source.filters
      ? {
          ...source.filters,
          rules: source.filters.rules.map((rule) => ({ ...rule, values: [...rule.values] })),
        }
      : undefined,
    conditional: source.conditional?.map((rule) => ({ ...rule })),
    validations: source.validations?.map((rule) => ({ ...rule, list: [...rule.list] })),
    comments: source.comments ? { ...source.comments } : undefined,
    protected: source.protected,
  })

  const pushHistoryFor = useCallback(
    (source: SheetTab) => {
      const entry = historyFor(source.id)
      entry.undo.push(snapshotOf(source))
      if (entry.undo.length > HISTORY_LIMIT) entry.undo.shift()
      entry.redo = []
    },
    [historyFor],
  )

  const applySnapshot = useCallback(
    (snap: TabSnapshot) => {
      updateSheetTab(sheetRef.current.id, tabIndexRef.current, (current) => ({
        ...current,
        cells: { ...snap.cells },
        colWidths: { ...snap.colWidths },
        rowHeights: snap.rowHeights,
        rows: snap.rows,
        cols: snap.cols,
        charts: snap.charts,
        merges: snap.merges,
        freeze: snap.freeze,
        filters: snap.filters,
        conditional: snap.conditional,
        validations: snap.validations,
        comments: snap.comments,
        protected: snap.protected,
      }))
    },
    [updateSheetTab],
  )

  const guardProtected = useCallback(
    (current: SheetTab) => {
      if (!current.protected) return false
      toast(t('工作表已保护，先取消保护后再修改'), 'info')
      return true
    },
    [t, toast],
  )

  const commitCells = useCallback(
    (entries: Array<{ row: number; col: number; raw: string }>) => {
      const current = liveTab()
      if (guardProtected(current)) return
      const cells = { ...current.cells }
      let changed = false
      for (const entry of entries) {
        const key = cellKey(entry.row, entry.col)
        const previous = cells[key]
        const raw = entry.raw
        if ((previous?.raw ?? '') === raw) continue
        changed = true
        if (!raw && !previous?.style) {
          delete cells[key]
        } else {
          cells[key] = previous?.style ? { raw, style: previous.style } : { raw }
        }
      }
      if (!changed) return
      pushHistoryFor(current)
      updateSheetTab(sheetRef.current.id, tabIndexRef.current, (value) => ({ ...value, cells }))
    },
    [guardProtected, liveTab, pushHistoryFor, updateSheetTab],
  )

  const patchStyle = useCallback(
    (box: RangeBox, patch: StylePatch) => {
      const current = liveTab()
      if (guardProtected(current)) return
      const cells = { ...current.cells }
      let changed = false
      for (let row = box.r1; row <= box.r2; row += 1) {
        for (let col = box.c1; col <= box.c2; col += 1) {
          const key = cellKey(row, col)
          const previous = cells[key]
          const style: CellStyle = { ...(previous?.style ?? {}) }
          for (const [name, value] of Object.entries(patch) as Array<[keyof CellStyle, CellStyle[keyof CellStyle] | null | undefined]>) {
            if (value === null || value === undefined) delete style[name]
            else (style as Record<string, unknown>)[name] = value
          }
          const nextStyle = Object.keys(style).length ? style : undefined
          if (JSON.stringify(previous?.style ?? {}) === JSON.stringify(nextStyle ?? {})) continue
          changed = true
          if (!previous?.raw && !nextStyle) delete cells[key]
          else cells[key] = { raw: previous?.raw ?? '', ...(nextStyle ? { style: nextStyle } : {}) }
        }
      }
      if (!changed) return
      pushHistoryFor(current)
      updateSheetTab(sheetRef.current.id, tabIndexRef.current, (value) => ({ ...value, cells }))
    },
    [guardProtected, liveTab, pushHistoryFor, updateSheetTab],
  )

  const clearRange = useCallback(
    (box: RangeBox) => {
      const current = liveTab()
      const entries: Array<{ row: number; col: number; raw: string }> = []
      for (let row = box.r1; row <= box.r2; row += 1) {
        for (let col = box.c1; col <= box.c2; col += 1) {
          if (current.cells[cellKey(row, col)]?.raw) entries.push({ row, col, raw: '' })
        }
      }
      if (entries.length) commitCells(entries)
    },
    [commitCells, liveTab],
  )

  const applyMatrix = useCallback(
    (startRow: number, startCol: number, matrix: string[][]) => {
      if (!matrix.length) return
      const current = liveTab()
      if (guardProtected(current)) return
      const rows = matrix.slice(0, MAX_PASTE_ROWS)
      const colCount = Math.min(MAX_PASTE_COLS, Math.max(...rows.map((line) => line.length)))
      const cells = { ...current.cells }
      let changed = false
      for (let r = 0; r < rows.length; r += 1) {
        for (let c = 0; c < colCount; c += 1) {
          const key = cellKey(startRow + r, startCol + c)
          const previous = cells[key]
          const raw = rows[r][c] ?? ''
          if ((previous?.raw ?? '') === raw) continue
          changed = true
          if (!raw && !previous?.style) delete cells[key]
          else cells[key] = previous?.style ? { raw, style: previous.style } : { raw }
        }
      }
      const nextRows = Math.max(current.rows, startRow + rows.length + 4)
      const nextCols = Math.max(current.cols, startCol + colCount + 2)
      if (!changed && nextRows === current.rows && nextCols === current.cols) return
      pushHistoryFor(current)
      updateSheetTab(sheetRef.current.id, tabIndexRef.current, (value) => ({
        ...value,
        cells,
        rows: nextRows,
        cols: nextCols,
      }))
    },
    [guardProtected, liveTab, pushHistoryFor, updateSheetTab],
  )
  applyMatrixRef.current = applyMatrix

  const undo = useCallback(() => {
    const current = liveTab()
    const entry = historyFor(current.id)
    const snap = entry.undo.pop()
    if (!snap) return
    entry.redo.push(snapshotOf(current))
    applySnapshot(snap)
    setSelection((value) => clampSelection(value, snap.rows, snap.cols))
  }, [applySnapshot, historyFor, liveTab])

  const redo = useCallback(() => {
    const current = liveTab()
    const entry = historyFor(current.id)
    const snap = entry.redo.pop()
    if (!snap) return
    entry.undo.push(snapshotOf(current))
    applySnapshot(snap)
    setSelection((value) => clampSelection(value, snap.rows, snap.cols))
  }, [applySnapshot, historyFor, liveTab])

  const revealCell = useCallback((row: number, col: number) => {
    window.requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }, [])

  const setSingleSelection = useCallback(
    (row: number, col: number) => {
      const current = liveTab()
      const target = {
        row: clamp(row, 0, current.rows - 1),
        col: clamp(col, 0, current.cols - 1),
      }
      setSelection({ anchor: target, focus: target })
      revealCell(target.row, target.col)
      return target
    },
    [liveTab, revealCell],
  )

  const focusGrid = useCallback(() => {
    window.requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }))
  }, [])

  const cancelEdit = useCallback(() => {
    editingRef.current = null
    setEditing(null)
    if (barRef.current) barRef.current.value = editOriginRef.current
    focusGrid()
  }, [focusGrid])

  const finishEdit = useCallback(
    (move?: 'down' | 'up' | 'left' | 'right') => {
      const target = editingRef.current
      if (!target) return
      const raw = draftRef.current
      const rule = validationAt(liveTab(), target.row, target.col)
      if (rule) {
        const problem = validationProblem(rule, raw)
        if (problem) {
          toast(problem, 'error')
          draftRef.current = editOriginRef.current
          if (barRef.current) barRef.current.value = editOriginRef.current
          editingRef.current = null
          setEditing(null)
          focusGrid()
          return
        }
      }
      editingRef.current = null
      setEditing(null)
      if (raw !== editOriginRef.current) commitCells([{ row: target.row, col: target.col, raw }])
      if (move) {
        const delta = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] }[move]
        setSingleSelection(target.row + delta[0], target.col + delta[1])
      }
      focusGrid()
    },
    [commitCells, focusGrid, liveTab, setSingleSelection, toast],
  )

  useEffect(() => {
    const flush = () => {
      if (editingRef.current) finishEdit()
    }
    window.addEventListener('ruodao:flush', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('ruodao:flush', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [finishEdit])

  const beginEdit = useCallback(
    (row: number, col: number, initial?: string, target: 'cell' | 'bar' = 'cell', selectAll = false) => {
      if (editingRef.current) finishEdit()
      if (guardProtected(liveTab())) return
      const raw = liveTab().cells[cellKey(row, col)]?.raw ?? ''
      draftRef.current = initial ?? raw
      editOriginRef.current = raw
      focusTargetRef.current = target
      selectAllOnFocusRef.current = selectAll
      editingRef.current = { row, col }
      setEditing({ row, col })
      setSelection((value) =>
        value.anchor.row === row && value.anchor.col === col && value.focus.row === row && value.focus.col === col
          ? value
          : { anchor: { row, col }, focus: { row, col } },
      )
    },
    [finishEdit, guardProtected, liveTab],
  )

  useEffect(() => {
    if (!editing) return
    const input = focusTargetRef.current === 'bar' ? barRef.current : cellInputRef.current
    if (barRef.current) barRef.current.value = draftRef.current
    if (!input) return
    if (document.activeElement !== input) {
      input.focus({ preventScroll: true })
      if (selectAllOnFocusRef.current) input.select()
      else input.setSelectionRange(input.value.length, input.value.length)
    } else if (selectAllOnFocusRef.current) {
      input.select()
    }
    selectAllOnFocusRef.current = false
  }, [editing])

  useEffect(() => {
    if (editingRef.current) return
    if (barRef.current) {
      barRef.current.value = tabRef.current.cells[cellKey(selection.anchor.row, selection.anchor.col)]?.raw ?? ''
    }
  }, [selection, tab.cells])

  useEffect(() => {
    const onMouseUp = () => {
      draggingRef.current = false
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

  const tabId = tab.id
  useEffect(() => {
    setSelection({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } })
    setEditing(null)
    editingRef.current = null
    setRenamingTab(false)
    setLiveWidths(null)
    setView('grid')
    setChartEditor(null)
    setChartToDelete(null)
    setFilterOpen(false)
    setConditionalOpen(false)
    setDataTool(null)
    setDataScope(null)
    setCommentCell(null)
    setProtectPrompt(false)
  }, [tabId])

  useEffect(() => {
    setTitleDraft(sheet.title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.id])

  useEffect(() => {
    return () => {
      if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!renamingTab) return
    const timer = window.setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [renamingTab])

  useEffect(() => {
    return registerAiContext('sheets', () => {
      const current = sheetRef.current
      const activeTab = current.tabs[tabIndexRef.current]
      if (!activeTab) return null
      const box = toRange(selectionRef.current, activeTab.rows, activeTab.cols)
      const evaluatorForContext = new SheetEvaluator(activeTab)
      const multi = box.rows > 1 || box.cols > 1
      const used = usedBounds(activeTab)
      const startRow = multi ? box.r1 : 0
      const startCol = multi ? box.c1 : 0
      const endRow = Math.min(multi ? box.r2 : used.rows - 1, startRow + 59, activeTab.rows - 1)
      const endCol = Math.min(multi ? box.c2 : used.cols - 1, startCol + 11, activeTab.cols - 1)
      const header = ['', ...Array.from({ length: endCol - startCol + 1 }, (_, i) => colToName(startCol + i))].join('\t')
      const lines: string[] = [header]
      let length = header.length
      for (let row = startRow; row <= endRow; row += 1) {
        const values: string[] = [String(row + 1)]
        for (let col = startCol; col <= endCol; col += 1) {
          values.push(displayValue(activeTab, evaluatorForContext, row, col))
        }
        const line = values.join('\t')
        if (length + line.length > 4000) {
          lines.push(t('…（区域过大，已截断）'))
          break
        }
        lines.push(line)
        length += line.length + 1
      }
      const address =
        startRow === endRow && startCol === endCol
          ? `${colToName(startCol)}${startRow + 1}`
          : formatRange({ row: startRow, col: startCol }, { row: endRow, col: endCol })
      return {
        kind: 'sheet',
        title: `${current.title} · ${activeTab.name}`,
        text: t('工作表：{tab}\n区域：{range}\n\n{data}', { tab: activeTab.name, range: address, data: lines.join('\n') }),
      }
    })
  }, [t])

  useEffect(() => {
    return registerAiInsert('sheets', (text) => {
      const matrix = textToMatrix(text)
      if (!matrix.length) return false
      const anchor = selectionRef.current.anchor
      applyMatrixRef.current(anchor.row, anchor.col, matrix)
      return true
    })
  }, [])

  const switchTab = (index: number) => {
    if (index === tabIndex) return
    if (editingRef.current) finishEdit()
    setRenamingTab(false)
    updateSheet(sheet.id, { activeTab: index })
  }

  const addTab = () => {
    if (editingRef.current) finishEdit()
    const current = sheetRef.current
    const names = new Set(current.tabs.map((item) => item.name))
    let n = current.tabs.length + 1
    while (names.has(t('工作表 {n}', { n }))) n += 1
    const nextTab: SheetTab = {
      id: uid(),
      name: t('工作表 {n}', { n }),
      cells: {},
      rows: 80,
      cols: 18,
      colWidths: {},
    }
    updateSheet(current.id, { tabs: [...current.tabs, nextTab], activeTab: current.tabs.length })
  }

  const duplicateTab = () => {
    const current = sheetRef.current
    const source = current.tabs[tabIndex]
    if (!source) return
    const names = new Set(current.tabs.map((item) => item.name))
    let name = t('{name} 副本', { name: source.name })
    let n = 2
    while (names.has(name)) {
      name = t('{name} 副本 {n}', { name: source.name, n })
      n += 1
    }
    const cells: Record<string, CellData> = {}
    Object.entries(source.cells).forEach(([key, value]) => {
      cells[key] = { raw: value.raw, ...(value.style ? { style: { ...value.style } } : {}) }
    })
    const copy: SheetTab = {
      id: uid(),
      name,
      cells,
      rows: source.rows,
      cols: source.cols,
      colWidths: { ...source.colWidths },
      rowHeights: source.rowHeights ? { ...source.rowHeights } : undefined,
      charts: source.charts?.map((chart) => ({ ...chart, id: uid() })),
      merges: source.merges?.map((merge) => ({ ...merge })),
      freeze: source.freeze ? { ...source.freeze } : undefined,
      filters: source.filters
        ? { ...source.filters, rules: source.filters.rules.map((rule) => ({ ...rule, values: [...rule.values] })) }
        : undefined,
      conditional: source.conditional?.map((rule) => ({ ...rule, id: uid() })),
      validations: source.validations?.map((rule) => ({ ...rule, id: uid(), list: [...rule.list] })),
      comments: source.comments ? { ...source.comments } : undefined,
      protected: source.protected,
    }
    const tabs = [...current.tabs]
    tabs.splice(tabIndex + 1, 0, copy)
    updateSheet(current.id, { tabs, activeTab: tabIndex + 1 })
    toast(t('已复制工作表'), 'success')
  }

  const deleteTab = () => {
    const current = sheetRef.current
    if (current.tabs.length <= 1) return
    const tabs = current.tabs.filter((_, index) => index !== tabIndex)
    updateSheet(current.id, { tabs, activeTab: Math.min(tabIndex, tabs.length - 1) })
    toast(t('工作表已删除'))
  }

  const commitRename = () => {
    const name = renameDraft.trim().slice(0, 31)
    setRenamingTab(false)
    if (!name || name === tab.name) return
    const current = sheetRef.current
    updateSheet(current.id, {
      tabs: current.tabs.map((item, index) => (index === tabIndex ? { ...item, name } : item)),
    })
  }

  const handleTitleChange = (value: string) => {
    setTitleDraft(value)
    if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current)
    titleTimerRef.current = window.setTimeout(() => {
      updateSheet(sheetRef.current.id, { title: value.trim() || t('未命名表格') })
    }, 420)
  }

  const commitTitle = () => {
    if (titleTimerRef.current) window.clearTimeout(titleTimerRef.current)
    updateSheet(sheetRef.current.id, { title: titleDraft.trim() || t('未命名表格') })
  }

  const handleUndo = () => {
    if (editingRef.current) finishEdit()
    undo()
  }

  const handleRedo = () => {
    if (editingRef.current) finishEdit()
    redo()
  }

  const applyStyle = (patch: StylePatch) => {
    if (editingRef.current) finishEdit()
    patchStyle(toRange(selectionRef.current, tabRef.current.rows, tabRef.current.cols), patch)
  }

  const handleAutoSum = () => {
    if (editingRef.current) finishEdit()
    const current = liveTab()
    const currentEvaluator = new SheetEvaluator(current)
    const box = toRange(selectionRef.current, current.rows, current.cols)
    let targetRow = box.r2 + 1
    let targetCol = box.c1
    let formula = ''
    if (box.rows === 1 && box.cols === 1) {
      let top = box.r1 - 1
      while (top >= 0 && typeof currentEvaluator.valueAt(top, box.c1) === 'number') top -= 1
      const start = top + 1
      if (start > box.r1 - 1) {
        toast(t('上方没有可求和的数字'), 'info')
        return
      }
      formula = `=SUM(${colToName(box.c1)}${start + 1}:${colToName(box.c1)}${box.r1})`
    } else {
      formula = `=SUM(${colToName(box.c1)}${box.r1 + 1}:${colToName(box.c2)}${box.r2 + 1})`
    }
    if (targetRow >= current.rows) {
      toast(t('下方已没有空行可写入'), 'info')
      return
    }
    commitCells([{ row: targetRow, col: targetCol, raw: formula }])
    setSingleSelection(targetRow, targetCol)
  }

  const updateWithHistory = (current: SheetTab, patch: Partial<SheetTab>) => {
    pushHistoryFor(current)
    updateSheetTab(sheetRef.current.id, tabIndexRef.current, (value) => ({ ...value, ...patch }))
  }

  const sortByColumn = (direction: 'asc' | 'desc') => {
    if (editingRef.current) finishEdit()
    const current = liveTab()
    if (guardProtected(current)) return
    const evaluatorNow = new SheetEvaluator(current)
    const selected = toRange(selectionRef.current, current.rows, current.cols)
    const single = selected.rows === 1 && selected.cols === 1
    const block = contentBlock(current)
    const box: RangeBox = single
      ? { ...block, rows: block.r2 - block.r1 + 1, cols: block.c2 - block.c1 + 1 }
      : selected
    if (box.r2 <= box.r1) {
      toast(t('这里还没有可排序的数据'), 'info')
      return
    }
    const anchor = selectionRef.current.anchor
    const targetCol = anchor.col >= box.c1 && anchor.col <= box.c2 ? anchor.col : box.c1
    const overlapsMerge = (current.merges ?? []).some(
      (merge) => !(merge.r2 < box.r1 || merge.r1 > box.r2 || merge.c2 < box.c1 || merge.c1 > box.c2),
    )
    if (overlapsMerge) {
      toast(t('排序区域包含合并单元格，请先取消合并'), 'error')
      return
    }

    const rowHasText = Array.from({ length: box.cols }, (_, index) => box.c1 + index).some((col) => {
      const cell = current.cells[cellKey(box.r1, col)]
      return Boolean(cell?.raw.trim()) && typeof evaluatorNow.valueAt(box.r1, col) !== 'number'
    })
    const rowHasNumber = Array.from({ length: box.cols }, (_, index) => box.c1 + index).some(
      (col) => typeof evaluatorNow.valueAt(box.r1, col) === 'number',
    )
    let belowHasNumber = false
    for (let row = box.r1 + 1; row <= box.r2 && !belowHasNumber; row += 1) {
      for (let col = box.c1; col <= box.c2; col += 1) {
        if (typeof evaluatorNow.valueAt(row, col) === 'number') {
          belowHasNumber = true
          break
        }
      }
    }
    const keepHeader = rowHasText && !rowHasNumber && belowHasNumber
    const start = keepHeader ? box.r1 + 1 : box.r1
    if (start >= box.r2) {
      toast(t('只有表头，没有可以排序的记录'), 'info')
      return
    }

    const entries = [] as Array<{ cells: Array<{ col: number; cell?: CellData }>; number: number | null; text: string }>
    for (let row = start; row <= box.r2; row += 1) {
      const cells: Array<{ col: number; cell?: CellData }> = []
      for (let col = box.c1; col <= box.c2; col += 1) {
        cells.push({ col, cell: current.cells[cellKey(row, col)] })
      }
      const value = evaluatorNow.valueAt(row, targetCol)
      entries.push({
        cells,
        number: typeof value === 'number' ? value : null,
        text: cellText(current, evaluatorNow, row, targetCol),
      })
    }
    const sign = direction === 'asc' ? 1 : -1
    entries.sort((a, b) => {
      const aBlank = !a.text.trim() && a.number === null
      const bBlank = !b.text.trim() && b.number === null
      if (aBlank && bBlank) return 0
      if (aBlank) return 1
      if (bBlank) return -1
      if (a.number !== null && b.number !== null) return (a.number - b.number) * sign
      if (a.number !== null) return -1 * sign
      if (b.number !== null) return 1 * sign
      return a.text.localeCompare(b.text, 'zh-CN', { numeric: true, sensitivity: 'base' }) * sign
    })

    const cells = { ...current.cells }
    for (let row = start; row <= box.r2; row += 1) {
      for (let col = box.c1; col <= box.c2; col += 1) delete cells[cellKey(row, col)]
    }
    entries.forEach((entry, index) => {
      const row = start + index
      entry.cells.forEach((item) => {
        if (item.cell) cells[cellKey(row, item.col)] = item.cell
      })
    })
    updateWithHistory(current, { cells })
    setSelection({
      anchor: { row: start, col: box.c1 },
      focus: { row: box.r2, col: box.c2 },
    })
    toast(
      t('已按 {col} 列{direction}排序{suffix}', {
        col: colToName(targetCol),
        direction: direction === 'asc' ? t('升序') : t('降序'),
        suffix: keepHeader ? t('，表头保持不动') : '',
      }),
      'success',
    )
  }

  const toggleMerge = () => {
    if (editingRef.current) finishEdit()
    const current = liveTab()
    if (guardProtected(current)) return
    const box = toRange(selectionRef.current, current.rows, current.cols)
    const mergesNow = current.merges ?? []
    const anchor = selectionRef.current.anchor
    const anchored = mergesNow.find(
      (merge) => anchor.row >= merge.r1 && anchor.row <= merge.r2 && anchor.col >= merge.c1 && anchor.col <= merge.c2,
    )
    if (box.rows === 1 && box.cols === 1) {
      if (!anchored) {
        toast(t('先框选两个以上单元格，再合并'), 'info')
        return
      }
      updateWithHistory(current, { merges: mergesNow.filter((merge) => merge !== anchored) })
      toast(t('已取消合并'))
      return
    }
    if (anchored && anchored.r1 === box.r1 && anchored.r2 === box.r2 && anchored.c1 === box.c1 && anchored.c2 === box.c2) {
      updateWithHistory(current, { merges: mergesNow.filter((merge) => merge !== anchored) })
      toast('已取消合并')
      return
    }
    const overlap = mergesNow.some(
      (merge) => !(merge.r2 < box.r1 || merge.r1 > box.r2 || merge.c2 < box.c1 || merge.c1 > box.c2),
    )
    if (overlap) {
      toast(t('选区与已有合并区域重叠，请先取消原来的合并'), 'error')
      return
    }
    updateWithHistory(current, {
      merges: [...mergesNow, { r1: box.r1, r2: box.r2, c1: box.c1, c2: box.c2 }],
    })
    setSelection({ anchor: { row: box.r1, col: box.c1 }, focus: { row: box.r2, col: box.c2 } })
    toast(t('已合并 {rows} × {cols} 个单元格', { rows: box.rows, cols: box.cols }), 'success')
  }

  const applyFreeze = (rows: number, cols: number) => {
    const current = liveTab()
    const same = (current.freeze?.rows ?? 0) === rows && (current.freeze?.cols ?? 0) === cols
    const next = same || (rows === 0 && cols === 0) ? undefined : { rows, cols }
    updateWithHistory(current, { freeze: next })
    if (!next) toast(t('已取消冻结窗格'))
    else {
      const pieces = [rows > 0 ? t('{n} 行', { n: rows }) : '', cols > 0 ? t('{n} 列', { n: cols }) : ''].filter(Boolean)
      toast(t('已冻结 {parts}', { parts: pieces.join(t(' 和 ')) }), 'success')
    }
  }

  const freezeAtSelection = () => {
    const anchor = selectionRef.current.anchor
    if (anchor.row === 0 && anchor.col === 0) {
      toast(t('请选中一行或一列之后再冻结'), 'info')
      return
    }
    applyFreeze(anchor.row, anchor.col)
  }

  const openFilter = () => {
    if (editingRef.current) finishEdit()
    const current = liveTab()
    let filter = current.filters
    if (!filter) {
      const box = toRange(selectionRef.current, current.rows, current.cols)
      const multi = box.rows > 1 || box.cols > 1
      const range = multi
        ? { r1: box.r1, r2: box.r2, c1: box.c1, c2: box.c2 }
        : contentBlock(current)
      filter = { ...range, rules: [] }
      updateWithHistory(current, { filters: filter })
    }
    const anchor = selectionRef.current.anchor
    setFilterCol(anchor.col >= filter.c1 && anchor.col <= filter.c2 ? anchor.col : filter.c1)
    setFilterOpen(true)
  }

  const applyFilterRule = (col: number, values: string[]) => {
    const current = liveTab()
    const filter = current.filters
    if (!filter) return
    const evaluatorNow = new SheetEvaluator(current)
    const all = new Set<string>()
    for (let row = filter.r1 + 1; row <= filter.r2; row += 1) {
      const cell = current.cells[cellKey(row, col)]
      if (!cell?.raw.trim()) continue
      all.add(cellText(current, evaluatorNow, row, col))
    }
    const keep = values.length < all.size
    const rules = filter.rules.filter((rule) => rule.col !== col)
    if (keep) rules.push({ col, values })
    updateWithHistory(current, { filters: { ...filter, rules } })
    const name = cellText(current, evaluatorNow, filter.r1, col) || colToName(col)
    const anchor = selectionRef.current.anchor
    const anchorHidden =
      anchor.row > filter.r1 &&
      anchor.row <= filter.r2 &&
      rules.some((rule) => {
        const cell = current.cells[cellKey(anchor.row, rule.col)]
        const text = cell?.raw.trim() ? cellText(current, evaluatorNow, anchor.row, rule.col) : ''
        return !rule.values.includes(text)
      })
    if (anchorHidden) {
      const firstVisible = Array.from({ length: filter.r2 - filter.r1 }, (_, index) => filter.r1 + 1 + index).find(
        (row) =>
          !rules.some((rule) => {
            const cell = current.cells[cellKey(row, rule.col)]
            const text = cell?.raw.trim() ? cellText(current, evaluatorNow, row, rule.col) : ''
            return !rule.values.includes(text)
          }),
      )
      if (firstVisible !== undefined) setSingleSelection(firstVisible, col)
    }
    if (keep) {
      toast(
        values.length === 0
          ? t('已按「{name}」隐藏所有记录', { name })
          : t('已按「{name}」保留 {n} 个值', { name, n: values.length }),
        'success',
      )
    } else toast(t('已清除「{name}」的筛选', { name }))
  }

  const removeFilterRule = (col: number) => {
    const current = liveTab()
    if (!current.filters) return
    updateWithHistory(current, {
      filters: { ...current.filters, rules: current.filters.rules.filter((rule) => rule.col !== col) },
    })
    toast(t('已移除该列筛选'))
  }

  const clearFilters = () => {
    const current = liveTab()
    if (!current.filters?.rules.length) return
    updateWithHistory(current, { filters: { ...current.filters, rules: [] } })
    toast(t('已清除全部筛选'))
  }

  const openDataTool = (tool: 'validation' | 'split' | 'dedupe') => {
    if (editingRef.current) finishEdit()
    const current = liveTab()
    const box = toRange(selectionRef.current, current.rows, current.cols)
    let scope: RangeBox = box
    if (tool === 'split') {
      const single = box.rows === 1 && box.cols === 1
      const bottom = single
        ? clamp(Math.max(box.r1, usedBounds(current).rows - 1), box.r1, current.rows - 1)
        : box.r2
      scope = { r1: box.r1, r2: bottom, c1: box.c1, c2: box.c1, rows: bottom - box.r1 + 1, cols: 1 }
    } else if (tool === 'dedupe' && box.rows === 1 && box.cols === 1) {
      const block = contentBlock(current)
      scope = { ...block, rows: block.r2 - block.r1 + 1, cols: block.c2 - block.c1 + 1 }
    }
    if (tool === 'dedupe' && scope.rows < 2) {
      toast(t('在当前区域没有找到可去重的多行数据'), 'info')
      return
    }
    setDataScope(scope)
    setDataTool(tool)
  }

  const applyValidation = (draft: ValidationDraft, existingId?: string) => {
    const current = liveTab()
    if (guardProtected(current)) return
    const validations = [...(current.validations ?? [])]
    const id = existingId ?? uid()
    const next: SheetValidation = { id, ...draft }
    const index = validations.findIndex((rule) => rule.id === id)
    if (index >= 0) validations[index] = next
    else {
      const sameRange = validations.findIndex(
        (rule) => rule.r1 === draft.r1 && rule.r2 === draft.r2 && rule.c1 === draft.c1 && rule.c2 === draft.c2,
      )
      if (sameRange >= 0) validations[sameRange] = next
      else validations.push(next)
    }
    updateWithHistory(current, { validations })
    toast(existingId ? t('数据有效性已更新') : t('已应用数据有效性'), 'success')
    setDataTool(null)
  }

  const removeValidation = (id: string) => {
    const current = liveTab()
    if (guardProtected(current)) return
    const validations = (current.validations ?? []).filter((rule) => rule.id !== id)
    if (validations.length === (current.validations?.length ?? 0)) return
    updateWithHistory(current, { validations })
    toast(t('有效性规则已删除'))
  }

  const clearValidation = () => {
    const current = liveTab()
    if (guardProtected(current)) return
    const scope = dataScope
    if (!scope) return
    const validations = (current.validations ?? []).filter((rule) => !rectsOverlap(rule, scope))
    if (validations.length === (current.validations?.length ?? 0)) {
      setDataTool(null)
      return
    }
    updateWithHistory(current, { validations })
    toast(t('已清除该区域的数据有效性'), 'success')
    setDataTool(null)
  }

  const applySplit = (delimiter: string) => {
    const scope = dataScope
    if (!scope || !delimiter) return
    const current = liveTab()
    if (guardProtected(current)) return
    const { r1, r2, c1 } = scope
    const affected: RangeBox = { r1, r2, c1, c2: current.cols - 1, rows: r2 - r1 + 1, cols: current.cols - c1 }
    if (current.merges?.some((merge) => rectsOverlap(merge, affected))) {
      toast(t('分列区域所在行包含合并单元格，请先取消合并'), 'error')
      return
    }
    const cells = { ...current.cells }
    let splitRows = 0
    let widest = 1
    for (let row = r1; row <= r2; row += 1) {
      const source = cells[cellKey(row, c1)]
      const raw = source?.raw ?? ''
      if (!raw) continue
      const parts = splitText(raw, delimiter)
      if (parts.length <= 1) continue
      splitRows += 1
      widest = Math.max(widest, parts.length)
      const delta = parts.length - 1
      const segment: Array<{ col: number; cell: CellData | undefined }> = []
      for (let col = c1 + 1; col < current.cols; col += 1) {
        segment.push({ col, cell: cells[cellKey(row, col)] })
      }
      for (let col = c1 + 1; col < current.cols + delta; col += 1) {
        delete cells[cellKey(row, col)]
      }
      for (const item of segment) {
        if (!item.cell) continue
        cells[cellKey(row, item.col + delta)] = item.cell
      }
      parts.forEach((part, index) => {
        const key = cellKey(row, c1 + index)
        if (index === 0) cells[key] = source?.style ? { raw: part, style: source.style } : { raw: part }
        else cells[key] = { raw: part }
      })
    }
    if (!splitRows) {
      toast(t('没有找到可拆分的内容，请检查分隔符'), 'info')
      return
    }
    updateWithHistory(current, {
      cells,
      cols: Math.max(current.cols + widest - 1, c1 + widest + 2),
    })
    toast(t('已拆分 {rows} 行，最多拆成 {cols} 列', { rows: splitRows, cols: widest }), 'success')
    setDataTool(null)
  }

  const applyDedupe = (keyCols: number[], hasHeader: boolean) => {
    const scope = dataScope
    if (!scope || !keyCols.length) return
    const current = liveTab()
    if (guardProtected(current)) return
    const startRow = hasHeader ? scope.r1 + 1 : scope.r1
    const removed = new Set<number>()
    const seen = new Set<string>()
    for (let row = startRow; row <= scope.r2; row += 1) {
      const values = keyCols.map((col) => (current.cells[cellKey(row, col)]?.raw ?? '').trim())
      if (values.every((value) => !value)) continue
      const key = values.join('\u0001')
      if (seen.has(key)) removed.add(row)
      else seen.add(key)
    }
    if (!removed.size) {
      toast(t('没有发现重复项'), 'info')
      return
    }
    const removedRows = Array.from(removed).sort((a, b) => a - b)
    const shiftFor = (row: number) => {
      let count = 0
      for (const removedRow of removedRows) {
        if (removedRow < row) count += 1
        else break
      }
      return count
    }

    const cells: Record<string, CellData> = {}
    for (const [key, cell] of Object.entries(current.cells)) {
      const [row, col] = key.split(':').map(Number)
      if (removed.has(row)) continue
      cells[cellKey(row - shiftFor(row), col)] = cell
    }

    let rowHeights: Record<number, number> | undefined
    if (current.rowHeights) {
      const mapped: Record<number, number> = {}
      for (const [key, value] of Object.entries(current.rowHeights)) {
        const row = Number(key)
        if (removed.has(row)) continue
        mapped[row - shiftFor(row)] = value
      }
      rowHeights = Object.keys(mapped).length ? mapped : undefined
    }

    const merges = current.merges
      ?.filter((merge) => !removedRows.some((row) => row >= merge.r1 && row <= merge.r2))
      .map((merge) => {
        const delta = shiftFor(merge.r1)
        return { ...merge, r1: merge.r1 - delta, r2: merge.r2 - delta }
      })

    const validations = current.validations?.map((rule) => {
      const r1 = rule.r1 - shiftFor(rule.r1)
      return { ...rule, r1, r2: Math.max(r1, rule.r2 - shiftFor(rule.r2)) }
    })

    const conditional = current.conditional?.map((rule) => {
      const r1 = rule.r1 - shiftFor(rule.r1)
      return { ...rule, r1, r2: Math.max(r1, rule.r2 - shiftFor(rule.r2)) }
    })

    const charts = current.charts?.flatMap((chart) => {
      if (removedRows.some((row) => row >= chart.r1 && row <= chart.r2)) return []
      const delta = shiftFor(chart.r1)
      return [{ ...chart, r1: chart.r1 - delta, r2: chart.r2 - delta }]
    })

    const filters = (() => {
      const active = current.filters
      if (!active) return undefined
      const r1 = active.r1 - shiftFor(active.r1)
      return { ...active, r1, r2: Math.max(r1, active.r2 - shiftFor(active.r2)) }
    })()

    const freeze = current.freeze
      ? {
          ...current.freeze,
          rows: Math.max(0, current.freeze.rows - removedRows.filter((row) => row < (current.freeze?.rows ?? 0)).length),
        }
      : undefined

    updateWithHistory(current, {
      cells,
      rowHeights,
      merges: merges?.length ? merges : undefined,
      validations,
      conditional,
      charts: charts?.length ? charts : undefined,
      filters,
      freeze,
    })
    setSelection((value) =>
      clampSelection(
        {
          anchor: { row: value.anchor.row - shiftFor(value.anchor.row), col: value.anchor.col },
          focus: { row: value.focus.row - shiftFor(value.focus.row), col: value.focus.col },
        },
        current.rows,
        current.cols,
      ),
    )
    toast(t('已删除 {n} 行重复项', { n: removed.size }), 'success')
    setDataTool(null)
  }

  const openConditional = (kind: ConditionalKind) => {
    if (editingRef.current) finishEdit()
    const current = liveTab()
    const box = toRange(selectionRef.current, current.rows, current.cols)
    const multi = box.rows > 1 || box.cols > 1
    const block = contentBlock(current)
    setConditionalScope(
      multi
        ? box
        : { ...block, rows: block.r2 - block.r1 + 1, cols: block.c2 - block.c1 + 1 },
    )
    setConditionalKind(kind)
    setConditionalOpen(true)
  }

  const addConditional = (rule: ConditionalRule) => {
    const current = liveTab()
    if (guardProtected(current)) return
    updateWithHistory(current, { conditional: [...(current.conditional ?? []), rule] })
    toast(t('条件格式已启用'), 'success')
  }

  const removeConditional = (id: string) => {
    const current = liveTab()
    if (guardProtected(current)) return
    updateWithHistory(current, { conditional: (current.conditional ?? []).filter((rule) => rule.id !== id) })
    toast(t('规则已删除'))
  }

  const chartTitleFor = (
    current: SheetTab,
    box: { r1: number; r2: number; c1: number; c2: number },
    headerRow: boolean,
    headerCol: boolean,
    kind: SheetChartKind,
  ): string => {
    const evaluatorNow = new SheetEvaluator(current)
    const startCol = headerCol ? box.c1 + 1 : box.c1
    const headers: string[] = []
    for (let col = startCol; col <= box.c2; col += 1) {
      headers.push(headerRow ? cellText(current, evaluatorNow, box.r1, col) : '')
    }
    const named = headers.filter(Boolean)
    const suffix =
      kind === 'line' || kind === 'area'
        ? t('趋势')
        : kind === 'pie'
          ? t('构成')
          : kind === 'donut'
            ? t('占比')
            : t('对比')
    if (named.length === 1) return `${named[0]} ${suffix}`
    if (named.length > 1) {
      if (kind === 'pie' || kind === 'donut') return `${named[0]} ${suffix}`
      return `${named[0]}–${named[named.length - 1]} ${suffix}`
    }
    const category = headerCol && headerRow ? cellText(current, evaluatorNow, box.r1, box.c1) : ''
    return category ? `${category} ${suffix}` : t(CHART_KIND_LABELS[kind])
  }

  const openChartCreator = (kind: SheetChartKind = 'column') => {
    if (editingRef.current) finishEdit()
    const current = liveTab()
    const box = toRange(selectionRef.current, current.rows, current.cols)
    const multi = box.rows > 1 || box.cols > 1
    const block = contentBlock(current)
    const anchor = selectionRef.current.anchor
    const latest = current.charts?.[current.charts.length - 1]
    const insideLatest = latest && anchor.row >= latest.r1 && anchor.row <= latest.r2 && anchor.col >= latest.c1 && anchor.col <= latest.c2
    const range = multi
      ? box
      : insideLatest
        ? { r1: latest.r1, r2: latest.r2, c1: latest.c1, c2: latest.c2, rows: latest.r2 - latest.r1 + 1, cols: latest.c2 - latest.c1 + 1 }
        : { ...block, rows: block.r2 - block.r1 + 1, cols: block.c2 - block.c1 + 1 }
    const options = detectChartOptions(current, range.r1, range.r2, range.c1, range.c2)
    setChartEditor({
      kind,
      title: chartTitleFor(current, range, options.headerRow, options.headerCol, kind),
      r1: range.r1,
      r2: range.r2,
      c1: range.c1,
      c2: range.c2,
      ...options,
    })
  }

  const openChartEditor = (chart: SheetChart) => {
    setChartEditor({ ...chart })
  }

  const saveChart = (value: ChartEditorValue) => {
    const current = liveTab()
    if (guardProtected(current)) return
    const charts = current.charts ?? []
    const exists = Boolean(value.id && charts.some((chart) => chart.id === value.id))
    const chart: SheetChart = { ...value, id: value.id ?? uid() }
    const next = exists ? charts.map((item) => (item.id === chart.id ? chart : item)) : [...charts, chart]
    updateWithHistory(current, { charts: next })
    setChartEditor(null)
    setView('dashboard')
    toast(exists ? t('图表已更新') : t('图表已加入看板'), 'success')
  }

  const removeChart = (chart: SheetChart) => {
    const current = liveTab()
    if (guardProtected(current)) return
    updateWithHistory(current, { charts: (current.charts ?? []).filter((item) => item.id !== chart.id) })
    setChartToDelete(null)
    toast(t('图表已删除'))
  }

  const openComment = (pos?: CellPos) => {
    if (editingRef.current) finishEdit()
    const current = liveTab()
    if (pos) {
      setSingleSelection(pos.row, pos.col)
      setCommentCell({ row: pos.row, col: pos.col })
      return
    }
    const box = toRange(selectionRef.current, current.rows, current.cols)
    if (box.rows > 1 || box.cols > 1) {
      toast(t('请先选中一个单元格，再添加批注'), 'info')
      return
    }
    setCommentCell({ ...selectionRef.current.anchor })
  }

  const saveComment = (text: string) => {
    if (!commentCell) return
    const current = liveTab()
    if (guardProtected(current)) return
    const comments = { ...(current.comments ?? {}) }
    const key = cellKey(commentCell.row, commentCell.col)
    if (text.trim()) comments[key] = text.trim()
    else delete comments[key]
    updateWithHistory(current, { comments: Object.keys(comments).length ? comments : undefined })
    setCommentCell(null)
    toast(t('批注已保存'), 'success')
  }

  const deleteComment = (target?: CellPos) => {
    const current = liveTab()
    if (guardProtected(current)) return
    const cell = target ?? commentCell
    if (!cell) return
    const comments = { ...(current.comments ?? {}) }
    const key = cellKey(cell.row, cell.col)
    if (!comments[key]) return
    delete comments[key]
    updateWithHistory(current, { comments: Object.keys(comments).length ? comments : undefined })
    setCommentCell(null)
    toast(t('已删除批注'))
  }

  const jumpToNextComment = () => {
    const current = liveTab()
    const entries = Object.keys(current.comments ?? {})
      .map((key) => key.split(':').map(Number) as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    if (!entries.length) {
      toast(t('这张工作表还没有批注'), 'info')
      return
    }
    const anchor = selectionRef.current.anchor
    const next =
      entries.find(([row, col]) => row > anchor.row || (row === anchor.row && col > anchor.col)) ?? entries[0]
    setSingleSelection(next[0], next[1])
    toast(t('已跳到 {ref} 的批注', { ref: `${colToName(next[1])}${next[0] + 1}` }), 'success')
  }

  const setProtection = (next: boolean) => {
    const current = liveTab()
    if (Boolean(current.protected) === next) return
    pushHistoryFor(current)
    updateSheetTab(sheetRef.current.id, tabIndexRef.current, (value) => ({ ...value, protected: next }))
    setProtectPrompt(false)
    toast(next ? t('工作表已保护，单元格编辑已锁定') : t('已取消工作表保护'), 'success')
  }

  const stepZoom = (direction: 1 | -1) => {
    const index = ZOOM_LEVELS.findIndex((level) => Math.abs(level - zoom) < 0.001)
    const from = index < 0 ? ZOOM_LEVELS.indexOf(1) : index
    setZoom(ZOOM_LEVELS[clamp(from + direction, 0, ZOOM_LEVELS.length - 1)])
  }

  const commentAddress = commentCell ? `${colToName(commentCell.col)}${commentCell.row + 1}` : ''
  const commentValue = commentCell ? (tab.comments?.[cellKey(commentCell.row, commentCell.col)] ?? '') : ''
  const commentCount = Object.keys(tab.comments ?? {}).length

  const selectionTsv = (): string => {
    const current = liveTab()
    const box = toRange(selectionRef.current, current.rows, current.cols)
    const lines: string[] = []
    for (let row = box.r1; row <= box.r2; row += 1) {
      const values: string[] = []
      for (let col = box.c1; col <= box.c2; col += 1) {
        values.push(current.cells[cellKey(row, col)]?.raw ?? '')
      }
      lines.push(values.join('\t'))
    }
    return lines.join('\n')
  }

  const handleCopy = (cut = false) => {
    const tsv = selectionTsv()
    clipboardRef.current = tsv
    void navigator.clipboard?.writeText(tsv).catch(() => {})
    if (cut) clearRange(toRange(selectionRef.current, tabRef.current.rows, tabRef.current.cols))
  }

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editingRef.current) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key
    const current = liveTab()
    const box = toRange(selectionRef.current, current.rows, current.cols)
    const anchor = selectionRef.current.anchor

    if (mod) {
      const lower = key.toLowerCase()
      if (lower === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (lower === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (lower === 'b' || lower === 'i') {
        event.preventDefault()
        const style = current.cells[cellKey(anchor.row, anchor.col)]?.style
        applyStyle(lower === 'b' ? { bold: !style?.bold } : { italic: !style?.italic })
        return
      }
      if (lower === 'c') {
        event.preventDefault()
        handleCopy(false)
        return
      }
      if (lower === 'x') {
        event.preventDefault()
        handleCopy(true)
        return
      }
      if (lower === 'a') {
        event.preventDefault()
        setSelection({ anchor: { row: 0, col: 0 }, focus: { row: current.rows - 1, col: current.cols - 1 } })
        return
      }
      if (lower === 'l' && event.shiftKey) {
        event.preventDefault()
        openFilter()
        return
      }
      if (key === 'Home') {
        event.preventDefault()
        setSingleSelection(0, 0)
        return
      }
      if (key === 'End') {
        event.preventDefault()
        const used = usedBounds(current)
        setSingleSelection(used.rows - 1, used.cols - 1)
        return
      }
      return
    }

    if (event.altKey) return

    const moveFocus = (rowDelta: number, colDelta: number) => {
      const focus = selectionRef.current.focus
      const nextRow = clamp(focus.row + rowDelta, 0, current.rows - 1)
      const nextCol = clamp(focus.col + colDelta, 0, current.cols - 1)
      setSelection((value) =>
        event.shiftKey
          ? { ...value, focus: { row: nextRow, col: nextCol } }
          : { anchor: { row: nextRow, col: nextCol }, focus: { row: nextRow, col: nextCol } },
      )
      revealCell(nextRow, nextCol)
    }

    switch (key) {
      case 'ArrowUp':
        event.preventDefault()
        moveFocus(-1, 0)
        return
      case 'ArrowDown':
        event.preventDefault()
        moveFocus(1, 0)
        return
      case 'ArrowLeft':
        event.preventDefault()
        moveFocus(0, -1)
        return
      case 'ArrowRight':
        event.preventDefault()
        moveFocus(0, 1)
        return
      case 'Tab':
        event.preventDefault()
        moveFocus(0, event.shiftKey ? -1 : 1)
        return
      case 'Enter':
        event.preventDefault()
        moveFocus(event.shiftKey ? -1 : 1, 0)
        return
      case 'PageDown':
        event.preventDefault()
        moveFocus(20, 0)
        return
      case 'PageUp':
        event.preventDefault()
        moveFocus(-20, 0)
        return
      case 'Home':
        event.preventDefault()
        if (event.shiftKey) {
          setSelection((value) => ({ ...value, focus: { row: value.focus.row, col: 0 } }))
        } else {
          setSingleSelection(selectionRef.current.focus.row, 0)
        }
        return
      case 'End':
        event.preventDefault()
        setSingleSelection(selectionRef.current.focus.row, current.cols - 1)
        return
      case 'F2':
        event.preventDefault()
        beginEdit(anchor.row, anchor.col)
        return
      case 'Escape':
        event.preventDefault()
        draggingRef.current = false
        return
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        clearRange(box)
        return
      default:
        break
    }

    if (key.length === 1) {
      event.preventDefault()
      beginEdit(anchor.row, anchor.col, key)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editingRef.current) return
    const text = event.clipboardData.getData('text/plain') || clipboardRef.current
    if (!text) return
    event.preventDefault()
    const matrix = textToMatrix(text)
    if (!matrix.length) return
    const anchor = selectionRef.current.anchor
    applyMatrix(anchor.row, anchor.col, matrix)
    const lastRow = anchor.row + Math.min(matrix.length, MAX_PASTE_ROWS) - 1
    const lastCol = anchor.col + Math.min(MAX_PASTE_COLS, Math.max(...matrix.map((line) => line.length))) - 1
    setSelection({ anchor: { row: anchor.row, col: anchor.col }, focus: { row: lastRow, col: lastCol } })
  }

  const handleCellMouseDown = (event: ReactMouseEvent<HTMLDivElement>, row: number, col: number) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.sheet-cell-input') || target.closest('.sheet-filter-btn')) return
    if (editingRef.current) finishEdit()
    const merge = mergeCover.get(cellKey(row, col))
    if (merge) {
      setSelection({
        anchor: { row: merge.r1, col: merge.c1 },
        focus: { row: merge.r2, col: merge.c2 },
      })
      draggingRef.current = false
      gridRef.current?.focus({ preventScroll: true })
      event.preventDefault()
      return
    }
    const extend = event.shiftKey
    setSelection((value) =>
      extend
        ? { ...value, focus: { row, col } }
        : { anchor: { row, col }, focus: { row, col } },
    )
    draggingRef.current = true
    gridRef.current?.focus({ preventScroll: true })
    event.preventDefault()
  }

  const handleCellMouseEnter = (row: number, col: number) => {
    if (!draggingRef.current) return
    setSelection((value) => ({ ...value, focus: { row, col } }))
  }

  const handleCellDoubleClick = (row: number, col: number) => {
    beginEdit(row, col, undefined, 'cell', true)
  }

  const handleCellEditKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finishEdit(event.shiftKey ? 'up' : 'down')
    } else if (event.key === 'Tab') {
      event.preventDefault()
      finishEdit(event.shiftKey ? 'left' : 'right')
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelEdit()
    }
  }

  const handleBarKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finishEdit('down')
    } else if (event.key === 'Tab') {
      event.preventDefault()
      finishEdit('right')
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelEdit()
    }
  }

  const handleBarFocus = () => {
    if (editingRef.current) return
    const anchor = selectionRef.current.anchor
    beginEdit(anchor.row, anchor.col, undefined, 'bar')
  }

  const selectColumn = (col: number, extend: boolean) => {
    if (editingRef.current) finishEdit()
    const current = tabRef.current
    setSelection((value) =>
      extend
        ? { ...value, focus: { row: current.rows - 1, col } }
        : { anchor: { row: 0, col }, focus: { row: current.rows - 1, col } },
    )
    focusGrid()
  }

  const selectRow = (row: number, extend: boolean) => {
    if (editingRef.current) finishEdit()
    const current = tabRef.current
    setSelection((value) =>
      extend
        ? { ...value, focus: { row, col: current.cols - 1 } }
        : { anchor: { row, col: 0 }, focus: { row, col: current.cols - 1 } },
    )
    focusGrid()
  }

  const selectAll = () => {
    if (editingRef.current) finishEdit()
    const current = tabRef.current
    setSelection({ anchor: { row: 0, col: 0 }, focus: { row: current.rows - 1, col: current.cols - 1 } })
    focusGrid()
  }

  const startResize = (event: ReactMouseEvent<HTMLElement>, col: number) => {
    event.preventDefault()
    event.stopPropagation()
    if (guardProtected(liveTab())) return
    const startX = event.clientX
    const startWidth = widths[col]
    const onMove = (move: MouseEvent) => {
      const next = clamp(startWidth + (move.clientX - startX) / zoom, MIN_COL_WIDTH, MAX_COL_WIDTH)
      setLiveWidths((value) => ({ ...(value ?? {}), [col]: next }))
    }
    const onUp = (up: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const next = clamp(startWidth + (up.clientX - startX) / zoom, MIN_COL_WIDTH, MAX_COL_WIDTH)
      setLiveWidths(null)
      if (next === startWidth) return
      const current = liveTab()
      pushHistoryFor(current)
      updateSheetTab(sheetRef.current.id, tabIndexRef.current, (value) => ({
        ...value,
        colWidths: { ...value.colWidths, [col]: next },
      }))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const autoFitColumn = (col: number) => {
    if (guardProtected(liveTab())) return
    const current = liveTab()
    const currentEvaluator = new SheetEvaluator(current)
    let widest = 4
    for (let row = 0; row < Math.min(current.rows, 120); row += 1) {
      const text = displayValue(current, currentEvaluator, row, col)
      widest = Math.max(widest, estimateTextWidth(text))
    }
    const next = clamp(Math.round(widest + 24), MIN_COL_WIDTH, MAX_COL_WIDTH)
    if (next === (current.colWidths[col] ?? DEFAULT_COL_WIDTH)) return
    pushHistoryFor(current)
    updateSheetTab(sheetRef.current.id, tabIndexRef.current, (value) => ({
      ...value,
      colWidths: { ...value.colWidths, [col]: next },
    }))
  }

  const exportXlsx = async () => {
    if (editingRef.current) finishEdit()
    setExporting(true)
    try {
      const blob = await workbookToXlsxBlob(sheetRef.current.tabs)
      downloadBlob(blob, safeFilename(sheetRef.current.title, 'xlsx'))
      toast(t('已导出 Excel 工作簿'), 'success')
    } catch (error) {
      toast((error as Error).message || t('导出失败'), 'error')
    } finally {
      setExporting(false)
    }
  }

  const exportCsv = () => {
    if (editingRef.current) finishEdit()
    const current = sheetRef.current
    const active = current.tabs[tabIndexRef.current]
    downloadText(tabToCsv(active), safeFilename(`${current.title}-${active.name}`, 'csv'), 'text/csv')
    toast(t('已导出当前工作表为 CSV'), 'success')
  }

  const detailText = (() => {
    const pieces: string[] = [t('{n} 格', { n: range.rows * range.cols })]
    if (range.rows * range.cols > 1) {
      let numbers = 0
      let sum = 0
      for (let row = range.r1; row <= range.r2; row += 1) {
        for (let col = range.c1; col <= range.c2; col += 1) {
          const value = evaluator.valueAt(row, col)
          if (typeof value === 'number') {
            numbers += 1
            sum += value
          }
        }
      }
      if (numbers > 0) {
        pieces.push(t('求和 {value}', { value: formatCellNumber(sum, 'general') }))
        pieces.push(t('平均 {value}', { value: formatCellNumber(sum / numbers, 'general') }))
      }
    }
    return pieces.join(' · ')
  })()

  const contentRows = usedBounds(tab).rows

  return (
    <div className="sheet-workbook">
      <header className="sheet-head">
        <div className="sheet-head-text">
          <input
            className="sheet-title"
            value={titleDraft}
            onChange={(event) => handleTitleChange(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
            aria-label={t('表格标题')}
            spellCheck={false}
          />
          <div className="sheet-meta">
            <span>{t('{n} 个工作表', { n: sheet.tabs.length })}</span>
            <span className="sheet-meta-sep" />
            <span>{t('{n} 行有内容', { n: contentRows })}</span>
            <span className="sheet-meta-sep" />
            <span className="sheet-meta-save">
              <span className="dot" />
              {t('自动保存在本机')}
            </span>
          </div>
        </div>
        <div className="sheet-head-actions">
          <div className="segmented sheet-view-switch" role="group" aria-label={t('表格视图')}>
            <button
              type="button"
              className={view === 'grid' ? 'active' : undefined}
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
            >
              <Table2 size={13} />
              <span>{t('表格')}</span>
            </button>
            <button
              type="button"
              className={view === 'dashboard' ? 'active' : undefined}
              aria-pressed={view === 'dashboard'}
              onClick={() => setView('dashboard')}
            >
              <LayoutDashboard size={13} />
              <span>{t('看板')}</span>
              {(tab.charts?.length ?? 0) > 0 && <em className="sheet-view-count">{tab.charts?.length}</em>}
            </button>
          </div>
          <button
            type="button"
            className="sheet-ai-btn"
            onClick={() => openAiTask()}
            title={t('打开 AI 任务窗口，让 AI 处理当前表格')}
          >
            <Sparkles size={14} />
            {t('AI 任务')}
          </button>
          <Dropdown
            className="sheet-export-btn"
            trigger={
              <>
                <Download size={14} />
                {t('导出')}
                <ChevronDown size={12} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('导出工作簿')}</div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    void exportXlsx()
                  }}
                  disabled={exporting}
                >
                  <FileSpreadsheet size={15} />
                  {t('Excel 工作簿（.xlsx）')}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    exportCsv()
                  }}
                >
                  <FileDown size={15} />
                  {t('当前表 CSV')}
                </button>
                <div className="menu-sep" />
                <button
                  type="button"
                  className="menu-item danger"
                  onClick={() => {
                    close()
                    setConfirmDeleteSheet(true)
                  }}
                >
                  <Trash2 size={15} />
                  {t('删除这张表格')}
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </header>

      {view === 'grid' && (
        <>
      <div className="sheet-toolbar" role="toolbar" aria-label={t('表格格式')}>
        <div className="sheet-tool-group">
          <button
            type="button"
            className="sheet-tool-btn"
            onClick={handleUndo}
            disabled={!historyRef.current.get(tab.id)?.undo.length}
            title={t('撤销（Ctrl+Z）')}
            aria-label={t('撤销')}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            className="sheet-tool-btn"
            onClick={handleRedo}
            disabled={!historyRef.current.get(tab.id)?.redo.length}
            title={t('重做（Ctrl+Shift+Z）')}
            aria-label={t('重做')}
          >
            <Redo2 size={15} />
          </button>
        </div>
        <span className="sheet-tool-sep" />
        <div className="sheet-tool-group">
          <Dropdown
            className="sheet-tool-btn sheet-tool-drop"
            align="left"
            portal
            title={t('排序')}
            trigger={
              <>
                <ArrowDownUp size={14} />
                <ChevronDown size={10} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('按 {col} 列排序', { col: colToName(selection.anchor.col) })}</div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    sortByColumn('asc')
                  }}
                >
                  <ArrowDownUp size={14} />
                  {t('升序排列')}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    sortByColumn('desc')
                  }}
                >
                  <ArrowDownUp size={14} style={{ transform: 'scaleY(-1)' }} />
                  {t('降序排列')}
                </button>
                <p className="sheet-menu-hint">{t('单选单元格时会自动识别整张表与表头。')}</p>
              </>
            )}
          </Dropdown>
          <button
            type="button"
            className={cn('sheet-tool-btn', filterActive && 'active')}
            onClick={openFilter}
            title={t('筛选（Ctrl+Shift+L）')}
            aria-label={t('筛选')}
            aria-pressed={filterActive}
          >
            <Filter size={14} />
            {filterActive && <span className="sheet-tool-dot" />}
          </button>
          <Dropdown
            className={cn('sheet-tool-btn sheet-tool-drop', ((tab.freeze?.rows ?? 0) > 0 || (tab.freeze?.cols ?? 0) > 0) && 'active')}
            align="left"
            portal
            title={t('冻结窗格')}
            trigger={
              <>
                <Snowflake size={14} />
                <ChevronDown size={10} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('冻结窗格')}</div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    applyFreeze(1, 0)
                  }}
                >
                  <Snowflake size={14} />
                  {t('冻结首行')}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    applyFreeze(0, 1)
                  }}
                >
                  <Snowflake size={14} />
                  {t('冻结首列')}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    applyFreeze(1, 1)
                  }}
                >
                  <Snowflake size={14} />
                  {t('冻结首行和首列')}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    freezeAtSelection()
                  }}
                >
                  <Snowflake size={14} />
                  {t('冻结至当前单元格')}
                </button>
                <div className="menu-sep" />
                <button
                  type="button"
                  className="menu-item"
                  disabled={!tab.freeze}
                  onClick={() => {
                    close()
                    applyFreeze(0, 0)
                  }}
                >
                  {t('取消冻结')}
                </button>
              </>
            )}
          </Dropdown>
          <button
            type="button"
            className={cn(
              'sheet-tool-btn',
              Boolean(mergeCover.get(cellKey(selection.anchor.row, selection.anchor.col))) && 'active',
            )}
            onClick={toggleMerge}
            title={t('合并 / 取消合并单元格')}
            aria-label={t('合并单元格')}
          >
            <Merge size={14} />
          </button>
          <Dropdown
            className={cn('sheet-tool-btn sheet-tool-drop', (tab.conditional?.length ?? 0) > 0 && 'active')}
            align="left"
            portal
            title={t('条件格式')}
            trigger={
              <>
                <Paintbrush size={14} />
                <ChevronDown size={10} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('快速添加')}</div>
                {(
                  [
                    ['dataBar', '数据条'],
                    ['colorScale', '色阶'],
                    ['greater', '大于…'],
                    ['less', '小于…'],
                    ['between', '介于…'],
                    ['duplicate', '重复值'],
                  ] as Array<[ConditionalKind, string]>
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      close()
                      openConditional(kind)
                    }}
                  >
                    <Paintbrush size={14} />
                    {t(label)}
                  </button>
                ))}
                <div className="menu-sep" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    openConditional('dataBar')
                  }}
                >
                  {t('管理全部规则')}
                  {tab.conditional?.length ? t('（{n}）', { n: tab.conditional.length }) : ''}
                </button>
              </>
            )}
          </Dropdown>
          <button type="button" className="sheet-chart-insert-btn" onClick={() => openChartCreator()} title={t('从当前选区插入图表')}>
            <ChartColumn size={14} />
            {t('图表')}
          </button>
          <Dropdown
            className="sheet-data-btn"
            align="left"
            portal
            title={t('数据工具')}
            trigger={
              <>
                <Database size={14} />
                {t('数据')}
                <ChevronDown size={10} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('数据工具')}</div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    openDataTool('validation')
                  }}
                >
                  <ListChecks size={14} />
                  {t('数据有效性…')}
                  {tab.validations?.length ? t('（{n}）', { n: tab.validations.length }) : ''}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    openDataTool('split')
                  }}
                >
                  <SplitSquareHorizontal size={14} />
                  {t('文本分列…')}
                </button>
                <div className="menu-sep" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    openDataTool('dedupe')
                  }}
                >
                  <CopyX size={14} />
                  {t('删除重复项…')}
                </button>
                <p className="sheet-menu-hint">
                  {t('有效性会校验输入并显示下拉箭头；分列和去重会修改数据，可用撤销恢复。')}
                </p>
              </>
            )}
          </Dropdown>
          <Dropdown
            className={cn('sheet-data-btn', commentCount > 0 && 'active')}
            align="left"
            portal
            title={t('审阅')}
            trigger={
              <>
                <MessageSquare size={14} />
                {t('审阅')}
                <ChevronDown size={10} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('批注')}</div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    openComment()
                  }}
                >
                  <MessageSquarePlus size={14} />
                  {t('添加或编辑批注…')}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  disabled={!tab.comments?.[cellKey(selection.anchor.row, selection.anchor.col)]}
                  onClick={() => {
                    close()
                    deleteComment()
                  }}
                >
                  <Trash2 size={14} />
                  {t('删除当前批注')}
                </button>
                <button
                  type="button"
                  className={cn('menu-item', commentCount > 0 && 'selected')}
                  onClick={() => {
                    close()
                    jumpToNextComment()
                  }}
                >
                  <MessageSquare size={14} />
                  {t('下一处批注')}
                  {commentCount ? t('（{n}）', { n: commentCount }) : ''}
                </button>
                <div className="menu-sep" />
                <div className="menu-label">{t('工作表')}</div>
                <button
                  type="button"
                  className={cn('menu-item', tab.protected && 'selected')}
                  onClick={() => {
                    close()
                    if (tab.protected) setProtection(false)
                    else setProtectPrompt(true)
                  }}
                >
                  {tab.protected ? <LockOpen size={14} /> : <Lock size={14} />}
                  {tab.protected ? t('取消工作表保护') : t('保护工作表…')}
                </button>
                <p className="sheet-menu-hint">
                  {tab.protected
                    ? t('已锁定单元格编辑、格式、排序和合并；视图与筛选仍可使用。')
                    : t('保护后其他人无法改内容，适合分发给同事填写。')}
                </p>
              </>
            )}
          </Dropdown>
          <Dropdown
            className={cn('sheet-data-btn', (crosshair || eyeCare) && 'active')}
            align="left"
            portal
            title={t('视图')}
            trigger={
              <>
                <Eye size={14} />
                {t('视图')}
                <ChevronDown size={10} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('阅读辅助')}</div>
                <button
                  type="button"
                  className={cn('menu-item', crosshair && 'selected')}
                  onClick={() => {
                    close()
                    setCrosshair((value) => !value)
                  }}
                >
                  <Crosshair size={14} />
                  {t('高亮当前行列')}
                  {crosshair && <Check size={13} className="menu-item-check" />}
                </button>
                <button
                  type="button"
                  className={cn('menu-item', eyeCare && 'selected')}
                  onClick={() => {
                    close()
                    setEyeCare((value) => !value)
                  }}
                >
                  <Leaf size={14} />
                  {t('护眼模式')}
                  {eyeCare && <Check size={13} className="menu-item-check" />}
                </button>
                <div className="menu-sep" />
                <div className="menu-label">{t('显示比例')}</div>
                {ZOOM_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={cn('menu-item', Math.abs(zoom - level) < 0.001 && 'selected')}
                    onClick={() => {
                      close()
                      setZoom(level)
                    }}
                  >
                    {Math.round(level * 100)}%
                    {Math.abs(zoom - level) < 0.001 && <Check size={13} className="menu-item-check" />}
                  </button>
                ))}
              </>
            )}
          </Dropdown>
        </div>
        <span className="sheet-tool-sep" />
        <div className="sheet-tool-group">
          <button
            type="button"
            className={cn('sheet-tool-btn', anchorStyle.bold && 'active')}
            onClick={() => applyStyle({ bold: !anchorStyle.bold })}
            title={t('加粗（Ctrl+B）')}
            aria-label={t('加粗')}
            aria-pressed={!!anchorStyle.bold}
          >
            <Bold size={15} />
          </button>
          <button
            type="button"
            className={cn('sheet-tool-btn', anchorStyle.italic && 'active')}
            onClick={() => applyStyle({ italic: !anchorStyle.italic })}
            title={t('斜体（Ctrl+I）')}
            aria-label={t('斜体')}
            aria-pressed={!!anchorStyle.italic}
          >
            <Italic size={15} />
          </button>
          <button
            type="button"
            className={cn('sheet-tool-btn', anchorStyle.wrap && 'active')}
            onClick={() => applyStyle({ wrap: anchorStyle.wrap ? null : true })}
            title={t('自动换行')}
            aria-label={t('自动换行')}
            aria-pressed={!!anchorStyle.wrap}
          >
            <WrapText size={15} />
          </button>
        </div>
        <span className="sheet-tool-sep" />
        <div className="sheet-tool-group">
          <button
            type="button"
            className={cn('sheet-tool-btn', anchorAlign === 'left' && 'active')}
            onClick={() => applyStyle({ align: 'left' })}
            title={t('左对齐')}
            aria-label={t('左对齐')}
          >
            <AlignLeft size={15} />
          </button>
          <button
            type="button"
            className={cn('sheet-tool-btn', anchorAlign === 'center' && 'active')}
            onClick={() => applyStyle({ align: 'center' })}
            title={t('居中对齐')}
            aria-label={t('居中对齐')}
          >
            <AlignCenter size={15} />
          </button>
          <button
            type="button"
            className={cn('sheet-tool-btn', anchorAlign === 'right' && 'active')}
            onClick={() => applyStyle({ align: 'right' })}
            title={t('右对齐')}
            aria-label={t('右对齐')}
          >
            <AlignRight size={15} />
          </button>
        </div>
        <span className="sheet-tool-sep" />
        <select
          className="sheet-format-select"
          value={anchorStyle.fmt ?? 'general'}
          onChange={(event) => {
            const value = event.target.value as NumberFormat
            applyStyle({ fmt: value === 'general' ? null : value })
          }}
          title={t('数字格式')}
          aria-label={t('数字格式')}
        >
          {NUMBER_FORMATS.map((item) => (
            <option key={item.value} value={item.value}>
              {t(item.label)}
            </option>
          ))}
        </select>
        <span className="sheet-tool-sep" />
        <Dropdown
          className="sheet-tool-btn sheet-color-drop"
          portal
          trigger={
            <>
              <span className="sheet-color-letter" style={{ borderBottomColor: anchorStyle.color ?? 'var(--ink)' }}>
                A
              </span>
              <ChevronDown size={10} />
            </>
          }
          title={t('文字颜色')}
        >
          {(close) => (
            <div className="sheet-color-menu">
              <div className="sheet-color-grid">
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="sheet-color-swatch"
                    style={{ background: color }}
                    title={color}
                    aria-label={t('文字颜色 {color}', { color })}
                    onClick={() => {
                      applyStyle({ color })
                      close()
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                className="sheet-color-clear"
                onClick={() => {
                  applyStyle({ color: null })
                  close()
                }}
              >
                {t('恢复默认颜色')}
              </button>
            </div>
          )}
        </Dropdown>
        <Dropdown
          className="sheet-tool-btn sheet-color-drop"
          portal
          trigger={
            <>
              <PaintBucket size={14} />
              <span className="sheet-fill-chip" style={{ background: anchorStyle.bg ?? 'transparent' }} />
              <ChevronDown size={10} />
            </>
          }
          title={t('填充颜色')}
        >
          {(close) => (
            <div className="sheet-color-menu">
              <div className="sheet-color-grid">
                {FILL_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="sheet-color-swatch"
                    style={{ background: color }}
                    title={color}
                    aria-label={t('填充颜色 {color}', { color })}
                    onClick={() => {
                      applyStyle({ bg: color })
                      close()
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                className="sheet-color-clear"
                onClick={() => {
                  applyStyle({ bg: null })
                  close()
                }}
              >
                {t('清除填充')}
              </button>
            </div>
          )}
        </Dropdown>
        <span className="sheet-tool-sep" />
        <button type="button" className="sheet-sum-btn" onClick={handleAutoSum} title={t('对上方连续数字求和')}>
          <Sigma size={14} />
          {t('自动求和')}
        </button>
        <span className="sheet-tool-spacer" />
        <div className="sheet-tool-hint">{t('双击编辑 · F2 编辑 · Enter 下移')}</div>
      </div>

      <div className="sheet-formula">
        <div className="sheet-addr" title={t('当前区域')}>
          {formatRange(selection.anchor, selection.focus)}
        </div>
        <span className="sheet-fx" aria-hidden="true">
          fx
        </span>
        <input
          ref={barRef}
          className="sheet-formula-input"
          defaultValue=""
          onFocus={handleBarFocus}
          onInput={(event) => {
            draftRef.current = event.currentTarget.value
            if (cellInputRef.current) cellInputRef.current.value = draftRef.current
          }}
          onKeyDown={handleBarKey}
          onBlur={() => {
            if (editingRef.current) finishEdit()
          }}
          aria-label={t('公式编辑栏')}
          spellCheck={false}
        />
      </div>

      <div className={cn('sheet-grid-wrap', eyeCare && 'is-eye-care')}>
        <div
          ref={gridRef}
          className="sheet-grid-scroll"
          tabIndex={0}
          onKeyDown={handleGridKeyDown}
          onPaste={handlePaste}
          role="grid"
          aria-label={t('{name} 工作表', { name: tab.name })}
        >
          <div
            className="sheet-grid"
            style={{ gridTemplateColumns: gridTemplate, gridTemplateRows: gridRows, zoom }}
          >
            <button
              type="button"
              className="sheet-corner"
              onClick={selectAll}
              title={t('全选工作表')}
              aria-label={t('全选工作表')}
              style={{ gridColumn: 1, gridRow: 1 }}
            />
            {Array.from({ length: tab.cols }, (_, col) => {
              const selected = col >= range.c1 && col <= range.c2
              const active = col === selection.anchor.col
              const frozenCol = col < freezeCols
              return (
                <div
                  key={`col-${col}`}
                  className={cn('sheet-colhead', selected && 'in-range', active && 'active', frozenCol && 'is-frozen-col')}
                  style={{
                    gridColumn: col + 2,
                    gridRow: 1,
                    ...(frozenCol ? { left: frozenColLeft[col] } : null),
                  }}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return
                    event.preventDefault()
                    selectColumn(col, event.shiftKey)
                  }}
                >
                  <span>{colToName(col)}</span>
                  <span
                    className="sheet-col-resize"
                    onMouseDown={(event) => startResize(event, col)}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      autoFitColumn(col)
                    }}
                    role="separator"
                    aria-label={t('调整 {col} 列宽', { col: colToName(col) })}
                  />
                </div>
              )
            })}

            {displayRows.map((row, visibleRow) => {
              const rowSelected = row >= range.r1 && row <= range.r2
              const rowActive = row === selection.anchor.row
              const frozenRow = visibleRow < freezeRows
              const visibleRowNumber = displayIndex.get(row) ?? visibleRow
              return (
                <div key={`row-${row}`} className="sheet-row-group" style={{ display: 'contents' }}>
                  <div
                    className={cn('sheet-rowhead', rowSelected && 'in-range', rowActive && 'active', frozenRow && 'is-frozen-row')}
                    style={{
                      gridColumn: 1,
                      gridRow: visibleRowNumber + 2,
                      ...(frozenRow ? { top: frozenRowTop[visibleRowNumber] ?? 28 } : null),
                    }}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return
                      event.preventDefault()
                      selectRow(row, event.shiftKey)
                    }}
                  >
                    {row + 1}
                  </div>
                  {Array.from({ length: tab.cols }, (_, col) => {
                    const key = cellKey(row, col)
                    const merge = mergeCover.get(key)
                    if (merge && (merge.r1 !== row || merge.c1 !== col)) return null
                    const cell = tab.cells[key]
                    const style = cell?.style
                    const paint = conditionalIndex.get(key)
                    const listRule = validationIndex.get(key)
                    const comment = tab.comments?.[key]
                    const value = evaluator.valueAt(row, col)
                    const error = isFormulaError(value)
                    const text = displayValue(tab, evaluator, row, col)
                    const numeric = typeof value === 'number' || typeof value === 'boolean'
                    const align = style?.align ?? (numeric ? 'right' : 'left')
                    const inRange = row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2
                    const isAnchor = row === selection.anchor.row && col === selection.anchor.col
                    const isEditing = editing?.row === row && editing?.col === col
                    const frozenCol = col < freezeCols
                    const filterHeader = Boolean(activeFilter) && row === activeFilter?.r1 && col >= (activeFilter?.c1 ?? 0) && col <= (activeFilter?.c2 ?? -1)
                    const filterRule = filterHeader ? activeFilter?.rules.find((item) => item.col === col) : undefined
                    const spanRows = merge ? merge.r2 - merge.r1 + 1 : 1
                    const spanCols = merge ? merge.c2 - merge.c1 + 1 : 1
                    return (
                      <div
                        key={key}
                        data-cell={key}
                        role="gridcell"
                        aria-selected={inRange}
                        className={cn(
                          'sheet-cell',
                          inRange && 'in-range',
                          isAnchor && 'active',
                          isEditing && 'editing',
                          error && 'has-error',
                          frozenRow && 'is-frozen-row',
                          frozenCol && 'is-frozen-col',
                          frozenRow && frozenCol && 'is-frozen-corner',
                          filterHeader && 'has-filter',
                          merge && 'is-merged',
                          listRule && !isEditing && !merge && 'has-list',
                          comment && 'has-comment',
                          crosshair && row === selection.anchor.row && 'is-cross-row',
                          crosshair && col === selection.anchor.col && 'is-cross-col',
                          style?.wrap && !isEditing && 'is-wrapped',
                        )}
                        style={{
                          gridColumn: `${col + 2} / span ${spanCols}`,
                          gridRow: `${visibleRowNumber + 2} / span ${spanRows}`,
                          textAlign: align,
                          fontWeight: paint?.bold || style?.bold ? 700 : undefined,
                          fontStyle: style?.italic ? 'italic' : undefined,
                          color: error ? undefined : paint?.color ?? style?.color,
                          background: paint?.bg ?? style?.bg,
                          alignItems:
                            style?.valign === 'top'
                              ? 'flex-start'
                              : style?.valign === 'middle'
                                ? 'center'
                                : style?.valign === 'bottom'
                                  ? 'flex-end'
                                  : style?.wrap
                                    ? 'flex-start'
                                    : undefined,
                          ...(frozenRow ? { top: frozenRowTop[visibleRowNumber] ?? 28 } : null),
                          ...(frozenCol ? { left: frozenColLeft[col] } : null),
                        }}
                        onMouseDown={(event) => handleCellMouseDown(event, row, col)}
                        onMouseEnter={() => handleCellMouseEnter(row, col)}
                        onDoubleClick={() => handleCellDoubleClick(row, col)}
                      >
                        {paint?.bar && (
                          <span
                            className="sheet-cell-databar"
                            style={{ width: `${Math.round(paint.bar.ratio * 100)}%`, background: paint.bar.color }}
                            aria-hidden="true"
                          />
                        )}
                        {isEditing ? (
                          <input
                            ref={cellInputRef}
                            className="sheet-cell-input"
                            defaultValue={draftRef.current}
                            onInput={(event) => {
                              draftRef.current = event.currentTarget.value
                              if (barRef.current) barRef.current.value = draftRef.current
                            }}
                            onKeyDown={handleCellEditKey}
                            onBlur={() => {
                              if (editingRef.current) finishEdit()
                            }}
                            aria-label={t('编辑 {ref}', { ref: `${colToName(col)}${row + 1}` })}
                            spellCheck={false}
                          />
                        ) : (
                          <span className="sheet-cell-text">{text}</span>
                        )}
                        {listRule && !isEditing && !merge && (
                          <span
                            className="sheet-list-wrap"
                            onMouseDown={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <Dropdown
                              className="sheet-list-btn"
                              align="left"
                              portal
                              title={t('从允许的选项中选择')}
                              trigger={<ChevronDown size={10} />}
                            >
                              {(close) => (
                                <>
                                  {listRule.allowBlank && (
                                    <button
                                      type="button"
                                      className="menu-item"
                                      onClick={() => {
                                        close()
                                        setSingleSelection(row, col)
                                        commitCells([{ row, col, raw: '' }])
                                      }}
                                    >
                                      <span className="sheet-list-blank">{t('（空白）')}</span>
                                    </button>
                                  )}
                                  {listRule.list.map((option) => (
                                    <button
                                      key={option}
                                      type="button"
                                      className={cn('menu-item', text === option && 'selected')}
                                      onClick={() => {
                                        close()
                                        setSingleSelection(row, col)
                                        commitCells([{ row, col, raw: option }])
                                      }}
                                    >
                                      {option}
                                    </button>
                                  ))}
                                </>
                              )}
                            </Dropdown>
                          </span>
                        )}
                        {filterHeader && (
                          <button
                            type="button"
                            className={cn('sheet-filter-btn', filterRule && 'active')}
                            onMouseDown={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation()
                              setFilterCol(col)
                              setFilterOpen(true)
                            }}
                            title={t('筛选 {col} 列', { col: colToName(col) })}
                            aria-label={t('筛选 {col} 列', { col: colToName(col) })}
                          >
                            <Filter size={10} />
                            {filterRule && <i />}
                          </button>
                        )}
                        {comment && (
                          <span
                            className="sheet-comment-mark"
                            role="button"
                            tabIndex={-1}
                            title={comment}
                            aria-label={t('{ref} 的批注：{comment}', { ref: `${colToName(col)}${row + 1}`, comment })}
                            onMouseDown={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation()
                              openComment({ row, col })
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
        {eyeCare && <span className="sheet-eye-tint" aria-hidden="true" />}
      </div>
        </>
      )}

      {view === 'dashboard' && (
        <SheetDashboard
          tab={tab}
          evaluator={evaluator}
          charts={tab.charts ?? []}
          onBack={() => setView('grid')}
          onNewChart={(kind) => openChartCreator(kind)}
          onEditChart={openChartEditor}
          onDeleteChart={setChartToDelete}
        />
      )}

      <div className="sheet-tabbar">
        <div className="sheet-tabs" role="tablist" aria-label={t('工作表')}>
          {sheet.tabs.map((item, index) => {
            const active = index === tabIndex
            return (
              <div key={item.id} className={cn('sheet-tab', active && 'active')} role="presentation">
                {active && renamingTab ? (
                  <input
                    ref={renameInputRef}
                    className="sheet-tab-rename"
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitRename()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        setRenamingTab(false)
                      }
                    }}
                    aria-label={t('重命名工作表')}
                  />
                ) : (
                  <button
                    type="button"
                    className="sheet-tab-name"
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchTab(index)}
                    onDoubleClick={() => {
                      setRenameDraft(item.name)
                      setRenamingTab(true)
                    }}
                    title={t('双击重命名')}
                  >
                    {item.name}
                  </button>
                )}
              </div>
            )
          })}
          <button type="button" className="sheet-tab-add" onClick={addTab} title={t('新增工作表')} aria-label={t('新增工作表')}>
            <Plus size={14} />
          </button>
        </div>
        <div className="sheet-tab-actions">
          <Dropdown
            className="sheet-tab-menu-btn"
            trigger={<MoreHorizontal size={15} />}
            title={t('工作表操作')}
          >
            {(close) => (
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    setRenameDraft(tab.name)
                    setRenamingTab(true)
                  }}
                >
                  <FileSpreadsheet size={14} />
                  {t('重命名工作表')}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    duplicateTab()
                  }}
                >
                  <Plus size={14} />
                  {t('复制工作表')}
                </button>
                <div className="menu-sep" />
                <button
                  type="button"
                  className="menu-item danger"
                  disabled={sheet.tabs.length <= 1}
                  onClick={() => {
                    close()
                    setConfirmDeleteTab(true)
                  }}
                >
                  <Trash2 size={14} />
                  {t('删除工作表')}
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </div>

      <footer className="sheet-status">
        <span className="sheet-status-address">{view === 'dashboard' ? t('智能看板') : formatRange(selection.anchor, selection.focus)}</span>
        <span className="sheet-status-detail">
          {view === 'dashboard'
            ? t('{n} 张图表 · 指标自动汇总', { n: tab.charts?.length ?? 0 })
            : filterActive && activeFilter
              ? t('筛选后保留 {visible} 行 · 已隐藏 {hidden} 行', {
                  visible: Math.max(0, activeFilter.r2 - activeFilter.r1 - hiddenRows.size),
                  hidden: hiddenRows.size,
                })
              : detailText}
        </span>
        <span className="sheet-status-spacer" />
        {tab.protected && view === 'grid' && (
          <button
            type="button"
            className="sheet-protect-badge"
            onClick={() => setProtectPrompt(true)}
            title={t('工作表已保护，点击管理保护状态')}
          >
            <Lock size={11} />
            {t('已保护')}
          </button>
        )}
        {view === 'grid' && (
          <span className="sheet-zoom" aria-label={t('显示比例')}>
            <button
              type="button"
              className="sheet-zoom-btn"
              onClick={() => stepZoom(-1)}
              disabled={zoom <= ZOOM_LEVELS[0]}
              title={t('缩小')}
              aria-label={t('缩小')}
            >
              <ZoomOut size={12} />
            </button>
            <button
              type="button"
              className="sheet-zoom-value"
              onClick={() => setZoom(1)}
              title={t('恢复 100%')}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="sheet-zoom-btn"
              onClick={() => stepZoom(1)}
              disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              title={t('放大')}
              aria-label={t('放大')}
            >
              <ZoomIn size={12} />
            </button>
          </span>
        )}
        <span className="sheet-status-sep" />
        <span>
          {view === 'dashboard' ? `${tab.name} · BI` : t('{rows} 行 × {cols} 列', { rows: tab.rows, cols: tab.cols })}
        </span>
        <span className="sheet-status-sep" />
        <span>{t('本地工作簿')}</span>
      </footer>

      <ChartDialog
        open={Boolean(chartEditor)}
        tab={tab}
        value={chartEditor}
        onClose={() => setChartEditor(null)}
        onSubmit={saveChart}
      />
      <FilterDialog
        open={filterOpen}
        tab={tab}
        evaluator={evaluator}
        filter={tab.filters ?? null}
        initialCol={filterCol}
        onClose={() => setFilterOpen(false)}
        onApply={applyFilterRule}
        onRemoveRule={removeFilterRule}
        onClearAll={clearFilters}
      />
      <ConditionalDialog
        open={conditionalOpen}
        tab={tab}
        scope={conditionalScope}
        initialKind={conditionalKind}
        onClose={() => setConditionalOpen(false)}
        onAdd={addConditional}
        onRemove={removeConditional}
      />
      <ValidationDialog
        open={dataTool === 'validation'}
        tab={tab}
        scope={dataScope}
        onClose={() => setDataTool(null)}
        onApply={applyValidation}
        onRemove={removeValidation}
        onClear={clearValidation}
      />
      <SplitDialog
        open={dataTool === 'split'}
        tab={tab}
        scope={dataScope}
        onClose={() => setDataTool(null)}
        onApply={applySplit}
      />
      <DedupeDialog
        open={dataTool === 'dedupe'}
        tab={tab}
        scope={dataScope}
        onClose={() => setDataTool(null)}
        onApply={applyDedupe}
      />
      <CommentDialog
        open={Boolean(commentCell)}
        address={commentAddress}
        value={commentValue}
        canEdit={!tab.protected}
        onClose={() => setCommentCell(null)}
        onSave={saveComment}
        onDelete={() => deleteComment()}
      />
      <ConfirmDialog
        open={protectPrompt}
        title={tab.protected ? t('取消工作表保护？') : t('保护这张工作表？')}
        description={
          tab.protected
            ? t('取消保护后，单元格内容、格式、排序和合并操作会重新开放。')
            : t('保护后不能修改单元格内容、格式、排序和合并；筛选、冻结与视图切换仍然可用。')
        }
        confirmText={tab.protected ? t('取消保护') : t('开启保护')}
        onConfirm={() => setProtection(!tab.protected)}
        onClose={() => setProtectPrompt(false)}
      />
      <ConfirmDialog
        open={Boolean(chartToDelete)}
        title={t('删除这张图表？')}
        description={chartToDelete ? t('「{name}」会从看板中移除，原始数据不会受影响。', { name: chartToDelete.title }) : ''}
        confirmText={t('删除图表')}
        onConfirm={() => {
          if (chartToDelete) removeChart(chartToDelete)
        }}
        onClose={() => setChartToDelete(null)}
      />
      <ConfirmDialog
        open={confirmDeleteSheet}
        title={t('删除这张表格？')}
        description={t('「{name}」及其全部工作表将从本机移除，此操作不可撤销。', { name: sheet.title })}
        confirmText={t('删除表格')}
        onConfirm={() => {
          deleteFile('sheet', sheet.id)
          toast(t('表格已删除'))
        }}
        onClose={() => setConfirmDeleteSheet(false)}
      />
      <ConfirmDialog
        open={confirmDeleteTab}
        title={t('删除这个工作表？')}
        description={t('「{name}」中的内容会被移除，其他工作表不受影响。', { name: tab.name })}
        confirmText={t('删除工作表')}
        onConfirm={deleteTab}
        onClose={() => setConfirmDeleteTab(false)}
      />
    </div>
  )
}

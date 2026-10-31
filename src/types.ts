export type ModuleId = 'home' | 'docs' | 'sheets' | 'pdf' | 'notes' | 'convert'
export type FileKind = 'doc' | 'sheet' | 'note'

export interface BaseRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface DocSourceFile {
  name: string
  type: string
  dataBase64: string
  savedAt: number
  hash?: string
  originHash?: string
  size?: number
  importedHtml?: string
}

export interface DocRecord extends BaseRecord {
  kind: 'doc'
  html: string
  sourceDocx?: DocSourceFile
}

export interface SheetSourceFile {
  name: string
  type: string
  hash: string
  size: number
  importedAt: number
}

export type CellAlign = 'left' | 'center' | 'right'
export type NumberFormat = 'general' | 'number' | 'percent' | 'currency' | 'text'

export interface CellStyle {
  bold?: boolean
  italic?: boolean
  align?: CellAlign
  valign?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
  color?: string
  bg?: string
  fmt?: NumberFormat
}

export interface CellData {
  raw: string
  style?: CellStyle
}

export type SheetChartKind =
  | 'column'
  | 'stackedColumn'
  | 'percentColumn'
  | 'bar'
  | 'stackedBar'
  | 'line'
  | 'area'
  | 'stackedArea'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'radar'
  | 'combo'

export interface SheetChart {
  id: string
  kind: SheetChartKind
  title: string
  r1: number
  r2: number
  c1: number
  c2: number
  headerRow: boolean
  headerCol: boolean
}

export interface SheetMerge {
  r1: number
  r2: number
  c1: number
  c2: number
}

export interface SheetFreeze {
  rows: number
  cols: number
}

export type ConditionalKind = 'greater' | 'less' | 'between' | 'equal' | 'duplicate' | 'dataBar' | 'colorScale'
export type ConditionalTone = 'accent' | 'green' | 'amber' | 'blue'

export interface ConditionalRule {
  id: string
  kind: ConditionalKind
  r1: number
  r2: number
  c1: number
  c2: number
  value?: number
  value2?: number
  tone?: ConditionalTone
}

export interface SheetFilterRule {
  col: number
  values: string[]
}

export interface SheetFilterRange {
  r1: number
  r2: number
  c1: number
  c2: number
  rules: SheetFilterRule[]
}

export interface SheetValidation {
  id: string
  r1: number
  r2: number
  c1: number
  c2: number
  type: 'list' | 'number'
  list: string[]
  min?: number
  max?: number
  allowBlank: boolean
  message?: string
}

export interface SheetTab {
  id: string
  name: string
  cells: Record<string, CellData>
  rows: number
  cols: number
  colWidths: Record<number, number>
  rowHeights?: Record<number, number>
  charts?: SheetChart[]
  merges?: SheetMerge[]
  freeze?: SheetFreeze
  filters?: SheetFilterRange
  conditional?: ConditionalRule[]
  validations?: SheetValidation[]
  comments?: Record<string, string>
  protected?: boolean
}

export interface SheetRecord extends BaseRecord {
  kind: 'sheet'
  tabs: SheetTab[]
  activeTab: number
  source?: SheetSourceFile
}

export interface NoteRecord extends BaseRecord {
  kind: 'note'
  content: string
}

export type OfficeRecord = DocRecord | SheetRecord | NoteRecord

export interface LibrarySnapshot {
  docs: DocRecord[]
  sheets: SheetRecord[]
  notes: NoteRecord[]
  activeDocId: string | null
  activeSheetId: string | null
  activeNoteId: string | null
}

export interface AiContext {
  kind: FileKind | 'pdf'
  title: string
  text: string
}

export type AiProviderId = 'ruodao' | 'deepseek' | 'openai' | 'moonshot' | 'zhipu' | 'ollama' | 'custom'

export interface AiConfig {
  provider: AiProviderId
  baseUrl: string
  model: string
  apiKey: string
}

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
  local?: boolean
  error?: boolean
}

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  CopyX,
  ListChecks,
  Rows3,
  SplitSquareHorizontal,
  Trash2,
} from 'lucide-react'
import type { SheetTab, SheetValidation } from '../../types'
import { Modal } from '../../components/ui'
import { cellKey, colToName, formatRange } from '../../lib/sheetRefs'
import { cn } from '../../lib/utils'

interface Rect {
  r1: number
  r2: number
  c1: number
  c2: number
}

export interface ValidationDraft {
  r1: number
  r2: number
  c1: number
  c2: number
  type: SheetValidation['type']
  list: string[]
  min?: number
  max?: number
  allowBlank: boolean
  message?: string
}

function addressOf(scope: Rect): string {
  return formatRange({ row: scope.r1, col: scope.c1 }, { row: scope.r2, col: scope.c2 })
}

function rawAt(tab: SheetTab, row: number, col: number): string {
  return tab.cells[cellKey(row, col)]?.raw ?? ''
}

function parseList(text: string): string[] {
  const seen = new Set<string>()
  const values: string[] = []
  for (const item of text.split(/[\n,，;；]+/)) {
    const value = item.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    values.push(value)
  }
  return values
}

function validationSummary(rule: SheetValidation): string {
  if (rule.type === 'list') return `列表 · ${rule.list.length} 个选项`
  const min = rule.min !== undefined ? rule.min : '…'
  const max = rule.max !== undefined ? rule.max : '…'
  return `数字 · ${min} 至 ${max}`
}

/* ---------------- 数据有效性 ---------------- */

interface ValidationDialogProps {
  open: boolean
  tab: SheetTab
  scope: Rect | null
  onClose: () => void
  onApply: (draft: ValidationDraft, existingId?: string) => void
  onRemove: (id: string) => void
  onClear: () => void
}

export function ValidationDialog({ open, tab, scope, onClose, onApply, onRemove, onClear }: ValidationDialogProps) {
  const [type, setType] = useState<'list' | 'number'>('list')
  const [listText, setListText] = useState('')
  const [minText, setMinText] = useState('')
  const [maxText, setMaxText] = useState('')
  const [allowBlank, setAllowBlank] = useState(true)
  const [message, setMessage] = useState('')

  const existing = useMemo(() => {
    if (!scope) return undefined
    return (tab.validations ?? []).find(
      (rule) => rule.r1 === scope.r1 && rule.r2 === scope.r2 && rule.c1 === scope.c1 && rule.c2 === scope.c2,
    )
  }, [scope, tab.validations])

  const scopeKey = scope ? `${scope.r1}:${scope.r2}:${scope.c1}:${scope.c2}` : ''

  useEffect(() => {
    if (!open) return
    setType(existing?.type ?? 'list')
    setListText(existing?.list.join('\n') ?? '')
    setMinText(existing?.min !== undefined ? String(existing.min) : '')
    setMaxText(existing?.max !== undefined ? String(existing.max) : '')
    setAllowBlank(existing?.allowBlank ?? true)
    setMessage(existing?.message ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeKey, existing?.id])

  if (!scope) return null

  const list = parseList(listText)
  const min = minText.trim() === '' ? undefined : Number(minText)
  const max = maxText.trim() === '' ? undefined : Number(maxText)
  const numbersValid =
    (min === undefined || Number.isFinite(min)) &&
    (max === undefined || Number.isFinite(max)) &&
    (min === undefined || max === undefined || min <= max)
  const valid = type === 'list' ? list.length > 0 : numbersValid

  const apply = () => {
    if (!valid) return
    onApply(
      {
        r1: scope.r1,
        r2: scope.r2,
        c1: scope.c1,
        c2: scope.c2,
        type,
        list: type === 'list' ? list : [],
        ...(type === 'number' && min !== undefined ? { min } : {}),
        ...(type === 'number' && max !== undefined ? { max } : {}),
        allowBlank,
        ...(message.trim() ? { message: message.trim() } : {}),
      },
      existing?.id,
    )
  }

  const existingRules = tab.validations ?? []
  const overlap = existingRules.some(
    (rule) => rule.r2 >= scope.r1 && rule.r1 <= scope.r2 && rule.c2 >= scope.c1 && rule.c1 <= scope.c2,
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="数据有效性"
      description={`限制 ${addressOf(scope)} 可填写的内容，下拉箭头会出现在单元格右侧。`}
      width={620}
      className="data-tool-dialog"
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost data-clear-btn"
            disabled={!overlap}
            onClick={onClear}
          >
            <Trash2 size={13} />
            清除此区域
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={!valid}>
            <Check size={14} />
            {existing ? '更新规则' : '应用规则'}
          </button>
        </>
      }
    >
      <div className="data-tool-layout">
        <div className="data-tool-main">
          <div className="data-type-grid">
            <button
              type="button"
              className={cn('data-type-card', type === 'list' && 'active')}
              onClick={() => setType('list')}
            >
              <ListChecks size={16} />
              <strong>下拉列表</strong>
              <span>从预设选项中选择</span>
            </button>
            <button
              type="button"
              className={cn('data-type-card', type === 'number' && 'active')}
              onClick={() => setType('number')}
            >
              <Rows3 size={16} />
              <strong>数字范围</strong>
              <span>限制可输入的大小</span>
            </button>
          </div>

          {type === 'list' ? (
            <label className="data-field">
              <span>允许的选项</span>
              <textarea
                className="input data-textarea"
                value={listText}
                onChange={(event) => setListText(event.target.value)}
                placeholder={'每行一个选项，也可以用逗号分隔\n例如：待处理、进行中、已完成'}
                spellCheck={false}
              />
            </label>
          ) : (
            <div className="data-range-row">
              <label className="data-field">
                <span>最小值（可留空）</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={minText}
                  onChange={(event) => setMinText(event.target.value)}
                  placeholder="不限"
                />
              </label>
              <label className="data-field">
                <span>最大值（可留空）</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={maxText}
                  onChange={(event) => setMaxText(event.target.value)}
                  placeholder="不限"
                />
              </label>
            </div>
          )}

          {type === 'list' && list.length > 0 && (
            <div className="data-list-preview">
              {list.map((item) => (
                <span key={item} className="data-list-chip">
                  {item}
                </span>
              ))}
            </div>
          )}

          {type === 'number' && !numbersValid && (
            <p className="data-field-error">请填写有效数字，并确保最小值不大于最大值。</p>
          )}

          <label className="data-field">
            <span>出错提示（可留空）</span>
            <input
              className="input"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="默认会提示可选值或数字范围"
            />
          </label>

          <label className="data-check">
            <input type="checkbox" checked={allowBlank} onChange={(event) => setAllowBlank(event.target.checked)} />
            <span>允许留空</span>
          </label>
        </div>

        <aside className="data-tool-side">
          <div className="data-side-head">
            <strong>已有规则</strong>
            <span>{existingRules.length}</span>
          </div>
          {existingRules.length > 0 ? (
            <div className="data-rule-list">
              {existingRules.map((rule) => (
                <div key={rule.id} className="data-rule">
                  <div>
                    <strong>{validationSummary(rule)}</strong>
                    <em>{formatRange({ row: rule.r1, col: rule.c1 }, { row: rule.r2, col: rule.c2 })}</em>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    title="删除规则"
                    onClick={() => onRemove(rule.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="data-side-empty">还没有规则。选好类型后应用到当前选区。</p>
          )}
          <p className="data-side-note">
            复选框与手动输入的内容都会校验；粘贴的数据暂不拦截。规则保存在本机工作簿中。
          </p>
        </aside>
      </div>
    </Modal>
  )
}

/* ---------------- 分列 ---------------- */

const DELIMITERS: Array<{ value: string; label: string; glyph: string }> = [
  { value: ',', label: '逗号', glyph: ',' },
  { value: '\t', label: '制表符', glyph: '⇥' },
  { value: ';', label: '分号', glyph: ';' },
  { value: ' ', label: '空格', glyph: '␣' },
  { value: 'custom', label: '自定义', glyph: '…' },
]

interface SplitDialogProps {
  open: boolean
  tab: SheetTab
  scope: Rect | null
  onClose: () => void
  onApply: (delimiter: string) => void
}

export function SplitDialog({ open, tab, scope, onClose, onApply }: SplitDialogProps) {
  const [mode, setMode] = useState(',')
  const [custom, setCustom] = useState('')

  useEffect(() => {
    if (!open) return
    setMode(',')
    setCustom('')
  }, [open])

  if (!scope) return null

  const delimiter = mode === 'custom' ? custom : mode
  const rows: Array<{ row: number; raw: string; parts: string[] }> = []
  if (delimiter) {
    for (let row = scope.r1; row <= Math.min(scope.r2, scope.r1 + 199); row += 1) {
      const raw = rawAt(tab, row, scope.c1)
      if (!raw.trim()) continue
      const parts =
        delimiter === ' '
          ? raw.split(/\s+/).filter(Boolean)
          : raw.split(delimiter).map((item) => item.trim())
      rows.push({ row, raw, parts })
      if (rows.length >= 5) break
    }
  }
  const maxParts = rows.reduce((max, item) => Math.max(max, item.parts.length), 0)
  const ready = Boolean(delimiter) && rows.some((item) => item.parts.length > 1)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="文本分列"
      description={`把 ${colToName(scope.c1)} 列的数据按分隔符拆到右侧列，原有内容会向右移动。`}
      width={560}
      className="data-tool-dialog"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => onApply(delimiter)}>
            <SplitSquareHorizontal size={14} />
            开始分列
          </button>
        </>
      }
    >
      <div className="split-layout">
        <div className="data-field">
          <span>分隔符</span>
          <div className="split-modes">
            {DELIMITERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={cn('split-mode', mode === item.value && 'active')}
                onClick={() => setMode(item.value)}
              >
                <i>{item.glyph}</i>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {mode === 'custom' && (
          <label className="data-field">
            <span>自定义分隔符</span>
            <input
              className="input"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="例如：- 或 |"
              spellCheck={false}
            />
          </label>
        )}

        <div className="split-preview">
          <div className="split-preview-head">
            <span>预览</span>
            <em>{maxParts ? `拆成 ${maxParts} 列` : '没有可拆分的内容'}</em>
          </div>
          {rows.length > 0 ? (
            <div className="split-preview-list">
              {rows.map((item) => (
                <div key={item.row} className="split-preview-row">
                  <span className="split-preview-ref">{colToName(scope.c1)}{item.row + 1}</span>
                  <span className="split-preview-raw" title={item.raw}>{item.raw}</span>
                  <span className="split-preview-arrow">→</span>
                  <span className="split-preview-parts">
                    {item.parts.map((part, index) => (
                      <i key={`${item.row}-${index}`}>{part || '（空）'}</i>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="split-empty">所选单元格为空，请换一个包含分隔符的区域。</p>
          )}
        </div>

        <p className="split-note">
          分列只处理 {addressOf(scope)}，最多预览前 5 行。拆分后可以用撤销恢复。
        </p>
      </div>
    </Modal>
  )
}

/* ---------------- 删除重复项 ---------------- */

interface DedupeDialogProps {
  open: boolean
  tab: SheetTab
  scope: Rect | null
  onClose: () => void
  onApply: (keyCols: number[], hasHeader: boolean) => void
}

function guessHeader(tab: SheetTab, scope: Rect | null): boolean {
  if (!scope || scope.r1 >= scope.r2) return false
  let filled = 0
  let numeric = 0
  for (let col = scope.c1; col <= scope.c2; col += 1) {
    const raw = rawAt(tab, scope.r1, col).trim()
    if (!raw) continue
    filled += 1
    if (Number.isFinite(Number(raw))) numeric += 1
  }
  return filled > 0 && numeric < filled
}

export function DedupeDialog({ open, tab, scope, onClose, onApply }: DedupeDialogProps) {
  const [hasHeader, setHasHeader] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const scopeKey = scope ? `${scope.r1}:${scope.r2}:${scope.c1}:${scope.c2}` : ''

  useEffect(() => {
    if (!open || !scope) return
    setHasHeader(guessHeader(tab, scope))
    setSelected(new Set(Array.from({ length: scope.c2 - scope.c1 + 1 }, (_, index) => scope.c1 + index)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeKey])

  if (!scope) return null

  const keyCols = Array.from(selected).sort((a, b) => a - b)
  const startRow = hasHeader ? scope.r1 + 1 : scope.r1
  const totalRows = Math.max(0, scope.r2 - startRow + 1)

  let duplicates = 0
  let blankRows = 0
  if (keyCols.length) {
    const seen = new Set<string>()
    for (let row = startRow; row <= scope.r2; row += 1) {
      const values = keyCols.map((col) => rawAt(tab, row, col).trim())
      if (values.every((value) => !value)) {
        blankRows += 1
        continue
      }
      const key = values.join('\u0001')
      if (seen.has(key)) duplicates += 1
      else seen.add(key)
    }
  }

  const unique = Math.max(0, totalRows - duplicates)
  const allChecked = keyCols.length === scope.c2 - scope.c1 + 1

  const toggle = (col: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="删除重复项"
      description={`在 ${addressOf(scope)} 中按所选列判断重复，保留第一次出现的记录。`}
      width={560}
      className="data-tool-dialog"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!keyCols.length || duplicates === 0}
            onClick={() => onApply(keyCols, hasHeader)}
          >
            <CopyX size={14} />
            删除 {duplicates} 行重复项
          </button>
        </>
      }
    >
      <div className="dedupe-layout">
        <label className="data-check">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(event) => setHasHeader(event.target.checked)}
          />
          <span>首行是标题，不参与比较</span>
        </label>

        <div className="dedupe-columns-head">
          <span>用于判断重复的列</span>
          <button
            type="button"
            className="filter-mini-btn"
            onClick={() =>
              setSelected(
                allChecked
                  ? new Set()
                  : new Set(Array.from({ length: scope.c2 - scope.c1 + 1 }, (_, index) => scope.c1 + index)),
              )
            }
          >
            {allChecked ? '全不选' : '全选'}
          </button>
        </div>

        <div className="dedupe-columns">
          {Array.from({ length: scope.c2 - scope.c1 + 1 }, (_, index) => scope.c1 + index).map((col) => {
            const header = hasHeader ? rawAt(tab, scope.r1, col).trim() : ''
            return (
              <label key={col} className={cn('dedupe-col', selected.has(col) && 'checked')}>
                <input type="checkbox" checked={selected.has(col)} onChange={() => toggle(col)} />
                <i>{colToName(col)}</i>
                <span title={header}>{header || `第 ${col + 1} 列`}</span>
              </label>
            )
          })}
        </div>

        <div className="dedupe-stats">
          <div>
            <strong>{totalRows}</strong>
            <span>参与比较</span>
          </div>
          <div>
            <strong>{duplicates}</strong>
            <span>重复行</span>
          </div>
          <div>
            <strong>{unique}</strong>
            <span>保留记录</span>
          </div>
          <div>
            <strong>{blankRows}</strong>
            <span>空白跳过</span>
          </div>
        </div>

        <p className="split-note">
          {keyCols.length === 0
            ? '至少选择一列参与比较。'
            : duplicates === 0
              ? '当前选区没有发现重复项。'
              : `删除后共 ${duplicates} 行会被移除，下方数据自动上移，可用撤销恢复。`}
        </p>
      </div>
    </Modal>
  )
}

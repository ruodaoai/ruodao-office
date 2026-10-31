import { useEffect, useMemo, useState } from 'react'
import { Check, Filter, ListFilter, X } from 'lucide-react'
import type { SheetFilterRange, SheetTab } from '../../types'
import { Modal } from '../../components/ui'
import { SheetEvaluator } from '../../lib/formula'
import { cellText } from '../../lib/chartData'
import { cellKey, formatRange } from '../../lib/sheetRefs'
import { cn } from '../../lib/utils'

interface FilterDialogProps {
  open: boolean
  tab: SheetTab
  evaluator: SheetEvaluator
  filter: SheetFilterRange | null
  initialCol: number
  onClose: () => void
  onApply: (col: number, values: string[]) => void
  onRemoveRule: (col: number) => void
  onClearAll: () => void
}

export function FilterDialog({
  open,
  tab,
  evaluator,
  filter,
  initialCol,
  onClose,
  onApply,
  onRemoveRule,
  onClearAll,
}: FilterDialogProps) {
  const [col, setCol] = useState(initialCol)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const columnOptions = useMemo(() => {
    if (!filter) return []
    const options: Array<{ col: number; name: string }> = []
    for (let index = filter.c1; index <= filter.c2; index += 1) {
      const name = cellText(tab, evaluator, filter.r1, index) || `第 ${index + 1} 列`
      options.push({ col: index, name })
    }
    return options
  }, [evaluator, filter, tab])

  const values = useMemo(() => {
    if (!filter) return []
    const counts = new Map<string, number>()
    for (let row = filter.r1 + 1; row <= filter.r2; row += 1) {
      const cell = tab.cells[cellKey(row, col)]
      if (!cell?.raw.trim()) continue
      const text = cellText(tab, evaluator, row, col)
      counts.set(text, (counts.get(text) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value, 'zh-CN', { numeric: true }))
  }, [col, evaluator, filter, tab])

  const rule = filter?.rules.find((item) => item.col === col)
  const ruleKey = rule ? rule.values.join('\u0001') : ''

  useEffect(() => {
    if (!open) return
    setCol(initialCol)
    setSearch('')
  }, [initialCol, open])

  useEffect(() => {
    if (!open) return
    const all = values.map((item) => item.value)
    const next = rule ? rule.values.filter((value) => all.includes(value)) : all
    setSelected(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, col, values.length, ruleKey])

  if (!filter) return null

  const keyword = search.trim().toLowerCase()
  const filteredValues = keyword ? values.filter((item) => item.value.toLowerCase().includes(keyword)) : values
  const allSelected = values.length > 0 && selected.length === values.length
  const address = formatRange({ row: filter.r1, col: filter.c1 }, { row: filter.r2, col: filter.c2 })
  const currentName = columnOptions.find((item) => item.col === col)?.name ?? '列'

  const toggleValue = (value: string) => {
    setSelected((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )
  }

  const apply = () => {
    onApply(col, selected)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="筛选数据"
      description={`范围 ${address} · 每个列可以设置一个条件，多个列之间同时生效。`}
      width={520}
      className="filter-dialog"
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost filter-clear-btn"
            disabled={!filter.rules.length}
            onClick={() => {
              onClearAll()
              onClose()
            }}
          >
            <X size={13} />
            清除全部筛选
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={apply}>
            <Check size={14} />
            应用筛选
          </button>
        </>
      }
    >
      {filter.rules.length > 0 && (
        <div className="filter-active">
          <span className="filter-active-label">
            <ListFilter size={13} />
            已启用
          </span>
          <div className="filter-chips">
            {filter.rules.map((item) => {
              const name = columnOptions.find((option) => option.col === item.col)?.name ?? `第 ${item.col + 1} 列`
              return (
                <span key={item.col} className="filter-chip">
                  {name} · {item.values.length} 个值
                  <button type="button" aria-label={`移除 ${name} 筛选`} onClick={() => onRemoveRule(item.col)}>
                    <X size={11} />
                  </button>
                </span>
              )
            })}
          </div>
        </div>
      )}

      <div className="filter-field">
        <span className="filter-field-label">筛选列</span>
        <select className="input" value={col} onChange={(event) => setCol(Number(event.target.value))}>
          {columnOptions.map((item) => (
            <option key={item.col} value={item.col}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-values-head">
        <label className="filter-search">
          <Filter size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`搜索「${currentName}」的值`}
            aria-label="搜索筛选值"
          />
        </label>
        <button type="button" className="filter-mini-btn" onClick={() => setSelected(allSelected ? [] : values.map((item) => item.value))}>
          {allSelected ? '全不选' : '全选'}
        </button>
      </div>

      <div className="filter-value-list" role="listbox" aria-label="可选值" aria-multiselectable="true">
        {filteredValues.map((item) => {
          const checked = selected.includes(item.value)
          return (
            <button
              key={item.value}
              type="button"
              role="option"
              aria-selected={checked}
              className={cn('filter-value', checked && 'checked')}
              onClick={() => toggleValue(item.value)}
            >
              <span className="filter-check">{checked && <Check size={11} />}</span>
              <span className="filter-value-text">{item.value || '（空白）'}</span>
              <em>{item.count}</em>
            </button>
          )
        })}
        {filteredValues.length === 0 && <p className="filter-empty">没有匹配的值。</p>}
      </div>
      <p className="filter-foot-hint">
        {selected.length} / {values.length} 个值将被保留。取消勾选的值所在行会临时隐藏，不会删除数据。
      </p>
    </Modal>
  )
}

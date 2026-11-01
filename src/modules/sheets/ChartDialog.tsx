import { useEffect, useMemo, useState } from 'react'
import {
  ChartArea,
  ChartBar,
  ChartBarStacked,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartNoAxesCombined,
  ChartPie,
  ChartScatter,
  Donut,
  Radar,
} from 'lucide-react'
import type { SheetChart, SheetChartKind, SheetTab } from '../../types'
import { Modal } from '../../components/ui'
import { useT } from '../../i18n'
import { CHART_KIND_LABELS, buildChartData } from '../../lib/chartData'
import { formatRange } from '../../lib/sheetRefs'
import { cn } from '../../lib/utils'
import { SheetChartView } from './SheetChartView'

const KIND_GROUPS: Array<{
  label: string
  items: Array<{ kind: SheetChartKind; icon: typeof ChartColumn }>
}> = [
  {
    label: '常用',
    items: [
      { kind: 'column', icon: ChartColumn },
      { kind: 'line', icon: ChartLine },
      { kind: 'pie', icon: ChartPie },
      { kind: 'bar', icon: ChartBar },
      { kind: 'area', icon: ChartArea },
      { kind: 'donut', icon: Donut },
    ],
  },
  {
    label: '堆积与百分比',
    items: [
      { kind: 'stackedColumn', icon: ChartColumnStacked },
      { kind: 'stackedBar', icon: ChartBarStacked },
      { kind: 'percentColumn', icon: ChartColumnStacked },
      { kind: 'stackedArea', icon: ChartArea },
    ],
  },
  {
    label: '分析',
    items: [
      { kind: 'scatter', icon: ChartScatter },
      { kind: 'radar', icon: Radar },
      { kind: 'combo', icon: ChartNoAxesCombined },
    ],
  },
]

export type ChartEditorValue = Omit<SheetChart, 'id'> & { id?: string }

interface ChartDialogProps {
  open: boolean
  tab: SheetTab
  value: ChartEditorValue | null
  onClose: () => void
  onSubmit: (value: ChartEditorValue) => void
}

export function ChartDialog({ open, tab, value, onClose, onSubmit }: ChartDialogProps) {
  const t = useT()
  const [kind, setKind] = useState<SheetChartKind>('column')
  const [title, setTitle] = useState('')
  const [headerRow, setHeaderRow] = useState(true)
  const [headerCol, setHeaderCol] = useState(true)

  useEffect(() => {
    if (!open || !value) return
    setKind(value.kind)
    setTitle(value.title)
    setHeaderRow(value.headerRow)
    setHeaderCol(value.headerCol)
  }, [open, value])

  const draft = useMemo<SheetChart | null>(() => {
    if (!value) return null
    return {
      id: value.id ?? 'chart-preview',
      kind,
      title: title.trim() || t('数据图表'),
      r1: value.r1,
      r2: value.r2,
      c1: value.c1,
      c2: value.c2,
      headerRow,
      headerCol,
    }
  }, [headerCol, headerRow, kind, t, title, value])

  const data = useMemo(() => (draft ? buildChartData(tab, draft) : null), [draft, tab])
  if (!value || !draft || !data) return null

  const address = formatRange({ row: value.r1, col: value.c1 }, { row: value.r2, col: value.c2 })
  const cellCount = (value.r2 - value.r1 + 1) * (value.c2 - value.c1 + 1)

  const submit = () => {
    onSubmit({
      ...value,
      kind,
      title: title.trim() || t('数据图表'),
      headerRow,
      headerCol,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={value.id ? t('编辑图表') : t('插入图表')}
      description={t('数据范围 {address} · {n} 格。图表保存在本机，会随单元格数值实时刷新。', { address, n: cellCount })}
      width={880}
      className="chart-dialog"
      footer={
        <>
          <span className="chart-dialog-foot-hint">{t('还可以在看板中调整分组与汇总口径。')}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('取消')}
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {value.id ? t('保存图表') : t('添加到看板')}
          </button>
        </>
      }
    >
      <div className="chart-dialog-body">
        <div className="chart-dialog-config">
          <div className="chart-field">
            <span className="chart-field-label">{t('图表类型')}</span>
            {KIND_GROUPS.map((group) => (
              <div className="chart-kind-group" key={group.label}>
                <span className="chart-kind-group-label">{t(group.label)}</span>
                <div className="chart-kind-grid" role="radiogroup" aria-label={t('{group}图表', { group: t(group.label) })}>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.kind}
                        type="button"
                        role="radio"
                        aria-checked={kind === item.kind}
                        className={cn('chart-kind-btn', kind === item.kind && 'active')}
                        onClick={() => setKind(item.kind)}
                      >
                        <Icon size={16} />
                        <span>{t(CHART_KIND_LABELS[item.kind])}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <label className="chart-field">
            <span className="chart-field-label">{t('图表标题')}</span>
            <input
              className="input chart-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('例如：季度成本趋势')}
            />
          </label>

          <div className="chart-field">
            <span className="chart-field-label">{t('数据识别')}</span>
            <label className={cn('chart-option', value.r2 === value.r1 && 'disabled')}>
              <input
                type="checkbox"
                checked={headerRow}
                disabled={value.r2 === value.r1}
                onChange={(event) => setHeaderRow(event.target.checked)}
              />
              <span>
                {t('首行是列标题')}
                <em>{t('作为系列名称，不参与绘图')}</em>
              </span>
            </label>
            <label className={cn('chart-option', value.c2 === value.c1 && 'disabled')}>
              <input
                type="checkbox"
                checked={headerCol}
                disabled={value.c2 === value.c1}
                onChange={(event) => setHeaderCol(event.target.checked)}
              />
              <span>
                {t('首列是分类标签')}
                <em>{t('用于横轴或扇区名称')}</em>
              </span>
            </label>
          </div>

          <div className="chart-dialog-tip">
            <span className="chart-dialog-tip-mark">{t('选中')}</span>
            <p>
              {t('{cats} 个分类 · {series} 个系列。想换数据范围，关闭后重新框选单元格再插入。', { cats: data.categories.length, series: data.series.length })}
            </p>
          </div>
        </div>

        <div className="chart-dialog-preview">
          <div className="chart-preview-head">
            <h3>{title.trim() || t('数据图表')}</h3>
            <span>{t(CHART_KIND_LABELS[kind])}</span>
          </div>
          <div className="chart-preview-canvas">
            <SheetChartView data={data} kind={kind} />
          </div>
          <div className="chart-preview-foot">
            <span>{address}</span>
            <span>{t('本机渲染 · SVG')}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}

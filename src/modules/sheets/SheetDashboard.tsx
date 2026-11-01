import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ChartArea,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartPie,
  ChartScatter,
  MoreHorizontal,
  Pencil,
  Plus,
  Radar,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { SheetChart, SheetChartKind, SheetTab } from '../../types'
import { Dropdown } from '../../components/ui'
import { SheetEvaluator } from '../../lib/formula'
import {
  CHART_KIND_LABELS,
  aggregateGroups,
  buildChartData,
  cellNumber,
  formatCompact,
  inspectSheet,
  type AggregateOp,
  type SheetSchema,
} from '../../lib/chartData'
import { cellKey, formatRange } from '../../lib/sheetRefs'
import { cn } from '../../lib/utils'
import { useT } from '../../i18n'
import { useUI } from '../../store/ui'
import { SheetChartView } from './SheetChartView'

const OPS: Array<{ value: AggregateOp; label: string }> = [
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '平均值' },
  { value: 'count', label: '计数' },
  { value: 'max', label: '最大值' },
  { value: 'min', label: '最小值' },
]

const TEMPLATES: Array<{ kind: SheetChartKind; label: string; hint: string; icon: typeof ChartColumn }> = [
  { kind: 'line', label: '趋势', hint: '按分类看变化', icon: ChartLine },
  { kind: 'column', label: '对比', hint: '并列比较数值', icon: ChartColumn },
  { kind: 'donut', label: '占比', hint: '看结构分布', icon: ChartPie },
  { kind: 'stackedColumn', label: '堆积', hint: '看构成与总量', icon: ChartColumnStacked },
  { kind: 'stackedArea', label: '累计', hint: '看面积叠加', icon: ChartArea },
  { kind: 'scatter', label: '相关', hint: '看两个变量', icon: ChartScatter },
  { kind: 'radar', label: '雷达', hint: '多指标对比', icon: Radar },
]

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const width = 108
  const height = 30
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - 3 - ((value - min) / span) * (height - 6)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg className="dash-spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={`0,${height} ${points.join(' ')} ${width},${height}`} fill="rgba(200, 68, 43, 0.08)" stroke="none" />
      <polyline points={points.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function defaultDimension(schema: SheetSchema): number {
  const textColumns = schema.columns
    .filter((column) => !column.numeric && column.unique >= 2)
    .slice()
    .sort((a, b) => b.filled - a.filled)
  return textColumns[0]?.col ?? schema.columns[0]?.col ?? 0
}

function defaultMeasure(schema: SheetSchema, dimension: number): number {
  const numeric = schema.columns.find((column) => column.numeric && column.col !== dimension)
  return numeric?.col ?? schema.columns.find((column) => column.col !== dimension)?.col ?? dimension
}

interface SheetDashboardProps {
  tab: SheetTab
  evaluator: SheetEvaluator
  charts: SheetChart[]
  onBack: () => void
  onNewChart: (kind?: SheetChartKind) => void
  onEditChart: (chart: SheetChart) => void
  onDeleteChart: (chart: SheetChart) => void
}

export function SheetDashboard({ tab, evaluator, charts, onBack, onNewChart, onEditChart, onDeleteChart }: SheetDashboardProps) {
  const t = useT()
  const openAiTask = useUI((state) => state.openAiTask)
  const schema = useMemo(() => inspectSheet(tab), [tab])
  const [dimensionCol, setDimensionCol] = useState(() => defaultDimension(schema))
  const [measureCol, setMeasureCol] = useState(() => defaultMeasure(schema, defaultDimension(schema)))
  const [op, setOp] = useState<AggregateOp>('sum')

  useEffect(() => {
    setDimensionCol((current) => (schema.columns.some((column) => column.col === current) ? current : defaultDimension(schema)))
  }, [schema])

  useEffect(() => {
    setMeasureCol((current) => {
      if (schema.columns.some((column) => column.col === current) && current !== dimensionCol) return current
      return defaultMeasure(schema, dimensionCol)
    })
  }, [dimensionCol, schema])

  const stats = useMemo(() => {
    const block = schema.block
    const dataStart = schema.headerRow === null ? block.r1 : schema.headerRow + 1
    let sum = 0
    let numbers = 0
    let filled = 0
    let max = Number.NEGATIVE_INFINITY
    let maxLabel = ''
    let peakSeries: number[] = []
    for (let row = dataStart; row <= block.r2; row += 1) {
      for (let col = block.c1; col <= block.c2; col += 1) {
        const cell = tab.cells[cellKey(row, col)]
        if (!cell?.raw.trim()) continue
        filled += 1
        const value = cellNumber(evaluator, row, col)
        if (value === null) continue
        sum += value
        numbers += 1
        if (value > max) {
          max = value
          const columnName = schema.columns[col]?.name
          maxLabel = `${formatRange({ row, col }, { row, col })}${columnName ? t('（{name}）', { name: columnName }) : ''}`
        }
      }
    }
    const numeric = schema.columns.filter((column) => column.numeric)
    const rowCount = Math.max(0, block.r2 - dataStart + 1)
    const series = numeric[0]
      ? Array.from({ length: rowCount }, (_, index) => cellNumber(evaluator, dataStart + index, numeric[0].col)).filter(
          (value): value is number => value !== null,
        )
      : []
    peakSeries = series.slice(-24)
    const cells = Math.max(1, rowCount * Math.max(1, block.c2 - block.c1 + 1))
    return {
      records: rowCount,
      sum,
      average: numbers > 0 ? sum / numbers : 0,
      max: numbers > 0 ? max : 0,
      maxLabel,
      density: filled / cells,
      numericColumns: numeric.length,
      numericCells: numbers,
      peakSeries,
    }
  }, [evaluator, schema, t, tab])

  const dimensionCandidates = schema.columns.filter((column) => !column.numeric || column.unique >= 2)
  const measureCandidates = schema.columns.filter((column) => column.numeric)
  const groupRows = useMemo(
    () => aggregateGroups(tab, dimensionCol, measureCol, op, schema).slice(0, 7),
    [dimensionCol, measureCol, op, schema, tab],
  )
  const groupMax = Math.max(1, ...groupRows.map((row) => Math.abs(row.value)))
  const groupTotal = groupRows.reduce((sum, row) => sum + row.value, 0)
  const topThreeShare = groupRows.slice(0, 3).reduce((sum, row) => sum + row.share, 0)
  const dimensionName = schema.columns.find((column) => column.col === dimensionCol)?.name ?? t('分类')
  const measureName = schema.columns.find((column) => column.col === measureCol)?.name ?? t('数值')
  const top = groupRows[0]

  return (
    <div className="sheet-dashboard">
      <div className="dash-scroll">
        <header className="dash-intro">
          <div className="dash-intro-text">
            <span className="dash-eyebrow">{t('BI 看板 · 本地实时汇总')}</span>
            <h2>{t('把表里的数字，变成能读的结论。')}</h2>
            <p>
              {t('基于「{name}」的 {records} 条记录 · {count} 张图表 · 修改单元格后自动重算', {
                name: tab.name,
                records: stats.records,
                count: charts.length,
              })}
            </p>
          </div>
          <div className="dash-intro-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}>
              <ArrowLeft size={13} />
              {t('返回表格')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onNewChart()}>
              <Plus size={14} />
              {t('新建图表')}
            </button>
          </div>
        </header>

        <section className="dash-kpis" aria-label={t('关键指标')}>
          <article className="dash-kpi">
            <span className="dash-kpi-label">{t('记录数')}</span>
            <strong>{stats.records.toLocaleString('zh-CN')}</strong>
            <span className="dash-kpi-sub">{t('{n} 个数值参与计算', { n: stats.numericCells })}</span>
            <Sparkline values={stats.peakSeries} />
          </article>
          <article className="dash-kpi is-accent">
            <span className="dash-kpi-label">{t('数值合计')}</span>
            <strong>{formatCompact(stats.sum)}</strong>
            <span className="dash-kpi-sub">{t('跨 {n} 个指标列', { n: stats.numericColumns })}</span>
          </article>
          <article className="dash-kpi">
            <span className="dash-kpi-label">{t('平均值')}</span>
            <strong>{formatCompact(stats.average)}</strong>
            <span className="dash-kpi-sub">{t('最高 {value}', { value: formatCompact(stats.max) })}</span>
          </article>
          <article className="dash-kpi">
            <span className="dash-kpi-label">{t('数据完整度')}</span>
            <strong>{(stats.density * 100).toFixed(0)}%</strong>
            <span className="dash-kpi-sub">
              {stats.maxLabel ? t('峰值出现在 {label}', { label: stats.maxLabel }) : t('所有指标已就绪')}
            </span>
          </article>
        </section>

        <section className="dash-chart-section" aria-label={t('图表')}>
          <div className="dash-section-head">
            <div>
              <h3>{t('图表')}</h3>
              <p>{t('从任意选区插入，图表会跟着数据一起变。')}</p>
            </div>
            <button type="button" className="dash-link-btn" onClick={() => onNewChart()}>
              <Plus size={13} />
              {t('添加')}
            </button>
          </div>

          {charts.length > 0 ? (
            <div className="dash-chart-grid">
              {charts.map((chart) => {
                const data = buildChartData(tab, chart, evaluator)
                return (
                  <article key={chart.id} className={cn('dash-chart-card', (chart.kind === 'pie' || chart.kind === 'donut') && 'is-pie')}>
                    <header className="dash-chart-head">
                      <div className="dash-chart-title">
                        <h4>{chart.title}</h4>
                        <span>
                          {t(CHART_KIND_LABELS[chart.kind])} ·{' '}
                          {formatRange({ row: chart.r1, col: chart.c1 }, { row: chart.r2, col: chart.c2 })}
                        </span>
                      </div>
                      <Dropdown className="icon-btn dash-chart-menu" title={t('图表操作')} trigger={<MoreHorizontal size={16} />}>
                        {(close) => (
                          <>
                            <button
                              type="button"
                              className="menu-item"
                              onClick={() => {
                                close()
                                onEditChart(chart)
                              }}
                            >
                              <Pencil size={14} />
                              {t('编辑图表')}
                            </button>
                            <div className="menu-sep" />
                            <button
                              type="button"
                              className="menu-item danger"
                              onClick={() => {
                                close()
                                onDeleteChart(chart)
                              }}
                            >
                              <Trash2 size={14} />
                              {t('删除图表')}
                            </button>
                          </>
                        )}
                      </Dropdown>
                    </header>
                    <div className="dash-chart-canvas">
                      <SheetChartView data={data} kind={chart.kind} />
                    </div>
                  </article>
                )
              })}
              <button type="button" className="dash-chart-add" onClick={() => onNewChart()}>
                <span className="dash-chart-add-icon">
                  <Plus size={18} />
                </span>
                <strong>{t('再放一张图表')}</strong>
                <em>{t('从当前选区自动识别数据')}</em>
              </button>
            </div>
          ) : (
            <div className="dash-chart-empty">
              <div className="dash-chart-empty-copy">
                <h4>{t('还没有图表。')}</h4>
                <p>{t('框选一段带标题和数字的区域，若道会自动识别分类与系列。也可以从下面的模板开始。')}</p>
              </div>
              <div className="dash-template-row">
                {TEMPLATES.map((item) => {
                  const Icon = item.icon
                  return (
                    <button key={item.kind} type="button" className="dash-template" onClick={() => onNewChart(item.kind)}>
                      <Icon size={17} />
                      <span>
                        <strong>{t(item.label)}</strong>
                        <em>{t(item.hint)}</em>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <div className="dash-lower">
          <section className="dash-panel dash-pivot" aria-label={t('分组分析')}>
            <div className="dash-panel-head">
              <div>
                <h3>{t('分组洞察')}</h3>
                <p>{t('按一个维度拆开看，找到贡献最大的那一组。')}</p>
              </div>
            </div>
            <div className="dash-pivot-controls">
              <label>
                <span>{t('分组')}</span>
                <select value={dimensionCol} onChange={(event) => setDimensionCol(Number(event.target.value))}>
                  {dimensionCandidates.map((column) => (
                    <option key={column.col} value={column.col}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('数值')}</span>
                <select value={measureCol} onChange={(event) => setMeasureCol(Number(event.target.value))}>
                  {measureCandidates.length > 0 ? (
                    measureCandidates.map((column) => (
                      <option key={column.col} value={column.col}>
                        {column.name}
                      </option>
                    ))
                  ) : (
                    <option value={measureCol}>{t('无可用数值列')}</option>
                  )}
                </select>
              </label>
              <label>
                <span>{t('口径')}</span>
                <select value={op} onChange={(event) => setOp(event.target.value as AggregateOp)}>
                  {OPS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {t(item.label)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {groupRows.length > 0 ? (
              <div className="dash-pivot-body">
                <div className="dash-pivot-table">
                  {groupRows.map((row, index) => (
                    <div key={row.label} className="dash-pivot-row">
                      <span className={cn('dash-pivot-rank', index === 0 && 'top')}>{index + 1}</span>
                      <span className="dash-pivot-label" title={row.label}>
                        {row.label}
                      </span>
                      <span className="dash-pivot-bar">
                        <i style={{ width: `${Math.max(3, (Math.abs(row.value) / groupMax) * 100)}%` }} />
                      </span>
                      <span className="dash-pivot-value">{formatCompact(row.value)}</span>
                      <span className="dash-pivot-share">{groupTotal > 0 ? `${(row.share * 100).toFixed(0)}%` : '—'}</span>
                    </div>
                  ))}
                </div>
                <footer className="dash-pivot-foot">
                  <span>
                    {t('共 {n} 组 · 按{name}拆分', { n: groupRows.length >= 7 ? '7+' : groupRows.length, name: dimensionName })}
                  </span>
                  <span>
                    {t('口径：{op} {measure}', { op: t(OPS.find((item) => item.value === op)?.label ?? ''), measure: measureName })}
                  </span>
                </footer>
              </div>
            ) : (
              <div className="dash-panel-empty">{t('这段数据里还没有可分组文字列和数值列。')}</div>
            )}
          </section>

          <aside className="dash-panel dash-story" aria-label={t('自动摘要')}>
            <div className="dash-panel-head">
              <div>
                <h3>{t('自动摘要')}</h3>
                <p>{t('从当前分组直接读出的三句话。')}</p>
              </div>
              <Sparkles size={15} className="dash-story-spark" />
            </div>
            <ol className="dash-story-list">
              {top ? (
                <>
                  <li>
                    {t('{label} 在「{dim}」中排第一，占 {pct}%。', {
                      label: top.label,
                      dim: dimensionName,
                      pct: groupTotal > 0 ? (top.share * 100).toFixed(0) : 0,
                    })}
                  </li>
                  <li>
                    {t('前 3 组合计占 {pct}%，', { pct: (topThreeShare * 100).toFixed(0) })}
                    {topThreeShare >= 0.65 ? t('集中度较高，值得优先关注头部。') : t('分布相对均衡，没有明显单点依赖。')}
                  </li>
                  <li>
                    {t('当前口径下，平均值约为 {avg}，合计 {total}。', {
                      avg: groupTotal > 0 && groupRows.length > 0 ? formatCompact(groupTotal / groupRows.length) : '—',
                      total: formatCompact(groupTotal),
                    })}
                  </li>
                </>
              ) : (
                <li>{t('选择分组与数值列后，这里会自动生成经营摘要。')}</li>
              )}
            </ol>
            <button
              type="button"
              className="dash-ai-btn"
              onClick={() =>
                openAiTask(
                  t(
                    '请基于工作表「{name}」做一份简短经营分析：围绕{dim}与{measure}，指出最重要的分组、集中度和异常信号，并给出三条可执行建议。',
                    { name: tab.name, dim: dimensionName, measure: measureName },
                  ),
                )
              }
            >
              <Sparkles size={13} />
              {t('让 AI 继续解读')}
            </button>
          </aside>
        </div>
      </div>
    </div>
  )
}

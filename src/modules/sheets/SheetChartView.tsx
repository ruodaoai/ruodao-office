import type { SheetChartKind } from '../../types'
import { CHART_COLORS, formatCompact, niceScale, type ChartData } from '../../lib/chartData'

const WIDTH = 720
const HEIGHT = 328

interface Slice {
  label: string
  value: number
  color: string
  ratio: number
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function pieSlices(data: ChartData): Slice[] {
  const series = data.series[0]
  if (!series) return []
  const source = data.categories
    .map((label, index) => ({ label: label || `项目 ${index + 1}`, value: Math.max(0, series.values[index] ?? 0) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
  const kept = source.slice(0, 8)
  if (source.length > 8) {
    kept.push({
      label: '其他',
      value: source.slice(8).reduce((sum, item) => sum + item.value, 0),
    })
  }
  const total = kept.reduce((sum, item) => sum + item.value, 0)
  return kept.map((item, index) => ({
    ...item,
    color: CHART_COLORS[index % CHART_COLORS.length],
    ratio: total > 0 ? item.value / total : 0,
  }))
}

function arcPath(cx: number, cy: number, radius: number, start: number, end: number): string {
  const x1 = cx + radius * Math.cos(start)
  const y1 = cy + radius * Math.sin(start)
  const x2 = cx + radius * Math.cos(end)
  const y2 = cy + radius * Math.sin(end)
  const large = end - start > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`
}

function PieChart({ data, donut }: { data: ChartData; donut: boolean }) {
  const slices = pieSlices(data)
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  if (!slices.length) return null
  const cx = WIDTH / 2
  const cy = HEIGHT / 2
  const radius = Math.min(HEIGHT, WIDTH) * 0.36
  let angle = -Math.PI / 2
  return (
    <>
      <defs>
        <filter id="sheet-pie-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#3a2f20" floodOpacity="0.12" />
        </filter>
      </defs>
      <g filter="url(#sheet-pie-shadow)">
        {slices.map((slice) => {
          const end = angle + slice.ratio * Math.PI * 2
          const path = slice.ratio > 0.999 ? null : arcPath(cx, cy, radius, angle, end)
          const showLabel = slice.ratio >= 0.055
          const mid = (angle + end) / 2
          const labelX = cx + Math.cos(mid) * radius * 0.67
          const labelY = cy + Math.sin(mid) * radius * 0.67
          const node = (
            <g key={slice.label}>
              {path ? (
                <path d={path} fill={slice.color}>
                  <title>{`${slice.label}：${formatCompact(slice.value)}（${(slice.ratio * 100).toFixed(1)}%）`}</title>
                </path>
              ) : (
                <circle cx={cx} cy={cy} r={radius} fill={slice.color}>
                  <title>{`${slice.label}：${formatCompact(slice.value)}（100%）`}</title>
                </circle>
              )}
              {showLabel && (
                <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle" className="sheet-chart-slice-label">
                  {(slice.ratio * 100).toFixed(0)}%
                </text>
              )}
            </g>
          )
          angle = end
          return node
        })}
      </g>
      {donut && (
        <>
          <circle cx={cx} cy={cy} r={radius * 0.55} fill="var(--surface, #fffdf9)" />
          <text x={cx} y={cy - 10} textAnchor="middle" className="sheet-chart-donut-total">
            {formatCompact(total)}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="sheet-chart-donut-caption">
            合计
          </text>
        </>
      )}
    </>
  )
}

const STACKED_KINDS = new Set<SheetChartKind>(['stackedColumn', 'percentColumn', 'stackedBar', 'stackedArea'])

function CartesianChart({ data, kind }: { data: ChartData; kind: SheetChartKind }) {
  const categories = data.categories
  const series = data.series.slice(0, 6)
  if (!categories.length || !series.length) return null

  const horizontal = kind === 'bar' || kind === 'stackedBar'
  const stacked = STACKED_KINDS.has(kind)
  const percent = kind === 'percentColumn'
  const combo = kind === 'combo'
  const singleSeries = series.length === 1
  const all = series.flatMap((item) => item.values)
  const totals = categories.map((_, index) =>
    Math.max(1e-9, series.reduce((sum, item) => sum + Math.max(0, item.values[index] ?? 0), 0)),
  )
  const scale = percent
    ? { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] }
    : stacked
      ? niceScale(0, Math.max(...totals), 4)
      : niceScale(Math.min(...all), Math.max(...all), 4)
  const stackValue = (value: number, index: number) =>
    percent ? (Math.max(0, value) / totals[index]) * 100 : Math.max(0, value)
  const tickLabel = (value: number) => (percent ? `${value}%` : formatCompact(value))

  if (horizontal) {
    const longest = categories.reduce((max, label) => Math.max(max, label.length), 0)
    const left = Math.min(152, Math.max(82, longest * 12 + 16))
    const top = 22
    const bottom = 34
    const right = 52
    const plotW = WIDTH - left - right
    const plotH = HEIGHT - top - bottom
    const groupH = plotH / categories.length
    const inner = Math.min(groupH * 0.68, 30 * series.length)
    const slot = inner / series.length
    const x = (value: number) => left + ((value - scale.min) / Math.max(1e-9, scale.max - scale.min)) * plotW
    const baseline = x(0)
    const step = Math.max(1, Math.ceil(categories.length / 12))

    return (
      <g>
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={top} y2={top + plotH} className="sheet-chart-grid" />
            <text x={x(tick)} y={top + plotH + 18} textAnchor="middle" className="sheet-chart-axis">
              {tickLabel(tick)}
            </text>
          </g>
        ))}
        {categories.map((label, rowIndex) => {
          const centerY = top + groupH * (rowIndex + 0.5)
          let cursor = 0
          return (
            <g key={`${label}-${rowIndex}`}>
              {rowIndex % step === 0 && (
                <text x={left - 12} y={centerY} textAnchor="end" dominantBaseline="middle" className="sheet-chart-axis">
                  {truncate(label, 9)}
                </text>
              )}
              {series.map((item, seriesIndex) => {
                const value = item.values[rowIndex] ?? 0
                if (kind === 'stackedBar') {
                  const amount = stackValue(value, rowIndex)
                  const startX = x(cursor)
                  const endX = x(cursor + amount)
                  cursor += amount
                  return (
                    <rect
                      key={`${item.name}-${rowIndex}`}
                      x={Math.min(startX, endX)}
                      y={centerY - inner / 2}
                      width={Math.max(1.5, Math.abs(endX - startX))}
                      height={Math.max(3, inner)}
                      rx={2}
                      fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                    >
                      <title>{`${label} · ${item.name}：${percent ? `${amount.toFixed(1)}%` : formatCompact(value)}`}</title>
                    </rect>
                  )
                }
                const y = centerY - inner / 2 + slot * seriesIndex
                const barX = Math.min(baseline, x(value))
                const width = Math.abs(x(value) - baseline)
                return (
                  <g key={`${item.name}-${rowIndex}`}>
                    <rect
                      x={barX}
                      y={y}
                      width={Math.max(1.5, width)}
                      height={Math.max(3, slot - 5)}
                      rx={3}
                      fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                    >
                      <title>{`${label} · ${item.name}：${formatCompact(value)}`}</title>
                    </rect>
                    {singleSeries && width > 26 && (
                      <text
                        x={baseline + width + 7}
                        y={y + (slot - 5) / 2}
                        dominantBaseline="middle"
                        className="sheet-chart-value-label"
                      >
                        {formatCompact(value)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
        <line x1={baseline} x2={baseline} y1={top} y2={top + plotH} className="sheet-chart-baseline" />
      </g>
    )
  }

  const left = 66
  const top = 20
  const bottom = 44
  const right = 22
  const plotW = WIDTH - left - right
  const plotH = HEIGHT - top - bottom
  const groupW = plotW / categories.length
  const inner = Math.min(groupW * 0.68, singleSeries ? 48 : 34 * series.length)
  const slot = inner / series.length
  const y = (value: number) => top + plotH - ((value - scale.min) / Math.max(1e-9, scale.max - scale.min)) * plotH
  const baseline = y(0)
  const labelStep = Math.max(1, Math.ceil(categories.length / 10))
  const xCenter = (index: number) => left + groupW * (index + 0.5)

  return (
    <g>
      <defs>
        {series.map((item, index) => (
          <linearGradient key={item.name} id={`sheet-area-${index}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS[index % CHART_COLORS.length]} stopOpacity="0.34" />
            <stop offset="100%" stopColor={CHART_COLORS[index % CHART_COLORS.length]} stopOpacity="0.02" />
          </linearGradient>
        ))}
      </defs>
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={left}
            x2={left + plotW}
            y1={y(tick)}
            y2={y(tick)}
            className={tick === 0 ? 'sheet-chart-baseline' : 'sheet-chart-grid'}
          />
          <text x={left - 12} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="sheet-chart-axis">
            {tickLabel(tick)}
          </text>
        </g>
      ))}

      {(kind === 'line' || kind === 'area') &&
        series.map((item, seriesIndex) => {
          const color = CHART_COLORS[seriesIndex % CHART_COLORS.length]
          const points = item.values.map((value, index) => `${xCenter(index)} ${y(value)}`)
          const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point}`).join(' ')
          const areaPath = `${linePath} L ${xCenter(categories.length - 1)} ${baseline} L ${xCenter(0)} ${baseline} Z`
          return (
            <g key={item.name}>
              {kind === 'area' && <path d={areaPath} fill={`url(#sheet-area-${seriesIndex})`} />}
              <path d={linePath} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
              {item.values.map((value, index) => (
                <g key={`${item.name}-${index}`}>
                  {categories.length <= 30 ? (
                    <circle cx={xCenter(index)} cy={y(value)} r={3.2} fill="var(--surface, #fffdf9)" stroke={color} strokeWidth={2}>
                      <title>{`${categories[index]} · ${item.name}：${formatCompact(value)}`}</title>
                    </circle>
                  ) : (
                    <rect x={xCenter(index) - 3} y={y(value) - 8} width={6} height={16} fill="transparent">
                      <title>{`${categories[index]} · ${item.name}：${formatCompact(value)}`}</title>
                    </rect>
                  )}
                </g>
              ))}
            </g>
          )
        })}

      {kind === 'stackedArea' &&
        (() => {
          let lower = categories.map(() => 0)
          return series.map((item, seriesIndex) => {
            const upper = lower.map((base, index) => base + stackValue(item.values[index] ?? 0, index))
            const upperPoints = upper.map((value, index) => `${xCenter(index)} ${y(value)}`)
            const lowerPoints = lower
              .map((value, index) => `${xCenter(categories.length - 1 - index)} ${y(lower[categories.length - 1 - index])}`)
              .reverse()
            const path = `M ${upperPoints.join(' L ')} L ${lowerPoints.join(' L ')} Z`
            lower = upper
            return (
              <path
                key={item.name}
                d={path}
                fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                fillOpacity={0.72}
                stroke={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                strokeWidth={1.4}
              >
                <title>{item.name}</title>
              </path>
            )
          })
        })()}

      {(kind === 'column' || kind === 'stackedColumn' || kind === 'percentColumn' || combo) &&
        categories.map((label, index) => {
          let cursor = 0
          return (
            <g key={`${label}-${index}`}>
              {series.map((item, seriesIndex) => {
                const value = item.values[index] ?? 0
                if (combo && seriesIndex > 0) return null
                if (kind === 'stackedColumn' || kind === 'percentColumn') {
                  const amount = stackValue(value, index)
                  const startY = y(cursor)
                  const endY = y(cursor + amount)
                  cursor += amount
                  return (
                    <rect
                      key={`${item.name}-${index}`}
                      x={xCenter(index) - inner / 2}
                      y={Math.min(startY, endY)}
                      width={Math.max(3, inner)}
                      height={Math.max(1.5, Math.abs(endY - startY))}
                      rx={2}
                      fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                    >
                      <title>{`${label} · ${item.name}：${percent ? `${amount.toFixed(1)}%` : formatCompact(value)}`}</title>
                    </rect>
                  )
                }
                const barWidth = combo ? inner / series.length : Math.max(3, slot - 5)
                const barX = combo ? xCenter(index) - inner / 2 : xCenter(index) - inner / 2 + slot * seriesIndex
                const barTop = Math.min(y(value), baseline)
                const height = Math.abs(y(value) - baseline)
                return (
                  <rect
                    key={`${item.name}-${index}`}
                    x={barX}
                    y={barTop}
                    width={Math.max(3, barWidth)}
                    height={Math.max(1.5, height)}
                    rx={3}
                    fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                  >
                    <title>{`${label} · ${item.name}：${formatCompact(value)}`}</title>
                  </rect>
                )
              })}
            </g>
          )
        })}

      {combo &&
        series.slice(1).map((item, offset) => {
          const seriesIndex = offset + 1
          const color = CHART_COLORS[seriesIndex % CHART_COLORS.length]
          const linePath = item.values
            .map((value, index) => `${index === 0 ? 'M' : 'L'} ${xCenter(index)} ${y(value)}`)
            .join(' ')
          return (
            <g key={item.name}>
              <path d={linePath} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
              {item.values.map((value, index) => (
                <circle key={index} cx={xCenter(index)} cy={y(value)} r={3.2} fill="var(--surface, #fffdf9)" stroke={color} strokeWidth={2}>
                  <title>{`${categories[index]} · ${item.name}：${formatCompact(value)}`}</title>
                </circle>
              ))}
            </g>
          )
        })}

      {categories.map((label, index) =>
        index % labelStep === 0 ? (
          <text key={`${label}-axis`} x={xCenter(index)} y={top + plotH + 22} textAnchor="middle" className="sheet-chart-axis">
            {truncate(label, 8)}
          </text>
        ) : null,
      )}
    </g>
  )
}

function ScatterChart({ data }: { data: ChartData }) {
  const series = data.series.slice(0, 4)
  const multi = series.length >= 2
  const xValues = multi ? series[0].values : data.categories.map((_, index) => index + 1)
  const ySeries = multi ? series.slice(1) : series.slice(0, 1)
  const points = ySeries.map((item, seriesIndex) => ({
    name: item.name,
    color: CHART_COLORS[(multi ? seriesIndex + 1 : 0) % CHART_COLORS.length],
    values: item.values
      .map((value, index) => ({ x: xValues[index] ?? index + 1, y: value, label: data.categories[index] ?? '' }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
  }))
  const flat = points.flatMap((item) => item.values)
  if (!flat.length) return null

  const left = 66
  const top = 20
  const bottom = 44
  const right = 24
  const plotW = WIDTH - left - right
  const plotH = HEIGHT - top - bottom
  const xScale = niceScale(Math.min(...flat.map((point) => point.x)), Math.max(...flat.map((point) => point.x)), 4)
  const yScale = niceScale(Math.min(...flat.map((point) => point.y)), Math.max(...flat.map((point) => point.y)), 4)
  const x = (value: number) => left + ((value - xScale.min) / Math.max(1e-9, xScale.max - xScale.min)) * plotW
  const y = (value: number) => top + plotH - ((value - yScale.min) / Math.max(1e-9, yScale.max - yScale.min)) * plotH

  return (
    <g>
      {yScale.ticks.map((tick) => (
        <g key={`y-${tick}`}>
          <line x1={left} x2={left + plotW} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'sheet-chart-baseline' : 'sheet-chart-grid'} />
          <text x={left - 12} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="sheet-chart-axis">
            {formatCompact(tick)}
          </text>
        </g>
      ))}
      {xScale.ticks.map((tick) => (
        <g key={`x-${tick}`}>
          <line x1={x(tick)} x2={x(tick)} y1={top} y2={top + plotH} className="sheet-chart-grid" />
          <text x={x(tick)} y={top + plotH + 20} textAnchor="middle" className="sheet-chart-axis">
            {formatCompact(tick)}
          </text>
        </g>
      ))}
      {points.map((item) => (
        <g key={item.name}>
          {item.values.map((point, index) => (
            <circle key={index} cx={x(point.x)} cy={y(point.y)} r={4} fill={item.color} fillOpacity={0.82} stroke="var(--surface, #fffdf9)" strokeWidth={1.2}>
              <title>{`${point.label ? `${point.label} · ` : ''}${item.name}：(${formatCompact(point.x)}, ${formatCompact(point.y)})`}</title>
            </circle>
          ))}
        </g>
      ))}
    </g>
  )
}

function RadarChart({ data }: { data: ChartData }) {
  const categories = data.categories.slice(0, 12)
  const series = data.series.slice(0, 6)
  if (categories.length < 3 || !series.length) return null
  const cx = WIDTH / 2
  const cy = HEIGHT / 2 + 4
  const radius = Math.min(HEIGHT, WIDTH) * 0.34
  const count = categories.length
  const angleAt = (index: number) => -Math.PI / 2 + (index / count) * Math.PI * 2
  const maxValue = Math.max(...series.flatMap((item) => item.values), 1)
  const rings = [0.25, 0.5, 0.75, 1]
  const pointAt = (value: number, index: number) => {
    const ratio = Math.max(0, value) / maxValue
    return [cx + Math.cos(angleAt(index)) * radius * ratio, cy + Math.sin(angleAt(index)) * radius * ratio] as const
  }

  return (
    <g>
      {rings.map((ring) => {
        const points = categories.map((_, index) => {
          const x = cx + Math.cos(angleAt(index)) * radius * ring
          const y = cy + Math.sin(angleAt(index)) * radius * ring
          return `${x} ${y}`
        })
        return <polygon key={ring} points={points.join(' ')} fill="none" className="sheet-chart-grid" />
      })}
      {categories.map((label, index) => {
        const x = cx + Math.cos(angleAt(index)) * radius
        const y = cy + Math.sin(angleAt(index)) * radius
        const cos = Math.cos(angleAt(index))
        const sin = Math.sin(angleAt(index))
        return (
          <g key={label}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="sheet-chart-grid" />
            <text
              x={cx + cos * radius * 1.12}
              y={cy + sin * radius * 1.12}
              textAnchor={cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'}
              dominantBaseline={sin > 0.3 ? 'hanging' : sin < -0.3 ? 'auto' : 'middle'}
              className="sheet-chart-axis"
            >
              {truncate(label, 7)}
            </text>
          </g>
        )
      })}
      {series.map((item, seriesIndex) => {
        const color = CHART_COLORS[seriesIndex % CHART_COLORS.length]
        const points = categories.map((_, index) => pointAt(item.values[index] ?? 0, index))
        return (
          <g key={item.name}>
            <polygon points={points.map((point) => point.join(' ')).join(' ')} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={2} />
            {points.map((point, index) => (
              <circle key={index} cx={point[0]} cy={point[1]} r={2.8} fill="var(--surface, #fffdf9)" stroke={color} strokeWidth={2}>
                <title>{`${categories[index]} · ${item.name}：${formatCompact(item.values[index] ?? 0)}`}</title>
              </circle>
            ))}
          </g>
        )
      })}
    </g>
  )
}

export function SheetChartView({ data, kind }: { data: ChartData; kind: SheetChartKind }) {
  const pie = kind === 'pie' || kind === 'donut'
  const slices = pie ? pieSlices(data) : []
  const empty = pie ? !slices.length : !data.categories.length || !data.series.length

  if (empty) {
    return (
      <div className="sheet-chart-empty">
        <span>所选区域还没有可绘制的数值</span>
      </div>
    )
  }

  const scatterSeries = kind === 'scatter' ? data.series.slice(1, 6) : []
  const legendItems = pie
    ? slices.map((slice) => ({
        label: slice.label,
        color: slice.color,
        value: `${formatCompact(slice.value)} · ${(slice.ratio * 100).toFixed(0)}%`,
      }))
    : kind === 'scatter'
      ? scatterSeries.map((series, index) => ({
          label: series.name,
          color: CHART_COLORS[(index + 1) % CHART_COLORS.length],
          value: '',
        }))
      : data.series.length > 1
        ? data.series.slice(0, 6).map((series, index) => ({
            label: series.name,
            color: CHART_COLORS[index % CHART_COLORS.length],
            value: '',
          }))
        : []

  return (
    <div className={pie ? 'sheet-chart-view is-pie' : 'sheet-chart-view'}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="数据图表">
        {pie ? (
          <PieChart data={data} donut={kind === 'donut'} />
        ) : kind === 'scatter' ? (
          <ScatterChart data={data} />
        ) : kind === 'radar' ? (
          <RadarChart data={data} />
        ) : (
          <CartesianChart data={data} kind={kind} />
        )}
      </svg>
      {legendItems.length > 0 && (
        <div className={pie ? 'sheet-chart-legend is-pie' : 'sheet-chart-legend'}>
          {legendItems.map((item) => (
            <span key={item.label} className="sheet-chart-legend-item">
              <i style={{ background: item.color }} />
              <em>{item.label}</em>
              {item.value && <b>{item.value}</b>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

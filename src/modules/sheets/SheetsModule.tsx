import { useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus2, FileSpreadsheet, FileUp, Plus, Search, Table2, X } from 'lucide-react'
import type { SheetRecord } from '../../types'
import { importSheetFile } from '../../lib/openFiles'
import { cn, timeAgo } from '../../lib/utils'
import { useT } from '../../i18n'
import { useLibrary } from '../../store/library'
import { useUI } from '../../store/ui'
import { SheetWorkbook } from './SheetWorkbook'

function sheetPlainText(sheet: SheetRecord): string {
  return sheet.tabs
    .map((tab) => `${tab.name} ${Object.values(tab.cells).map((cell) => cell.raw).join(' ')}`)
    .join(' ')
}

function sheetPreview(sheet: SheetRecord): string {
  const tab = sheet.tabs[0]
  if (!tab) return ''
  const values: string[] = []
  for (const cell of Object.values(tab.cells)) {
    const raw = cell.raw.trim()
    if (!raw || raw.startsWith('=')) continue
    values.push(raw)
    if (values.length >= 7) break
  }
  return values.join(' · ')
}

function sheetCellCount(sheet: SheetRecord): number {
  return sheet.tabs.reduce(
    (total, tab) => total + Object.values(tab.cells).filter((cell) => cell.raw.trim()).length,
    0,
  )
}

export function SheetsModule() {
  const t = useT()
  const sheets = useLibrary((s) => s.sheets)
  const activeSheetId = useLibrary((s) => s.activeSheetId)
  const setActive = useLibrary((s) => s.setActive)
  const createSheet = useLibrary((s) => s.createSheet)
  const toast = useUI((s) => s.toast)

  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const sorted = useMemo(() => [...sheets].sort((a, b) => b.updatedAt - a.updatedAt), [sheets])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return sorted
    return sorted.filter((sheet) => `${sheet.title}\n${sheetPlainText(sheet)}`.toLowerCase().includes(keyword))
  }, [sorted, query])

  const activeSheet = sheets.find((sheet) => sheet.id === activeSheetId) ?? null

  useEffect(() => {
    if (!sheets.some((sheet) => sheet.id === activeSheetId)) setActive('sheet', sheets[0]?.id ?? null)
  }, [sheets, activeSheetId, setActive])

  const handleNew = () => {
    createSheet()
    setQuery('')
    toast(t('已新建空白工作表'), 'success')
  }

  const importFile = async (file: File) => {
    const lower = file.name.toLowerCase()
    if (!/\.(xlsx|xls|csv)$/.test(lower)) {
      toast(t('支持 .xlsx、.xls 与 .csv 文件'), 'error')
      return
    }
    if (file.size > 30 * 1024 * 1024) {
      toast(t('文件不能超过 30MB'), 'error')
      return
    }
    setImporting(true)
    try {
      const info = await importSheetFile(file)
      setQuery('')
      toast(
        info.reused
          ? t('《{title}》已经打开过，已切换到已有表格', { title: info.title })
          : info.tabs > 1
            ? t('已导入 {n} 个工作表', { n: info.tabs })
            : t('表格已导入'),
        info.reused ? 'info' : 'success',
      )
    } catch (error) {
      toast((error as Error).message || t('导入失败，请检查文件'), 'error')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="sheets-shell">
      <aside className="sheets-sidebar">
        <div className="sheets-side-head">
          <div className="sheets-side-title-wrap">
            <h1 className="sheets-side-title">{t('表格')}</h1>
            <span className="sheets-side-count">{sheets.length}</span>
          </div>
          <button type="button" className="icon-btn" onClick={handleNew} title={t('新建表格')} aria-label={t('新建表格')}>
            <Plus size={16} />
          </button>
        </div>

        <div className="sheets-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('搜索标题或单元格')}
            aria-label={t('搜索表格')}
          />
          {query && (
            <button type="button" className="sheets-search-clear" onClick={() => setQuery('')} aria-label={t('清除搜索')}>
              <X size={12} />
            </button>
          )}
        </div>

        <div className="sheets-list" role="list">
          {filtered.map((sheet) => {
            const preview = sheetPreview(sheet)
            return (
              <button
                key={sheet.id}
                type="button"
                role="listitem"
                className={cn('sheet-file', sheet.id === activeSheetId && 'active')}
                onClick={() => setActive('sheet', sheet.id)}
              >
                <span className="sheet-file-icon" aria-hidden="true">
                  <FileSpreadsheet size={14} />
                </span>
                <span className="sheet-file-title">{sheet.title}</span>
                <span className="sheet-file-time tabular">{timeAgo(sheet.updatedAt)}</span>
                <span className="sheet-file-sub">
                  {preview || t('空白工作表，等待第一行数字。')}
                </span>
                <span className="sheet-file-meta">
                  {t('{tabs} 表 · {cells} 格', { tabs: sheet.tabs.length, cells: sheetCellCount(sheet) })}
                </span>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div className="sheets-list-empty">
              <Table2 size={18} />
              <p>{sheets.length === 0 ? t('还没有表格。') : t('没有匹配「{query}」的表格。', { query: query.trim() })}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleNew}>
                <FilePlus2 size={13} />
                {t('新建表格')}
              </button>
            </div>
          )}
        </div>

        <div className="sheets-side-foot">
          <button
            type="button"
            className="sheets-import-btn"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <FileUp size={14} />}
            {importing ? t('正在解析…') : t('导入 Excel / CSV')}
          </button>
          <p>{t('公式、列宽与数字格式尽量原样还原。')}</p>
        </div>
      </aside>

      <section className="sheets-main">
        {activeSheet ? (
          <SheetWorkbook key={activeSheet.id} sheet={activeSheet} />
        ) : (
          <div className="sheets-blank">
            <div className="sheets-blank-card">
              <div className="sheets-blank-grid" aria-hidden="true">
                {Array.from({ length: 24 }, (_, index) => (
                  <span key={index} />
                ))}
              </div>
              <span className="sheets-blank-mark">{t('表')}</span>
              <h2>{t('让数字先排成行列。')}</h2>
              <p>{t('公式、格式与多工作表都在本机计算。也可以导入现有的 Excel 文件继续处理。')}</p>
              <div className="sheets-blank-actions">
                <button type="button" className="btn btn-primary" onClick={handleNew}>
                  <Plus size={14} />
                  {t('新建表格')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
                  <FileUp size={14} />
                  {t('导入 Excel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
        }}
      />
    </div>
  )
}

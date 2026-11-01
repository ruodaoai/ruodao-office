import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CornerDownLeft,
  Download,
  FileStack,
  FileText,
  Home,
  Network,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Table2,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { cn, shortcut } from '../lib/utils'
import { useLibrary } from '../store/library'
import { useUI } from '../store/ui'
import { useT } from '../i18n'

interface PaletteItem {
  id: string
  label: string
  hint?: string
  group: string
  icon: LucideIcon
  run: () => void
}

export function CommandPalette() {
  const t = useT()
  const open = useUI((s) => s.paletteOpen)
  const setOpen = useUI((s) => s.setPaletteOpen)
  const setModule = useUI((s) => s.setModule)
  const setAiOpen = useUI((s) => s.setAiOpen)
  const openAiTask = useUI((s) => s.openAiTask)
  const openSettings = useUI((s) => s.openSettings)
  const docs = useLibrary((s) => s.docs)
  const sheets = useLibrary((s) => s.sheets)
  const notes = useLibrary((s) => s.notes)
  const createDoc = useLibrary((s) => s.createDoc)
  const createSheet = useLibrary((s) => s.createSheet)
  const createNote = useLibrary((s) => s.createNote)
  const setActive = useLibrary((s) => s.setActive)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const close = () => setOpen(false)
    const actions: PaletteItem[] = [
      {
        id: 'new-doc',
        label: '新建文档',
        hint: '富文本',
        group: '动作',
        icon: Plus,
        run: () => {
          createDoc()
          setModule('docs')
          close()
        },
      },
      {
        id: 'new-sheet',
        label: '新建表格',
        hint: '公式 / XLSX',
        group: '动作',
        icon: Plus,
        run: () => {
          createSheet()
          setModule('sheets')
          close()
        },
      },
      {
        id: 'new-note',
        label: '新建笔记',
        hint: '双链',
        group: '动作',
        icon: Plus,
        run: () => {
          createNote()
          setModule('notes')
          close()
        },
      },
      {
        id: 'go-home',
        label: '前往工作台',
        group: '导航',
        icon: Home,
        run: () => {
          setModule('home')
          close()
        },
      },
      {
        id: 'go-docs',
        label: '前往文档',
        group: '导航',
        icon: FileText,
        run: () => {
          setModule('docs')
          close()
        },
      },
      {
        id: 'go-sheets',
        label: '前往表格',
        group: '导航',
        icon: Table2,
        run: () => {
          setModule('sheets')
          close()
        },
      },
      {
        id: 'go-pdf',
        label: '前往 PDF 工具箱',
        group: '导航',
        icon: FileStack,
        run: () => {
          setModule('pdf')
          close()
        },
      },
      {
        id: 'go-notes',
        label: '前往双链笔记',
        group: '导航',
        icon: Network,
        run: () => {
          setModule('notes')
          close()
        },
      },
      {
        id: 'go-convert',
        label: '前往格式转换',
        hint: '图片 / PDF / 表格',
        group: '导航',
        icon: ArrowLeftRight,
        run: () => {
          setModule('convert')
          close()
        },
      },
      {
        id: 'open-ai',
        label: '打开 AI 助手',
        group: '动作',
        icon: Sparkles,
        run: () => {
          setAiOpen(true)
          close()
        },
      },
      {
        id: 'open-ai-task',
        label: '运行 AI 任务',
        hint: '处理当前内容',
        group: '动作',
        icon: Wand2,
        run: () => {
          openAiTask()
          close()
        },
      },
      {
        id: 'backup',
        label: '备份本地数据',
        group: '设置',
        icon: Download,
        run: () => {
          openSettings('data')
          close()
        },
      },
      {
        id: 'opensource',
        label: '了解开源说明',
        group: '设置',
        icon: ShieldCheck,
        run: () => {
          openSettings('about')
          close()
        },
      },
      {
        id: 'settings',
        label: '打开设置',
        group: '设置',
        icon: Settings,
        run: () => {
          openSettings('ai')
          close()
        },
      },
    ]

    const files: PaletteItem[] = [
      ...docs.map(
        (d): PaletteItem => ({
          id: `doc-${d.id}`,
          label: d.title,
          hint: '文档',
          group: '文件',
          icon: FileText,
          run: () => {
            setActive('doc', d.id)
            setModule('docs')
            close()
          },
        }),
      ),
      ...sheets.map(
        (d): PaletteItem => ({
          id: `sheet-${d.id}`,
          label: d.title,
          hint: '表格',
          group: '文件',
          icon: Table2,
          run: () => {
            setActive('sheet', d.id)
            setModule('sheets')
            close()
          },
        }),
      ),
      ...notes.map(
        (d): PaletteItem => ({
          id: `note-${d.id}`,
          label: d.title,
          hint: '笔记',
          group: '文件',
          icon: Network,
          run: () => {
            setActive('note', d.id)
            setModule('notes')
            close()
          },
        }),
      ),
    ]

    return [...actions, ...files]
  }, [docs, sheets, notes, createDoc, createSheet, createNote, setActive, setModule, setOpen, setAiOpen, openAiTask, openSettings])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => `${t(item.label)} ${item.hint ? t(item.hint) : ''} ${t(item.group)}`.toLowerCase().includes(q))
  }, [items, query, t])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const run = (item: PaletteItem) => item.run()

  const groups: Array<{ name: string; items: Array<{ item: PaletteItem; index: number }> }> = []
  filtered.forEach((item, index) => {
    let group = groups.find((g) => g.name === item.group)
    if (!group) {
      group = { name: item.group, items: [] }
      groups.push(group)
    }
    group.items.push({ item, index })
  })

  return createPortal(
    <div
      className="palette-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('命令面板')}>
        <div className="palette-input-row">
          <Search size={17} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={t('搜索文件、命令或操作…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((v) => Math.min(filtered.length - 1, v + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((v) => Math.max(0, v - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const item = filtered[activeIndex]
                if (item) run(item)
              } else if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="palette-empty">{t('没有匹配的文件或命令')}</div>}
          {groups.map((group) => (
            <div key={group.name}>
              <div className="palette-group">{t(group.name)}</div>
              {group.items.map(({ item, index }) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-index={index}
                    className={cn('palette-item', index === activeIndex && 'active')}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => run(item)}
                  >
                    <span className="palette-icon">
                      <Icon size={14} />
                    </span>
                    <span className="palette-item-name">{t(item.label)}</span>
                    {item.hint && <span className="palette-item-hint">{t(item.hint)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <ArrowUp size={10} />
            <ArrowDown size={10} />
            {t('浏览')}
          </span>
          <span>
            <CornerDownLeft size={10} />
            {t('打开')}
          </span>
          <span style={{ marginLeft: 'auto' }}>{t('{key} K 随时唤起', { key: shortcut })}</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

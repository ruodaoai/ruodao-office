import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Bold,
  Code2,
  Columns2,
  CornerUpLeft,
  Download,
  FileCode2,
  FileText,
  FileUp,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListTree,
  MoreHorizontal,
  Network,
  PanelRight,
  PenLine,
  Plus,
  Printer,
  Quote,
  Search,
  Sparkles,
  Strikethrough,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { ConfirmDialog, Dropdown } from '../../components/ui'
import { registerAiContext, registerAiInsert } from '../../lib/aiContext'
import { extractWikiLinks, noteExcerpt, renderMarkdown } from '../../lib/markdown'
import {
  buildStandaloneNoteHtml,
  extractOutline,
  linkSnippet,
  normalizeNoteTitle,
  printHtmlDocument,
  stripTitleHeading,
  uniqueNoteTitle,
} from '../../lib/notes'
import {
  cn,
  countText,
  downloadText,
  formatDateTime,
  readFileAsText,
  safeFilename,
  timeAgo,
} from '../../lib/utils'
import { useLibrary } from '../../store/library'
import { useUI } from '../../store/ui'
import { publishCollabCursor } from '../../store/collab'
import type { AiContext, NoteRecord } from '../../types'
import { NoteGraph, type GraphEdge } from './NoteGraph'

type Mode = 'edit' | 'split' | 'read'
type RailTab = 'links' | 'graph' | 'outline'
type NoteFilter = 'all' | 'orphan'

interface Backlink {
  sourceId: string
  sourceTitle: string
  updatedAt: number
  snippet: string
  count: number
}

interface OutgoingLink {
  target: string
  label: string
  targetId: string | null
}

type SuggestItem = { kind: 'note'; id: string; title: string } | { kind: 'create'; title: string }

interface SuggestState {
  from: number
  query: string
  index: number
}

const MODES: Array<{ id: Mode; label: string; icon: LucideIcon }> = [
  { id: 'edit', label: '编辑', icon: PenLine },
  { id: 'split', label: '分栏', icon: Columns2 },
  { id: 'read', label: '阅读', icon: BookOpen },
]

const RAIL_TABS: Array<{ id: RailTab; label: string }> = [
  { id: 'links', label: '关联' },
  { id: 'graph', label: '图谱' },
  { id: 'outline', label: '大纲' },
]

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches
}

export function NotesModule() {
  const notes = useLibrary((s) => s.notes)
  const activeNoteId = useLibrary((s) => s.activeNoteId)
  const setActive = useLibrary((s) => s.setActive)
  const createNote = useLibrary((s) => s.createNote)
  const updateNote = useLibrary((s) => s.updateNote)
  const deleteFile = useLibrary((s) => s.deleteFile)
  const toast = useUI((s) => s.toast)
  const openAiTask = useUI((s) => s.openAiTask)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<NoteFilter>('all')
  const [mode, setMode] = useState<Mode>('split')
  const [railTab, setRailTab] = useState<RailTab>('links')
  const [railOpen, setRailOpen] = useState(() => !isNarrowViewport())
  const [titleDraft, setTitleDraft] = useState('')
  const [suggest, setSuggest] = useState<SuggestState | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [importing, setImporting] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const selectionRef = useRef({ start: 0, end: 0 })
  const lastContentRef = useRef('')
  const scrollLockRef = useRef<'editor' | 'preview' | null>(null)
  const contextRef = useRef<AiContext | null>(null)
  const insertAiRef = useRef<(text: string) => boolean>(() => false)
  const modeRef = useRef<Mode>(mode)

  const sortedNotes = useMemo(() => [...notes].sort((a, b) => b.updatedAt - a.updatedAt), [notes])
  const activeNote = notes.find((note) => note.id === activeNoteId) ?? null

  const graphInfo = useMemo(() => {
    const titleMap = new Map<string, NoteRecord>()
    for (const note of notes) {
      const key = normalizeNoteTitle(note.title)
      if (key && !titleMap.has(key)) titleMap.set(key, note)
    }
    const outgoingByNote = new Map<string, OutgoingLink[]>()
    const backlinkMaps = new Map<string, Map<string, Backlink>>()
    const neighbors = new Map<string, Set<string>>()
    const edgeMap = new Map<string, GraphEdge>()

    const addNeighbor = (from: string, to: string) => {
      if (!neighbors.has(from)) neighbors.set(from, new Set())
      neighbors.get(from)?.add(to)
    }

    for (const note of notes) {
      const outgoing: OutgoingLink[] = []
      for (const link of extractWikiLinks(note.content)) {
        const target = titleMap.get(normalizeNoteTitle(link.target))
        outgoing.push({ target: link.target, label: link.label, targetId: target?.id ?? null })
        if (!target || target.id === note.id) continue
        addNeighbor(note.id, target.id)
        addNeighbor(target.id, note.id)
        const edgeKey = [note.id, target.id].sort().join('|')
        if (!edgeMap.has(edgeKey)) edgeMap.set(edgeKey, { source: note.id, target: target.id })
        if (!backlinkMaps.has(target.id)) backlinkMaps.set(target.id, new Map())
        const sources = backlinkMaps.get(target.id)!
        const existing = sources.get(note.id)
        if (existing) {
          existing.count += 1
        } else {
          sources.set(note.id, {
            sourceId: note.id,
            sourceTitle: note.title,
            updatedAt: note.updatedAt,
            snippet: linkSnippet(note.content, target.title),
            count: 1,
          })
        }
      }
      outgoingByNote.set(note.id, outgoing)
    }

    const backlinksById = new Map<string, Backlink[]>()
    backlinkMaps.forEach((sources, targetId) => {
      backlinksById.set(
        targetId,
        [...sources.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      )
    })
    const degree = new Map<string, number>()
    neighbors.forEach((set, id) => degree.set(id, set.size))
    const orphanCount = notes.filter((note) => (degree.get(note.id) ?? 0) === 0).length
    return {
      titleMap,
      outgoingByNote,
      backlinksById,
      degree,
      orphanCount,
      edges: [...edgeMap.values()],
      edgeCount: edgeMap.size,
    }
  }, [notes])

  const activeOutgoing = activeNote ? graphInfo.outgoingByNote.get(activeNote.id) ?? [] : []
  const activeBacklinks = activeNote ? graphInfo.backlinksById.get(activeNote.id) ?? [] : []
  const activeDegree = activeNote ? graphInfo.degree.get(activeNote.id) ?? 0 : 0
  const body = activeNote ? stripTitleHeading(activeNote.content, activeNote.title) : ''
  const outline = useMemo(() => extractOutline(body), [body])
  const stats = useMemo(() => countText(body), [body])
  const readingMinutes = Math.max(1, Math.ceil(stats.words / 300))
  const noteIndex = activeNote ? sortedNotes.findIndex((note) => note.id === activeNote.id) : -1

  const previewHtml = useMemo(() => {
    if (!activeNote) return ''
    const rendered = renderMarkdown(body, { wikilinks: true })
    const doc = new DOMParser().parseFromString(rendered, 'text/html')
    doc.body.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((heading, index) => {
      heading.id = `h-${index}`
    })
    doc.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => {
      box.removeAttribute('disabled')
    })
    doc.body.querySelectorAll<HTMLAnchorElement>('a.wikilink').forEach((anchor) => {
      const target = anchor.getAttribute('data-wikilink') ?? ''
      if (graphInfo.titleMap.has(normalizeNoteTitle(target))) {
        anchor.setAttribute('title', `打开「${target}」`)
      } else {
        anchor.classList.add('missing')
        anchor.setAttribute('title', '尚未创建 · 点击新建')
      }
    })
    return doc.body.innerHTML
  }, [body, activeNote, graphInfo.titleMap])

  const filteredNotes = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return sortedNotes.filter((note) => {
      if (filter === 'orphan' && (graphInfo.degree.get(note.id) ?? 0) > 0) return false
      if (!keyword) return true
      return note.title.toLowerCase().includes(keyword) || note.content.toLowerCase().includes(keyword)
    })
  }, [sortedNotes, query, filter, graphInfo.degree])

  const suggestionItems = useMemo<SuggestItem[]>(() => {
    if (!suggest) return []
    const keyword = normalizeNoteTitle(suggest.query)
    const matches: SuggestItem[] = sortedNotes
      .filter((note) => note.id !== activeNote?.id && (!keyword || normalizeNoteTitle(note.title).includes(keyword)))
      .slice(0, 6)
      .map((note) => ({ kind: 'note', id: note.id, title: note.title }))
    const typed = suggest.query.trim()
    if (typed && !sortedNotes.some((note) => normalizeNoteTitle(note.title) === normalizeNoteTitle(typed))) {
      matches.push({ kind: 'create', title: typed })
    }
    return matches
  }, [suggest, sortedNotes, activeNote?.id])

  const suggestIndex = suggest ? Math.min(suggest.index, Math.max(0, suggestionItems.length - 1)) : 0

  useEffect(() => {
    if (!notes.length) return
    if (!activeNoteId || !notes.some((note) => note.id === activeNoteId)) {
      setActive('note', sortedNotes[0]?.id ?? notes[0].id)
    }
  }, [notes, activeNoteId, setActive, sortedNotes])

  useEffect(() => {
    setTitleDraft(activeNote?.title ?? '')
  }, [activeNote?.id, activeNote?.title])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1180px)')
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) setRailOpen(false)
    }
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    setSuggest(null)
    lastContentRef.current = activeNote?.content ?? ''
    selectionRef.current = {
      start: activeNote?.content.length ?? 0,
      end: activeNote?.content.length ?? 0,
    }
    if (textareaRef.current) textareaRef.current.scrollTop = 0
    if (previewRef.current) previewRef.current.scrollTop = 0
  }, [activeNote?.id])

  useLayoutEffect(() => {
    if (!activeNote) return
    const next = activeNote.content
    if (next === lastContentRef.current) return
    lastContentRef.current = next
    const el = textareaRef.current
    if (!el || document.activeElement !== el) return
    const start = Math.min(selectionRef.current.start, next.length)
    const end = Math.min(Math.max(selectionRef.current.end, start), next.length)
    if (el.selectionStart !== start || el.selectionEnd !== end) el.setSelectionRange(start, end)
  }, [activeNote, activeNote?.content])

  useEffect(() => {
    if (!activeNote) {
      contextRef.current = null
      return
    }
    const relations = [
      ...new Set([...activeOutgoing.map((link) => link.target), ...activeBacklinks.map((link) => link.sourceTitle)]),
    ]
    contextRef.current = {
      kind: 'note',
      title: activeNote.title,
      text: `${activeNote.content.trim()}\n\n【关联笔记】${relations.length ? relations.join('、') : '暂无'}`,
    }
  }, [activeNote, activeOutgoing, activeBacklinks])

  useEffect(() => registerAiContext('notes', () => contextRef.current), [])
  useEffect(() => registerAiInsert('notes', (text) => insertAiRef.current(text)), [])

  useEffect(() => {
    insertAiRef.current = (text: string) => {
      const state = useLibrary.getState()
      const note = state.notes.find((item) => item.id === state.activeNoteId)
      if (!note) return false
      const insert = text.trim()
      if (!insert) return false
      if (modeRef.current === 'read') {
        const next = `${note.content.replace(/\s+$/, '')}${note.content.trim() ? '\n\n' : ''}${insert}\n`
        state.updateNote(note.id, { content: next })
        selectionRef.current = { start: next.length, end: next.length }
        return true
      }
      const content = note.content
      const start = Math.min(selectionRef.current.start, content.length)
      const end = Math.min(Math.max(selectionRef.current.end, start), content.length)
      const before = content.slice(0, start)
      const after = content.slice(end)
      const prefix = before && !/\n$/.test(before) ? '\n\n' : ''
      const suffix = after && !/^\n/.test(after) ? '\n\n' : ''
      const next = `${before}${prefix}${insert}${suffix}${after}`
      const caret = before.length + prefix.length + insert.length
      state.updateNote(note.id, { content: next })
      selectionRef.current = { start: caret, end: caret }
      window.requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(caret, caret)
      })
      return true
    }
  }, [activeNote, mode])

  const focusEditorAt = (start: number, end = start) => {
    selectionRef.current = { start, end }
    window.requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(start, end)
    })
  }

  const rememberSelection = () => {
    const el = textareaRef.current
    if (!el) return
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd }
    publishCursor(el)
  }

  const publishCursor = (el: HTMLTextAreaElement) => {
    if (!activeNote) return
    const caret = el.selectionStart
    const line = el.value.slice(0, caret).split('\n').length
    const column = caret - (el.value.lastIndexOf('\n', caret - 1) + 1) + 1
    publishCollabCursor(activeNote.id, line, column)
  }

  const replaceContent = (next: string, start: number, end = start) => {
    if (!activeNote) return
    updateNote(activeNote.id, { content: next })
    setSuggest(null)
    focusEditorAt(start, end)
  }

  const closeRailOnNarrow = () => {
    if (isNarrowViewport()) setRailOpen(false)
  }

  const openNote = (id: string) => {
    setSuggest(null)
    setActive('note', id)
    closeRailOnNarrow()
  }

  const updateSuggest = (value: string, caret: number) => {
    const start = value.lastIndexOf('[[', Math.max(0, caret - 1))
    if (start < 0) {
      setSuggest(null)
      return
    }
    const fragment = value.slice(start + 2, caret)
    if (fragment.length > 36 || fragment.includes('\n') || fragment.includes(']') || fragment.includes('|')) {
      setSuggest(null)
      return
    }
    setSuggest({ from: start, query: fragment, index: 0 })
  }

  const applySuggestion = (item: SuggestItem) => {
    if (!suggest || !activeNote) return
    const el = textareaRef.current
    const content = activeNote.content
    const caret = el ? el.selectionStart : suggest.from + 2 + suggest.query.length
    const start = Math.min(suggest.from, content.length)
    const end = Math.max(start, Math.min(caret, content.length))
    const link = `[[${item.title}]]`
    updateNote(activeNote.id, { content: `${content.slice(0, start)}${link}${content.slice(end)}` })
    setSuggest(null)
    focusEditorAt(start + link.length)
  }

  const openWikiLink = (title: string) => {
    const clean = title.trim()
    if (!clean) return
    const existing = graphInfo.titleMap.get(normalizeNoteTitle(clean))
    if (existing) {
      openNote(existing.id)
      return
    }
    const createdTitle = uniqueNoteTitle(notes.map((note) => note.title), clean)
    createNote({ title: createdTitle, content: `# ${createdTitle}\n\n` })
    setQuery('')
    setFilter('all')
    if (mode === 'read') setMode('split')
    closeRailOnNarrow()
    toast(`已新建「${createdTitle}」`, 'success')
  }

  const createBlankNote = () => {
    createNote()
    setQuery('')
    setFilter('all')
    setRailTab('links')
    if (mode === 'read') setMode('split')
    window.setTimeout(() => {
      titleRef.current?.focus()
      titleRef.current?.select()
    }, 70)
  }

  const commitTitle = () => {
    const state = useLibrary.getState()
    const note = state.notes.find((item) => item.id === activeNoteId)
    if (!note) return
    const nextTitle = titleDraft.trim()
    if (!nextTitle) {
      setTitleDraft(note.title)
      return
    }
    if (/[\[\]|]/.test(nextTitle)) {
      toast('标题不能包含 [ ] | 字符', 'error')
      setTitleDraft(note.title)
      return
    }
    if (nextTitle === note.title) return
    const clash = state.notes.find(
      (item) => item.id !== note.id && normalizeNoteTitle(item.title) === normalizeNoteTitle(nextTitle),
    )
    if (clash) {
      toast(`已存在同名笔记「${clash.title}」`, 'error')
      setTitleDraft(note.title)
      return
    }

    const pattern = new RegExp(`\\[\\[\\s*${escapeRegExp(note.title)}\\s*(\\|[^\\]]*)?\\]\\]`, 'gi')
    let linkUpdates = 0
    let nextContent = note.content
    for (const item of state.notes) {
      const updated = item.content.replace(pattern, (_all, alias?: string) => {
        linkUpdates += 1
        return `[[${nextTitle}${alias ?? ''}]]`
      })
      if (updated === item.content) continue
      if (item.id === note.id) nextContent = updated
      else state.updateNote(item.id, { content: updated })
    }

    const firstLine = nextContent.split('\n', 1)[0] ?? ''
    const heading = /^[ \t]*#\s+(.+?)\s*#*\s*$/.exec(firstLine)
    if (heading && normalizeNoteTitle(heading[1]) === normalizeNoteTitle(note.title)) {
      nextContent = nextContent.replace(/^[ \t]*#\s+[^\n]*/, `# ${nextTitle}`)
    }

    state.updateNote(note.id, { title: nextTitle, content: nextContent })
    toast(linkUpdates ? `标题已更新，同步 ${linkUpdates} 处双链` : '标题已更新', 'success')
  }

  const handleTitleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      setTitleDraft(activeNote?.title ?? '')
      event.currentTarget.blur()
    }
  }

  const handleEditorChange = (event: ReactChangeEvent<HTMLTextAreaElement>) => {
    if (!activeNote) return
    const value = event.target.value
    lastContentRef.current = value
    updateNote(activeNote.id, { content: value })
    const caret = event.target.selectionStart
    selectionRef.current = { start: caret, end: event.target.selectionEnd }
    publishCursor(event.target)
    updateSuggest(value, caret)
  }

  const handleListEnter = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = textareaRef.current
    if (!el || !activeNote) return
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start !== end) return
    const content = activeNote.content
    const lineStart = content.lastIndexOf('\n', start - 1) + 1
    const line = content.slice(lineStart, start)
    const match = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s?)(.*)$/.exec(line)
    if (!match) return
    event.preventDefault()
    const indent = match[1]
    const marker = match[2]
    const rest = match[3]
    if (!rest.trim()) {
      replaceContent(content.slice(0, lineStart) + indent + content.slice(end), lineStart + indent.length)
      return
    }
    let nextMarker = marker
    if (/^\d+\.\s+$/.test(marker)) nextMarker = `${Number.parseInt(marker, 10) + 1}. `
    else if (/^[-*+]\s+\[[xX]\]\s+$/.test(marker)) nextMarker = '- [ ] '
    const insertion = `\n${indent}${nextMarker}`
    replaceContent(content.slice(0, start) + insertion + content.slice(end), start + insertion.length)
  }

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (suggest) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (suggestionItems.length) {
          setSuggest((current) =>
            current ? { ...current, index: (current.index + 1) % suggestionItems.length } : current,
          )
        }
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (suggestionItems.length) {
          setSuggest((current) =>
            current
              ? { ...current, index: (current.index - 1 + suggestionItems.length) % suggestionItems.length }
              : current,
          )
        }
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = suggestionItems[suggestIndex]
        if (item) {
          event.preventDefault()
          applySuggestion(item)
          return
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSuggest(null)
        return
      }
    }

    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      wrapSelection('**', '**', '粗体')
      return
    }
    if (mod && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      wrapSelection('_', '_', '斜体')
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const el = textareaRef.current
      if (!el) return
      const start = el.selectionStart
      const end = el.selectionEnd
      replaceContent(`${el.value.slice(0, start)}  ${el.value.slice(end)}`, start + 2)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !mod) {
      handleListEnter(event)
    }
  }

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    const el = textareaRef.current
    if (!el || !activeNote) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const content = activeNote.content
    const selected = content.slice(start, end)
    const piece = selected || placeholder
    const next = `${content.slice(0, start)}${before}${piece}${after}${content.slice(end)}`
    replaceContent(next, start + before.length, start + before.length + piece.length)
  }

  const applyLineStyle = (style: 'h1' | 'h2' | 'quote' | 'bullet' | 'task') => {
    const el = textareaRef.current
    if (!el || !activeNote) return
    const content = activeNote.content
    const start = el.selectionStart
    const end = el.selectionEnd
    const lineStart = content.lastIndexOf('\n', start - 1) + 1
    const foundEnd = content.indexOf('\n', end)
    const lineEnd = foundEnd < 0 ? content.length : foundEnd
    const block = content.slice(lineStart, lineEnd)
    const nextBlock = block
      .split('\n')
      .map((line) => {
        if (!line.trim()) return line
        const indent = /^\s*/.exec(line)?.[0] ?? ''
        let text = line.slice(indent.length)
        if (style === 'h1' || style === 'h2') {
          const prefix = style === 'h1' ? '# ' : '## '
          if (text.startsWith(prefix)) return `${indent}${text.slice(prefix.length)}`
          text = text.replace(/^#{1,6}\s+/, '')
          return `${indent}${prefix}${text}`
        }
        if (style === 'quote') {
          if (text.startsWith('> ')) return `${indent}${text.slice(2)}`
          return `${indent}> ${text}`
        }
        text = text.replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, '')
        return style === 'task' ? `${indent}- [ ] ${text}` : `${indent}- ${text}`
      })
      .join('\n')
    replaceContent(content.slice(0, lineStart) + nextBlock + content.slice(lineEnd), lineStart, lineStart + nextBlock.length)
  }

  const insertLinkSyntax = () => {
    const el = textareaRef.current
    if (!el || !activeNote) return
    const content = activeNote.content
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = content.slice(start, end).trim()
    if (selected) {
      const text = `[${selected}](https://)`
      const urlStart = start + selected.length + 3
      replaceContent(content.slice(0, start) + text + content.slice(end), urlStart, urlStart + 8)
      return
    }
    const text = '[链接文字](https://)'
    replaceContent(content.slice(0, start) + text + content.slice(end), start + 1, start + 5)
  }

  const insertCodeBlock = () => {
    const el = textareaRef.current
    if (!el || !activeNote) return
    const content = activeNote.content
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = content.slice(start, end) || '代码'
    const prefix = start > 0 && !content.slice(0, start).endsWith('\n') ? '\n' : ''
    const suffix = end < content.length && !content.slice(end).startsWith('\n') ? '\n' : ''
    const block = `${prefix}\`\`\`\n${selected}\n\`\`\`\n${suffix}`
    replaceContent(
      content.slice(0, start) + block + content.slice(end),
      start + prefix.length + 4,
      start + prefix.length + 4 + selected.length,
    )
  }

  const startWikiLink = () => {
    const el = textareaRef.current
    if (!el || !activeNote) return
    const content = activeNote.content
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = content.slice(start, end).trim()
    if (selected) {
      const link = `[[${selected}]]`
      replaceContent(content.slice(0, start) + link + content.slice(end), start + link.length)
      return
    }
    const next = `${content.slice(0, start)}[[${content.slice(end)}`
    updateNote(activeNote.id, { content: next })
    setSuggest({ from: start, query: '', index: 0 })
    focusEditorAt(start + 2)
  }

  const handleEditorScroll = () => {
    if (mode !== 'split' || scrollLockRef.current === 'preview') return
    const editor = textareaRef.current
    const preview = previewRef.current
    if (!editor || !preview) return
    scrollLockRef.current = 'editor'
    const range = editor.scrollHeight - editor.clientHeight
    const ratio = range > 0 ? editor.scrollTop / range : 0
    preview.scrollTop = ratio * Math.max(0, preview.scrollHeight - preview.clientHeight)
    window.setTimeout(() => {
      if (scrollLockRef.current === 'editor') scrollLockRef.current = null
    }, 80)
  }

  const handlePreviewScroll = () => {
    if (mode !== 'split' || scrollLockRef.current === 'editor') return
    const editor = textareaRef.current
    const preview = previewRef.current
    if (!editor || !preview) return
    scrollLockRef.current = 'preview'
    const range = preview.scrollHeight - preview.clientHeight
    const ratio = range > 0 ? preview.scrollTop / range : 0
    editor.scrollTop = ratio * Math.max(0, editor.scrollHeight - editor.clientHeight)
    window.setTimeout(() => {
      if (scrollLockRef.current === 'preview') scrollLockRef.current = null
    }, 80)
  }

  const toggleTask = (checkbox: HTMLInputElement) => {
    if (!activeNote || !previewRef.current) return
    const boxes = Array.from(previewRef.current.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    const index = boxes.indexOf(checkbox)
    if (index < 0) return
    const lines = activeNote.content.split('\n')
    let seen = 0
    for (let i = 0; i < lines.length; i += 1) {
      const match = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(lines[i])
      if (!match) continue
      if (seen === index) {
        const isChecked = match[2].toLowerCase() === 'x'
        lines[i] = lines[i].replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, `$1${isChecked ? ' ' : 'x'}$3`)
        updateNote(activeNote.id, { content: lines.join('\n') })
        return
      }
      seen += 1
    }
  }

  const handlePreviewClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement
    const anchor = element.closest('a')
    if (anchor) {
      event.preventDefault()
      const wikiTarget = anchor.getAttribute('data-wikilink')
      if (wikiTarget) {
        openWikiLink(wikiTarget)
        return
      }
      const href = anchor.getAttribute('href') ?? ''
      if (/^https?:/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    const checkbox = element.closest('input[type="checkbox"]')
    if (checkbox) {
      event.preventDefault()
      toggleTask(checkbox as HTMLInputElement)
    }
  }

  const goHeading = (index: number) => {
    if (mode === 'edit') setMode('split')
    closeRailOnNarrow()
    window.setTimeout(() => {
      const container = previewRef.current
      if (!container) return
      const target = container.querySelector<HTMLElement>(`#h-${index}`)
      if (!target) return
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 20
      container.scrollTo({ top, behavior: 'smooth' })
    }, 60)
  }

  const importMarkdown = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast('Markdown 文件不能超过 5MB', 'error')
      return
    }
    setImporting(true)
    try {
      const text = (await readFileAsText(file)).replace(/^\uFEFF/, '')
      const heading = /^\s*#\s+(.+?)\s*$/m.exec(text)
      const base = heading?.[1]?.trim() || file.name.replace(/\.[^.]+$/, '') || '导入的笔记'
      const title = uniqueNoteTitle(notes.map((note) => note.title), base)
      if (!text.trim()) throw new Error('这个文件没有内容')
      createNote({ title, content: text })
      setQuery('')
      setFilter('all')
      setMode('read')
      setRailTab('links')
      toast('Markdown 已导入为笔记', 'success')
    } catch (error) {
      toast((error as Error).message || '导入失败，请检查文件', 'error')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const exportMarkdown = () => {
    if (!activeNote) return
    downloadText(activeNote.content, safeFilename(activeNote.title, 'md'), 'text/markdown')
    toast('Markdown 已导出', 'success')
  }

  const exportHtml = () => {
    if (!activeNote) return
    const html = buildStandaloneNoteHtml(activeNote.title, body, formatDateTime(Date.now()))
    downloadText(html, safeFilename(activeNote.title, 'html'), 'text/html')
    toast('HTML 已导出', 'success')
  }

  const printCurrent = () => {
    if (!activeNote) return
    const html = buildStandaloneNoteHtml(activeNote.title, body, formatDateTime(Date.now()))
    if (printHtmlDocument(html)) toast('正在打开打印视图', 'info')
    else toast('无法打开打印视图，请检查浏览器权限', 'error')
  }

  const askAboutNote = () => {
    if (!activeNote) return
    openAiTask()
  }

  const activeLabel = activeNote ? `笔记「${activeNote.title}」` : '当前笔记'

  return (
    <div className={cn('notes-shell', railOpen && 'rail-open', !activeNote && 'notes-shell-empty')}>
      <aside className="notes-side" aria-label="笔记列表">
        <div className="notes-side-head">
          <div className="notes-side-title-wrap">
            <h1 className="notes-side-title">笔记</h1>
            <span className="notes-side-count">{notes.length}</span>
          </div>
          <button type="button" className="icon-btn" onClick={createBlankNote} title="新建笔记" aria-label="新建笔记">
            <Plus size={16} />
          </button>
        </div>

        <div className="notes-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题与正文"
            aria-label="搜索笔记"
          />
          {query && (
            <button type="button" className="notes-search-clear" onClick={() => setQuery('')} aria-label="清除搜索">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="notes-filters" role="group" aria-label="笔记筛选">
          <button
            type="button"
            className={cn('notes-filter', filter === 'all' && 'active')}
            onClick={() => setFilter('all')}
          >
            全部 <span>{notes.length}</span>
          </button>
          <button
            type="button"
            className={cn('notes-filter', filter === 'orphan' && 'active')}
            onClick={() => setFilter('orphan')}
            title="没有出链也没有反链的笔记"
          >
            孤立 <span>{graphInfo.orphanCount}</span>
          </button>
        </div>

        <div className="notes-list" role="list">
          {filteredNotes.map((note) => {
            const degree = graphInfo.degree.get(note.id) ?? 0
            const excerpt = noteExcerpt(stripTitleHeading(note.content, note.title), 86)
            return (
              <button
                key={note.id}
                type="button"
                role="listitem"
                className={cn('note-card', note.id === activeNoteId && 'active')}
                onClick={() => openNote(note.id)}
                aria-current={note.id === activeNoteId ? 'page' : undefined}
              >
                <span className="note-card-row">
                  <span className="note-card-title">{note.title}</span>
                  {degree > 0 && (
                    <span className="note-card-degree" title={`${degree} 条连接`}>
                      <Link2 size={9} />
                      {degree}
                    </span>
                  )}
                </span>
                <span className="note-card-excerpt">{excerpt || '空白笔记，等待第一行字。'}</span>
                <span className="note-card-meta">
                  <span>{timeAgo(note.updatedAt)}</span>
                  <span className="note-card-dot">·</span>
                  <span>{countText(note.content).words} 字</span>
                </span>
              </button>
            )
          })}
          {filteredNotes.length === 0 && (
            <div className="notes-list-empty">
              <FileText size={18} />
              <p>
                {notes.length === 0
                  ? '还没有笔记。'
                  : query.trim()
                    ? `没有匹配「${query.trim()}」的笔记。`
                    : '还没有孤立笔记。'}
              </p>
              {notes.length === 0 ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={createBlankNote}>
                  <Plus size={13} />
                  新建笔记
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
        </div>

        <div className="notes-side-foot">
          <button
            type="button"
            className="notes-import-btn"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <FileUp size={14} />}
            {importing ? '正在读取…' : '导入 Markdown'}
          </button>
          <p>支持 .md / .txt · 只在本机解析与保存</p>
        </div>
      </aside>

      <section className="notes-main">
        {activeNote ? (
          <>
            <header className="notes-head">
              <div className="notes-head-main">
                <div className="notes-eyebrow">
                  <span className="dot" />
                  <span>NOTE {pad2(Math.max(1, noteIndex + 1))}</span>
                  <span className="notes-eyebrow-sep">/</span>
                  <span>更新于 {timeAgo(activeNote.updatedAt)}</span>
                </div>
                <div className={cn('notes-title-wrap', !titleDraft && 'is-empty')}>
                  <input
                    ref={titleRef}
                    className="notes-title-input"
                    value={titleDraft}
                    maxLength={80}
                    placeholder="未命名笔记"
                    aria-label="笔记标题"
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={handleTitleKeyDown}
                  />
                  <span className="notes-title-line" />
                </div>
                <div className="notes-head-meta">
                  <span>
                    <Link2 size={11} />
                    {activeOutgoing.length} 条出链
                  </span>
                  <span>
                    <CornerUpLeft size={11} />
                    {activeBacklinks.length} 条反链
                  </span>
                  {activeDegree === 0 && <span className="notes-lonely">尚无连接</span>}
                </div>
              </div>

              <div className="notes-head-actions">
                <div className="segmented notes-mode" role="group" aria-label="显示模式">
                  {MODES.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={mode === item.id ? 'active' : undefined}
                        onClick={() => {
                          setMode(item.id)
                          setSuggest(null)
                        }}
                        title={item.label}
                        aria-pressed={mode === item.id}
                      >
                        <Icon size={13} />
                        <span className="notes-mode-label">{item.label}</span>
                      </button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  className="icon-btn notes-rail-toggle"
                  onClick={() => setRailOpen((open) => !open)}
                  title="关联面板"
                  aria-expanded={railOpen}
                >
                  <PanelRight size={16} />
                </button>
                <button type="button" className="btn btn-secondary btn-sm notes-ai-btn" onClick={askAboutNote}>
                  <Sparkles size={13} />
                  <span>AI 梳理</span>
                </button>
                <Dropdown className="icon-btn" title="更多操作" trigger={<MoreHorizontal size={16} />}>
                  {(close) => (
                    <>
                      <div className="menu-label">本机导出</div>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close()
                          exportMarkdown()
                        }}
                      >
                        <Download size={14} />
                        导出 Markdown
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close()
                          exportHtml()
                        }}
                      >
                        <FileCode2 size={14} />
                        导出 HTML
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close()
                          printCurrent()
                        }}
                      >
                        <Printer size={14} />
                        打印 / 存为 PDF
                      </button>
                      <div className="menu-sep" />
                      <button
                        type="button"
                        className="menu-item danger"
                        onClick={() => {
                          close()
                          setDeleteOpen(true)
                        }}
                      >
                        <Trash2 size={14} />
                        删除笔记
                      </button>
                    </>
                  )}
                </Dropdown>
              </div>
            </header>

            <div className={cn('notes-stage', `mode-${mode}`)}>
              {mode !== 'read' && (
                <div className="notes-toolbar" role="toolbar" aria-label="Markdown 格式">
                  <button
                    type="button"
                    className="notes-tool notes-tool-text"
                    title="一级标题"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyLineStyle('h1')}
                  >
                    <Heading1 size={15} />
                  </button>
                  <button
                    type="button"
                    className="notes-tool notes-tool-text"
                    title="二级标题"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyLineStyle('h2')}
                  >
                    <Heading2 size={15} />
                  </button>
                  <span className="notes-tool-sep" />
                  <button
                    type="button"
                    className="notes-tool"
                    title="加粗（Ctrl+B）"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => wrapSelection('**', '**', '粗体')}
                  >
                    <Bold size={14} />
                  </button>
                  <button
                    type="button"
                    className="notes-tool"
                    title="斜体（Ctrl+I）"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => wrapSelection('_', '_', '斜体')}
                  >
                    <Italic size={14} />
                  </button>
                  <button
                    type="button"
                    className="notes-tool"
                    title="删除线"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => wrapSelection('~~', '~~', '删除线')}
                  >
                    <Strikethrough size={14} />
                  </button>
                  <span className="notes-tool-sep" />
                  <button
                    type="button"
                    className="notes-tool"
                    title="无序列表"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyLineStyle('bullet')}
                  >
                    <List size={15} />
                  </button>
                  <button
                    type="button"
                    className="notes-tool"
                    title="任务清单"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyLineStyle('task')}
                  >
                    <ListChecks size={15} />
                  </button>
                  <button
                    type="button"
                    className="notes-tool"
                    title="引用"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyLineStyle('quote')}
                  >
                    <Quote size={14} />
                  </button>
                  <button
                    type="button"
                    className="notes-tool"
                    title="代码块"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={insertCodeBlock}
                  >
                    <Code2 size={14} />
                  </button>
                  <span className="notes-tool-sep" />
                  <button
                    type="button"
                    className="notes-tool"
                    title="插入链接"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={insertLinkSyntax}
                  >
                    <Link2 size={14} />
                  </button>
                  <button
                    type="button"
                    className="notes-tool notes-tool-dual"
                    title="插入双链（也可以直接输入 [[）"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={startWikiLink}
                  >
                    <Network size={13} />
                    双链
                  </button>
                  <span className="notes-toolbar-spacer" />
                  <span className="notes-toolbar-hint">
                    <span className="notes-kbd">[[</span>
                    搜索并连接笔记
                  </span>
                </div>
              )}

              <div className={cn('notes-split', `split-${mode}`)}>
                {mode !== 'read' && (
                  <div className="notes-editor-pane">
                    <textarea
                      ref={textareaRef}
                      className="notes-editor"
                      value={activeNote.content}
                      spellCheck={false}
                      placeholder={'开始写点什么…\n\n输入 [[ 链接另一篇笔记，支持 Markdown 语法。'}
                      aria-label="Markdown 编辑器"
                      onChange={handleEditorChange}
                      onKeyDown={handleEditorKeyDown}
                      onSelect={rememberSelection}
                      onScroll={handleEditorScroll}
                      onBlur={() => window.setTimeout(() => setSuggest(null), 120)}
                    />
                    {suggest && (
                      <div className="notes-suggest" role="listbox" aria-label="链接到笔记">
                        <div className="notes-suggest-head">
                          <span>链接到笔记</span>
                          <span>
                            <span className="notes-kbd">↑</span>
                            <span className="notes-kbd">↓</span> 选择 · <span className="notes-kbd">Enter</span> 插入
                          </span>
                        </div>
                        {suggestionItems.map((item, index) => (
                          <button
                            key={item.kind === 'note' ? item.id : `new-${item.title}`}
                            type="button"
                            className={cn('notes-suggest-item', index === suggestIndex && 'active')}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applySuggestion(item)}
                          >
                            <span className="notes-suggest-icon">
                              {item.kind === 'note' ? <Link2 size={12} /> : <Plus size={12} />}
                            </span>
                            <span className="notes-suggest-title">{item.title}</span>
                            <span className="notes-suggest-hint">{item.kind === 'note' ? '已有笔记' : '待创建'}</span>
                          </button>
                        ))}
                        {suggestionItems.length === 0 && (
                          <div className="notes-suggest-empty">没有其他笔记可链接，直接输入标题即可。</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {mode !== 'edit' && (
                  <div
                    className="notes-preview-scroll"
                    ref={previewRef}
                    onScroll={handlePreviewScroll}
                    onClick={handlePreviewClick}
                  >
                    {body.trim() ? (
                      <article className="notes-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    ) : (
                      <div className="notes-preview-empty">
                        <span className="notes-empty-mark">¶</span>
                        <p>这篇笔记还没有正文。</p>
                        {mode === 'read' && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode('split')}>
                            <PenLine size={13} />
                            去编辑
                          </button>
                        )}
                        {mode === 'split' && <span className="notes-preview-hint">在左侧输入 Markdown，右侧会实时排版。</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <footer className="notes-status">
              <span className="notes-status-item">
                <span className="dot dot-green" />
                Markdown · 自动保存到本机
              </span>
              <span className="notes-status-spacer" />
              <span>{stats.words} 字</span>
              <span className="notes-status-chars">{stats.chars} 字符</span>
              {stats.words > 0 && <span>约 {readingMinutes} 分钟</span>}
              <span>{activeBacklinks.length} 条反链</span>
            </footer>
          </>
        ) : (
          <div className="notes-empty">
            <div className="notes-empty-inner">
              <svg className="notes-empty-visual" viewBox="0 0 240 124" aria-hidden="true">
                <path d="M54 84 C 88 48, 142 42, 184 68" fill="none" stroke="#d6ccbc" strokeWidth="1.2" strokeDasharray="4 5" />
                <path d="M70 96 C 110 108, 156 96, 190 84" fill="none" stroke="#e3dbce" strokeWidth="1" strokeDasharray="3 5" />
                <circle cx="54" cy="84" r="13" fill="#fffdf9" stroke="#d2cbbd" />
                <circle cx="54" cy="84" r="4" fill="#c8442b" />
                <circle cx="184" cy="68" r="10" fill="#fffdf9" stroke="#d2cbbd" />
                <circle cx="184" cy="68" r="3" fill="#a29a8e" />
                <circle cx="118" cy="42" r="7" fill="#fffdf9" stroke="#d2cbbd" />
                <circle cx="118" cy="42" r="2.5" fill="#a29a8e" />
                <circle cx="148" cy="99" r="5" fill="#f7e7e0" stroke="#e4b9a7" />
              </svg>
              <span className="notes-empty-eyebrow">LOCAL FIRST · LINKED NOTES</span>
              <h2>让笔记彼此认识。</h2>
              <p>
                写下第一篇，或用 <code>[[双链]]</code> 连接已有的想法。反向链接、关系图谱与大纲都会自动生成，内容只留在本机。
              </p>
              <div className="notes-empty-actions">
                <button type="button" className="btn btn-primary" onClick={createBlankNote}>
                  <Plus size={14} />
                  新建笔记
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
                  <FileUp size={14} />
                  导入 Markdown
                </button>
              </div>
              <span className="notes-empty-sample">
                <span className="notes-kbd">[[产品原则]]</span>
                <ArrowUpRight size={11} />
                <span className="notes-kbd">本地优先清单</span>
              </span>
            </div>
          </div>
        )}
      </section>

      {railOpen && <button type="button" className="notes-rail-backdrop" aria-label="关闭关联面板" onClick={() => setRailOpen(false)} />}

      {activeNote && (
        <aside className="notes-rail" aria-label="笔记关联面板">
          <div className="notes-rail-head">
            <div className="notes-rail-tabs" role="tablist" aria-label="关联面板视图">
              {RAIL_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={railTab === tab.id}
                  className={cn('notes-rail-tab', railTab === tab.id && 'active')}
                  onClick={() => setRailTab(tab.id)}
                >
                  {tab.label}
                  {tab.id === 'links' && activeBacklinks.length > 0 && <span>{activeBacklinks.length}</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="icon-btn icon-btn-sm notes-rail-close"
              onClick={() => setRailOpen(false)}
              aria-label="关闭关联面板"
            >
              <X size={14} />
            </button>
          </div>

          <div className="notes-rail-body">
            {railTab === 'links' && (
              <>
                <section>
                  <div className="notes-rail-title">
                    <CornerUpLeft size={11} />
                    链接到本篇
                    <span className="notes-rail-count">{activeBacklinks.length}</span>
                  </div>
                  {activeBacklinks.map((backlink) => (
                    <button
                      key={backlink.sourceId}
                      type="button"
                      className="notes-backlink"
                      onClick={() => openNote(backlink.sourceId)}
                    >
                      <span className="notes-backlink-head">
                        <span className="notes-backlink-title">{backlink.sourceTitle}</span>
                        {backlink.count > 1 && <span className="notes-backlink-count">×{backlink.count}</span>}
                        <span className="notes-backlink-time">{timeAgo(backlink.updatedAt)}</span>
                      </span>
                      <span className="notes-backlink-snippet">{backlink.snippet || '引用了这篇笔记。'}</span>
                    </button>
                  ))}
                  {activeBacklinks.length === 0 && <p className="notes-rail-empty">还没有其他笔记链接到这里。</p>}
                </section>

                <section className="notes-rail-section">
                  <div className="notes-rail-title">
                    <ArrowUpRight size={11} />
                    本篇链接到
                    <span className="notes-rail-count">{activeOutgoing.length}</span>
                  </div>
                  {activeOutgoing.map((link) => (
                    <button
                      key={`${link.target}-${link.label}`}
                      type="button"
                      className={cn('notes-outlink', !link.targetId && 'missing')}
                      title={link.label === link.target ? link.target : `${link.label} → ${link.target}`}
                      onClick={() => (link.targetId ? openNote(link.targetId) : openWikiLink(link.target))}
                    >
                      <span className="notes-outlink-icon">
                        {link.targetId ? <Link2 size={11} /> : <Plus size={11} />}
                      </span>
                      <span className="notes-outlink-name">{link.label}</span>
                      {!link.targetId && <span className="notes-outlink-badge">待创建</span>}
                    </button>
                  ))}
                  {activeOutgoing.length === 0 && (
                    <p className="notes-rail-empty">
                      还没有向外链接。在正文输入 <code>[[</code> 连接另一篇。
                    </p>
                  )}
                </section>

                <div className="notes-link-tip">
                  双链是双向的：在任意笔记里写 <code>[[{activeNote.title}]]</code>，它就会出现在这里。
                </div>
              </>
            )}

            {railTab === 'graph' && (
              <>
                <div className="notes-graph-wrap">
                  <NoteGraph
                    notes={notes}
                    edges={graphInfo.edges}
                    activeId={activeNote.id}
                    onOpen={openNote}
                  />
                </div>
                <div className="notes-graph-meta">
                  <span>{notes.length} 篇笔记</span>
                  <span>{graphInfo.edgeCount} 条连线</span>
                </div>
                <p className="notes-rail-note">点按节点切换笔记。红线聚焦当前笔记，孤立节点没有连线。</p>
                {notes.length < 2 && <p className="notes-rail-empty">再写一篇，把它们连起来看看。</p>}
              </>
            )}

            {railTab === 'outline' && (
              <>
                <div className="notes-rail-title">
                  <ListTree size={11} />
                  本篇大纲
                  <span className="notes-rail-count">{outline.length}</span>
                </div>
                {outline.map((item, index) => (
                  <button
                    key={`${item.level}-${item.text}-${index}`}
                    type="button"
                    className={cn('notes-outline-item', `notes-outline-l${Math.min(item.level, 4)}`)}
                    onClick={() => goHeading(index)}
                    title={item.text}
                  >
                    <span className="notes-outline-hash">{'#'.repeat(item.level)}</span>
                    <span className="notes-outline-text">{item.text}</span>
                  </button>
                ))}
                {outline.length === 0 && (
                  <p className="notes-rail-empty">还没有小标题。用 # 或 ## 组织内容，这里会自动生成大纲。</p>
                )}
                <div className="notes-link-tip">点击标题可跳转到预览位置；编辑模式下会自动切到分栏。</div>
              </>
            )}
          </div>
        </aside>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="删除这篇笔记？"
        description={
          activeNote ? (
            <>
              将删除「{activeNote.title}」。其他笔记里指向它的双链会保留下来，显示为待创建，不会被自动清理。
            </>
          ) : null
        }
        confirmText="删除笔记"
        onConfirm={() => {
          if (activeNote) {
            deleteFile('note', activeNote.id)
            toast('笔记已删除', 'success')
          }
        }}
        onClose={() => setDeleteOpen(false)}
      />

      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importMarkdown(file)
        }}
      />
    </div>
  )
}

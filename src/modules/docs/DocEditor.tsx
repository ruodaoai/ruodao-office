import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code2,
  Download,
  FileDown,
  FileType2,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  PenLine,
  Printer,
  Quote,
  Redo2,
  RefreshCw,
  RemoveFormatting,
  Sparkles,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react'
import type { DocRecord } from '../../types'
import { ConfirmDialog, Dropdown, Modal } from '../../components/ui'
import morphdom from 'morphdom'
import { exportToDocx } from '../../lib/docxExport'
import { registerAiContext, registerAiInsert } from '../../lib/aiContext'
import { renderMarkdown, sanitizeDocHtml } from '../../lib/markdown'
import {
  base64ToBytes,
  bytesToBase64,
  clamp,
  cn,
  compressImageFile,
  countText,
  downloadBlob,
  downloadBytes,
  downloadText,
  escapeHtml,
  htmlToText,
  safeFilename,
  sha256Hex,
} from '../../lib/utils'
import { useLibrary } from '../../store/library'
import { useUI } from '../../store/ui'
import { localeTag, useT } from '../../i18n'

type AlignKind = 'left' | 'center' | 'right' | 'justify'

interface FormatState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  block: string
  ordered: boolean
  unordered: boolean
  align: AlignKind
}

interface BubbleState {
  top: number
  left: number
  text: string
}

const INITIAL_FORMAT: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  block: 'p',
  ordered: false,
  unordered: false,
  align: 'left',
}

const TEXT_COLORS = [
  { name: '墨色', value: '#201e1a' },
  { name: '朱砂', value: '#b6402a' },
  { name: '靛蓝', value: '#35587a' },
  { name: '松绿', value: '#2f7457' },
  { name: '琥珀', value: '#94682a' },
  { name: '灰', value: '#7a7369' },
]

const HIGHLIGHTS = ['#fff0c9', '#fbe2da', '#e6f1e9', '#e7eff6', '#f1ece1', '#f3e3ef']

const AI_PROMPTS = {
  polish: '请润色下面这段文字：保持原意与语气，修正表达、节奏与标点，直接输出润色后的文本。',
  summary: '请总结下面这段文字：先给一句结论，再列出 3–5 个要点。',
  continue: '请基于下面这段文字继续写下去，保持同样的语气与结构，直接输出续写内容。',
} as const

function queryState(command: string): boolean {
  try {
    return document.queryCommandState(command)
  } catch {
    return false
  }
}

function selectionInside(editor: HTMLElement): Selection | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.commonAncestorContainer)) return null
  return selection
}

function caretOffsetIn(editor: HTMLElement): number | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer)) return null
  const pre = range.cloneRange()
  pre.selectNodeContents(editor)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length
}

function placeCaretAt(editor: HTMLElement, offset: number) {
  const selection = window.getSelection()
  if (!selection) return
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode() as Text | null
  while (node) {
    const length = node.data.length
    if (remaining <= length) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    remaining -= length
    node = walker.nextNode() as Text | null
  }
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function fillPageNumberFields(section: HTMLElement, page: number, total: number) {
  section.querySelectorAll('footer, header').forEach((container) => {
    const spans = [...container.querySelectorAll('span')]
    spans.forEach((span, index) => {
      const text = span.textContent ?? ''
      const next = spans
        .slice(index + 1, index + 3)
        .map((item) => item.textContent ?? '')
        .join('')
      let value: number | null = null
      if (/第\s*$/.test(text) && /页/.test(next)) value = page
      else if (/共\s*$/.test(text) && /页/.test(next)) value = total
      else if (/\bpage\s*$/i.test(text) && /\bof\b/i.test(next)) value = page
      else if (/\bof\s*$/i.test(text) && /\bpage\b/i.test(next)) value = total
      if (value === null) return
      const clone = span.cloneNode(false) as HTMLElement
      clone.textContent = String(value)
      span.after(clone)
    })
  })
}

function buildStandaloneHtml(title: string, body: string): string {
  const startsWithHeading = /^\s*<h1[\s>]/i.test(body)
  const heading = startsWithHeading ? '' : `<h1 class="export-title">${escapeHtml(title)}</h1>`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 20px; background: #f1eee8; color: #24211c;
    font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", STSong, SimSun, serif;
    font-size: 16px; line-height: 1.95; }
  article { max-width: 720px; margin: 0 auto; padding: 64px 76px; background: #fff;
    box-shadow: 0 18px 60px rgba(40, 33, 22, 0.12); }
  h1, h2, h3, h4 { line-height: 1.4; color: #1f1c17; }
  .export-title { margin: 0 0 32px; font-size: 32px; }
  h1 { font-size: 28px; margin: 1.4em 0 0.6em; }
  h2 { font-size: 22px; margin: 1.5em 0 0.5em; }
  h3 { font-size: 18px; margin: 1.3em 0 0.5em; }
  p { margin: 0 0 1em; }
  ul, ol { margin: 0 0 1em; padding-left: 1.5em; }
  li { margin: 0.25em 0; }
  blockquote { margin: 1.3em 0; padding: 2px 0 2px 18px; border-left: 2px solid #c8442b; color: #5c554b; }
  blockquote p:last-child { margin-bottom: 0; }
  table { width: 100%; margin: 1.4em 0; border-collapse: collapse; font-size: 0.94em; }
  th, td { padding: 7px 10px; border: 1px solid #ddd6c9; text-align: left; vertical-align: top; }
  th { background: #f4efe5; font-weight: 600; }
  code { padding: 1px 4px; border-radius: 3px; background: #f3efe6; font-family: Consolas, "Cascadia Code", monospace; font-size: 0.88em; }
  pre { padding: 14px 16px; background: #f4f0e8; overflow: auto; font-size: 0.88em; }
  pre code { padding: 0; background: none; }
  hr { margin: 2em 0; border: 0; border-top: 1px solid #ddd6c9; }
  a { color: #35587a; }
  img { max-width: 100%; height: auto; border-radius: 3px; }
  @media print {
    body { padding: 0; background: #fff; }
    article { max-width: none; padding: 0; box-shadow: none; }
  }
</style>
</head>
<body>
<article>${heading}${body}</article>
</body>
</html>`
}

function ToolButton({
  label,
  active,
  onClick,
  children,
  className,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn('doc-tool-btn', active && 'active', className)}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function DocEditor({ doc }: { doc: DocRecord }) {
  const t = useT()
  const updateDoc = useLibrary((s) => s.updateDoc)
  const deleteFile = useLibrary((s) => s.deleteFile)
  const askAi = useUI((s) => s.askAi)
  const openAiTask = useUI((s) => s.openAiTask)
  const toast = useUI((s) => s.toast)

  const canvasRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const commitTimer = useRef<number | undefined>(undefined)
  const titleTimer = useRef<number | undefined>(undefined)
  const lastRange = useRef<Range | null>(null)
  const titleRef = useRef(doc.title)
  const lastCommittedHtml = useRef(doc.html)
  const latestHtml = useRef(doc.html)

  const [title, setTitle] = useState(doc.title)
  const [stats, setStats] = useState(() => countText(htmlToText(doc.html)))
  const [format, setFormat] = useState<FormatState>(INITIAL_FORMAT)
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [tableOpen, setTableOpen] = useState(false)
  const [tableSize, setTableSize] = useState({ rows: 3, cols: 3 })
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [view, setView] = useState<'edit' | 'source'>(() =>
    doc.sourceDocx?.importedHtml && doc.html === doc.sourceDocx.importedHtml ? 'source' : 'edit',
  )
  const [baseline, setBaseline] = useState<string | null>(doc.sourceDocx?.importedHtml ?? null)
  const [syncingSource, setSyncingSource] = useState(false)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const sourceBodyRef = useRef<HTMLDivElement>(null)
  const sourceStyleRef = useRef<HTMLDivElement>(null)

  const sourceDirty = Boolean(doc.sourceDocx) && baseline !== null && doc.html !== baseline
  const sourceUntracked = Boolean(doc.sourceDocx) && baseline === null

  const commitNow = useCallback(() => {
    const editor = editorRef.current
    const raw = editor ? editor.innerHTML : latestHtml.current
    const html = sanitizeDocHtml(raw ?? '')
    if (editor) setStats(countText(editor.innerText))
    if (html === lastCommittedHtml.current) return
    lastCommittedHtml.current = html
    latestHtml.current = html
    updateDoc(doc.id, { html })
  }, [doc.id, updateDoc])

  const scheduleCommit = useCallback(() => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = undefined
      commitNow()
    }, 420)
  }, [commitNow])

  const refreshToolbar = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const selection = selectionInside(editor)
    if (!selection) return
    const raw = String(document.queryCommandValue('formatBlock') || '')
      .toLowerCase()
      .replace(/[<>]/g, '')
    const block = ['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(raw) ? raw : 'p'
    const align: AlignKind = queryState('justifyCenter')
      ? 'center'
      : queryState('justifyRight')
        ? 'right'
        : queryState('justifyFull')
          ? 'justify'
          : 'left'
    setFormat({
      bold: queryState('bold'),
      italic: queryState('italic'),
      underline: queryState('underline'),
      strike: queryState('strikeThrough'),
      block,
      ordered: queryState('insertOrderedList'),
      unordered: queryState('insertUnorderedList'),
      align,
    })
  }, [])

  const refreshBubble = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const selection = selectionInside(editor)
    if (!selection) {
      setBubble(null)
      return
    }
    const range = selection.getRangeAt(0)
    lastRange.current = range.cloneRange()
    if (range.collapsed) {
      setBubble(null)
      return
    }
    const text = selection.toString().trim()
    if (!text) {
      setBubble(null)
      return
    }
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setBubble(null)
      return
    }
    setBubble({
      top: Math.max(64, rect.top - 12),
      left: clamp(rect.left + rect.width / 2, 170, window.innerWidth - 170),
      text: text.slice(0, 6000),
    })
  }, [])

  const restoreCaret = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const selection = window.getSelection()
    if (!selection) return
    if (lastRange.current) {
      try {
        selection.removeAllRanges()
        selection.addRange(lastRange.current)
        return
      } catch {
        /* the stored range can be invalidated after DOM edits */
      }
    }
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])

  const insertHtml = useCallback(
    (html: string) => {
      if (!editorRef.current) return false
      restoreCaret()
      try {
        document.execCommand('insertHTML', false, html)
      } catch {
        return false
      }
      const editor = editorRef.current
      if (editor) {
        editor.dataset.empty = editor.textContent?.trim() || editor.querySelector('img,table,hr') ? 'false' : 'true'
      }
      scheduleCommit()
      refreshToolbar()
      setBubble(null)
      return true
    },
    [refreshToolbar, restoreCaret, scheduleCommit],
  )

  const applyCommand = useCallback(
    (command: string, value?: string) => {
      if (!editorRef.current) return
      restoreCaret()
      try {
        document.execCommand(command, false, value)
      } catch {
        /* unsupported command on this browser */
      }
      scheduleCommit()
      refreshToolbar()
      setBubble(null)
    },
    [refreshToolbar, restoreCaret, scheduleCommit],
  )

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.innerHTML = doc.html
    lastCommittedHtml.current = doc.html
    latestHtml.current = doc.html
    const last = editor.lastElementChild
    if (last && ['TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR', 'IMG'].includes(last.tagName)) {
      const tail = document.createElement('p')
      tail.appendChild(document.createElement('br'))
      editor.appendChild(tail)
    }
    editor.dataset.empty = editor.textContent?.trim() || editor.querySelector('img,table,hr') ? 'false' : 'true'
    setStats(countText(editor.innerText))
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p')
    } catch {
      /* older browsers already default to paragraphs */
    }
  }, [doc.id, view])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (doc.html === lastCommittedHtml.current) return
    const focused = document.activeElement === editor
    const caret = focused ? caretOffsetIn(editor) : null
    const holder = document.createElement('div')
    holder.innerHTML = doc.html
    const last = holder.lastElementChild
    if (last && ['TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR', 'IMG'].includes(last.tagName)) {
      const tail = document.createElement('p')
      tail.appendChild(document.createElement('br'))
      holder.appendChild(tail)
    }
    morphdom(editor, holder, { childrenOnly: true })
    editor.dataset.empty = editor.textContent?.trim() || editor.querySelector('img,table,hr') ? 'false' : 'true'
    setStats(countText(editor.innerText))
    lastCommittedHtml.current = doc.html
    latestHtml.current = doc.html
    if (caret !== null) placeCaretAt(editor, caret)
  }, [doc.html])

  useEffect(() => {
    if (document.activeElement === titleInputRef.current) return
    setTitle(doc.title)
    titleRef.current = doc.title
  }, [doc.title])

  useEffect(() => {
    setBaseline(doc.sourceDocx?.importedHtml ?? null)
  }, [doc.sourceDocx])

  useEffect(() => {
    const flush = () => {
      if (commitTimer.current) {
        window.clearTimeout(commitTimer.current)
        commitTimer.current = undefined
      }
      commitNow()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('ruodao:flush', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('ruodao:flush', flush)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [commitNow])

  useEffect(() => {
    setBubble(null)
  }, [view])

  useEffect(() => {
    if (view !== 'source' || !doc.sourceDocx) return
    const body = sourceBodyRef.current
    if (!body) return
    let cancelled = false
    setSourceLoading(true)
    setSourceError(null)
    body.innerHTML = ''
    void (async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        if (cancelled) return
        await renderAsync(base64ToBytes(doc.sourceDocx!.dataBase64), body, sourceStyleRef.current ?? undefined, {
          className: 'docx',
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
          experimental: true,
        })
        if (cancelled) return
        const pages = [...body.querySelectorAll<HTMLElement>('section.docx')]
        pages.forEach((section, index) => fillPageNumberFields(section, index + 1, pages.length))
        setSourceLoading(false)
      } catch (error) {
        if (cancelled) return
        setSourceLoading(false)
        setSourceError((error as Error).message || t('原稿渲染失败'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [view, doc.id, doc.sourceDocx])

  useEffect(() => {
    let frame = 0
    const onSelectionChange = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        refreshToolbar()
        refreshBubble()
      })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [refreshToolbar, refreshBubble])

  useEffect(() => {
    const canvas = canvasRef.current
    const hide = () => setBubble(null)
    canvas?.addEventListener('scroll', hide, { passive: true })
    window.addEventListener('resize', hide)
    return () => {
      canvas?.removeEventListener('scroll', hide)
      window.removeEventListener('resize', hide)
    }
  }, [])

  useEffect(() => {
    return registerAiContext('docs', () => {
      const editor = editorRef.current
      const text = editor ? htmlToText(editor.innerHTML) : htmlToText(doc.html)
      return {
        kind: 'doc',
        title: titleRef.current.trim() || t('未命名文档'),
        text,
      }
    })
  }, [doc.id])

  useEffect(() => {
    return registerAiInsert('docs', (text) => insertHtml(renderMarkdown(text)))
  }, [insertHtml])

  const handleInput = () => {
    const editor = editorRef.current
    if (!editor) return
    latestHtml.current = editor.innerHTML
    editor.dataset.empty = editor.textContent?.trim() || editor.querySelector('img,table,hr') ? 'false' : 'true'
    setStats(countText(editor.innerText))
    scheduleCommit()
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const html = event.clipboardData.getData('text/html')
    if (!html) return
    event.preventDefault()
    insertHtml(sanitizeDocHtml(html))
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const file = event.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    event.preventDefault()
    void insertImage(file)
  }

  const insertImage = async (file: File) => {
    try {
      const { dataUrl, width } = await compressImageFile(file, 1400)
      const displayWidth = Math.min(640, width)
      insertHtml(
        `<img src="${dataUrl}" alt="${escapeHtml(file.name)}" style="width:${displayWidth}px;max-width:100%"><p><br></p>`,
      )
      toast(t('图片已插入，并压缩后存到本机'), 'success')
    } catch (error) {
      toast((error as Error).message || t('图片插入失败'), 'error')
    }
  }

  const handleTitleChange = (value: string) => {
    setTitle(value)
    titleRef.current = value
    if (titleTimer.current) window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(() => {
      titleTimer.current = undefined
      updateDoc(doc.id, { title: value.trim() || t('未命名文档') })
    }, 320)
  }

  const handleTitleBlur = () => {
    if (titleTimer.current) {
      window.clearTimeout(titleTimer.current)
      titleTimer.current = undefined
    }
    const next = title.trim() || t('未命名文档')
    if (!title.trim()) {
      setTitle(next)
      titleRef.current = next
    }
    updateDoc(doc.id, { title: next })
  }

  const currentHtml = () => editorRef.current?.innerHTML ?? doc.html

  const exportDocx = async () => {
    setExporting(true)
    try {
      const { blob, skippedImages } = await exportToDocx(currentHtml(), title.trim() || t('未命名文档'))
      downloadBlob(blob, safeFilename(title.trim() || t('未命名文档'), 'docx'))
      toast(
        skippedImages
          ? t('DOCX 已导出，{n} 张图片未包含在 Word 中', { n: skippedImages })
          : t('Word 文档已导出'),
        skippedImages ? 'info' : 'success',
      )
    } catch (error) {
      toast((error as Error).message || t('导出失败，请重试'), 'error')
    } finally {
      setExporting(false)
    }
  }

  const exportSourceDocx = () => {
    const source = doc.sourceDocx
    if (!source) return
    try {
      downloadBytes(
        base64ToBytes(source.dataBase64),
        safeFilename(title.trim() || source.name, 'docx'),
        source.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      toast(t('已导出原始 Word 文件'), 'success')
    } catch {
      toast(t('原稿数据无法读取，请重新导入'), 'error')
    }
  }

  const syncSourceFromEdits = async () => {
    const source = doc.sourceDocx
    if (!source || syncingSource) return
    setSyncingSource(true)
    try {
      const html = sanitizeDocHtml(currentHtml())
      const { blob, skippedImages } = await exportToDocx(html, title.trim() || t('未命名文档'))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const name = /\.docx$/i.test(source.name)
        ? source.name
        : `${safeFilename(title.trim() || t('未命名文档'), 'docx')}`
      updateDoc(doc.id, {
        sourceDocx: {
          name,
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          dataBase64: bytesToBase64(bytes),
          savedAt: Date.now(),
          hash: await sha256Hex(bytes),
          originHash: source.originHash ?? source.hash,
          size: bytes.byteLength,
          importedHtml: html,
        },
      })
      setBaseline(html)
      toast(
        skippedImages
          ? t('原稿已用当前内容更新，{n} 张图片未包含在 Word 中', { n: skippedImages })
          : t('原稿已用当前内容更新，之后打开会显示最新版本'),
        skippedImages ? 'info' : 'success',
      )
    } catch (error) {
      toast((error as Error).message || t('更新原稿失败，请重试'), 'error')
    } finally {
      setSyncingSource(false)
    }
  }

  const exportHtml = () => {
    const name = title.trim() || t('未命名文档')
    downloadText(buildStandaloneHtml(name, currentHtml()), safeFilename(name, 'html'), 'text/html')
    toast(t('HTML 已导出'), 'success')
  }

  const printPdf = () => {
    const name = title.trim() || t('未命名文档')
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;height:1000px;border:0;'
    document.body.appendChild(frame)
    const win = frame.contentWindow
    if (!win) {
      frame.remove()
      toast(t('当前浏览器无法打开打印窗口'), 'error')
      return
    }
    win.document.open()
    win.document.write(buildStandaloneHtml(name, currentHtml()))
    win.document.close()
    window.setTimeout(() => {
      try {
        win.focus()
        win.print()
      } catch {
        toast(t('打印窗口被浏览器拦截'), 'error')
      }
      window.setTimeout(() => frame.remove(), 2000)
    }, 360)
    toast(t('已打开打印窗口，请选择「另存为 PDF」'), 'info')
  }

  const openLinkDialog = () => {
    setLinkUrl('')
    setLinkOpen(true)
  }

  const confirmLink = () => {
    const raw = linkUrl.trim()
    if (!raw) return
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#') || raw.startsWith('/') ? raw : `https://${raw}`
    restoreCaret()
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) {
      try {
        document.execCommand('createLink', false, url)
      } catch {
        insertHtml(`<a href="${escapeHtml(url)}">${escapeHtml(raw)}</a>`)
      }
    } else {
      insertHtml(`<a href="${escapeHtml(url)}">${escapeHtml(raw)}</a>`)
    }
    setLinkOpen(false)
    scheduleCommit()
  }

  const confirmTable = () => {
    const rows = clamp(Number(tableSize.rows) || 3, 1, 10)
    const cols = clamp(Number(tableSize.cols) || 3, 1, 8)
    const header = Array.from({ length: cols }, (_, i) => `<th>${t('列 {n}', { n: i + 1 })}</th>`).join('')
    const body = Array.from({ length: Math.max(0, rows - 1) }, () =>
      `<tr>${Array.from({ length: cols }, () => '<td><br></td>').join('')}</tr>`,
    ).join('')
    insertHtml(`<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table><p><br></p>`)
    setTableOpen(false)
  }

  const runAi = (mode: keyof typeof AI_PROMPTS) => {
    const editor = editorRef.current
    const selection = editor ? selectionInside(editor) : null
    const selected = selection && !selection.isCollapsed ? selection.toString().trim() : ''
    const text = selected || lastRange.current?.toString().trim() || ''
    if (!text) {
      setBubble(null)
      openAiTask('请通读当前文档并给出改进建议：表达、结构与需要补充的信息。')
      return
    }
    askAi(`${AI_PROMPTS[mode]}\n\n${text}`)
    setBubble(null)
  }

  const createdLabel = new Date(doc.createdAt).toLocaleDateString(localeTag(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <>
      <div className="doc-editor">
        {doc.sourceDocx && (
          <div className="doc-mode-bar">
            <span className="doc-mode-file">
              <FileType2 size={13} />
              <span className="doc-mode-name" title={doc.sourceDocx.name}>
                {doc.sourceDocx.name}
              </span>
              <span className={cn('doc-mode-badge', sourceDirty && 'is-dirty')}>
                {sourceDirty ? t('原稿待同步') : t('原稿已保留')}
              </span>
            </span>
            <div className="segmented doc-mode-switch" role="group" aria-label={t('文档视图')}>
              <button
                type="button"
                className={view === 'edit' ? 'active' : undefined}
                aria-pressed={view === 'edit'}
                title={t('转为可编辑文本，版式会按网页排版重新近似还原')}
                onClick={() => setView('edit')}
              >
                <PenLine size={12} />
                {t('编辑')}
              </button>
              <button
                type="button"
                className={view === 'source' ? 'active' : undefined}
                aria-pressed={view === 'source'}
                title={t('按 Word 原始版式渲染，与 WPS 打开效果一致')}
                onClick={() => setView('source')}
              >
                <FileType2 size={12} />
                {t('原稿')}
              </button>
            </div>
          </div>
        )}

        {view === 'edit' && (
        <div className="doc-toolbar" role="toolbar" aria-label={t('文档格式工具')}>
          <div className="doc-tool-group">
            <ToolButton
              label={t('撤销')}
              onClick={() => {
                editorRef.current?.focus()
                document.execCommand('undo')
                scheduleCommit()
              }}
            >
              <Undo2 size={15} />
            </ToolButton>
            <ToolButton
              label={t('重做')}
              onClick={() => {
                editorRef.current?.focus()
                document.execCommand('redo')
                scheduleCommit()
              }}
            >
              <Redo2 size={15} />
            </ToolButton>
          </div>

          <span className="doc-tool-sep" />

          <select
            className="doc-select doc-block-select"
            value={format.block}
            aria-label={t('段落样式')}
            onChange={(event) => applyCommand('formatBlock', `<${event.target.value}>`)}
          >
            <option value="p">{t('正文')}</option>
            <option value="h1">{t('标题 1')}</option>
            <option value="h2">{t('标题 2')}</option>
            <option value="h3">{t('标题 3')}</option>
            <option value="blockquote">{t('引用')}</option>
            <option value="pre">{t('代码块')}</option>
          </select>

          <select
            className="doc-select doc-size-select"
            defaultValue="3"
            aria-label={t('字号')}
            onChange={(event) => applyCommand('fontSize', event.target.value)}
          >
            <option value="2">{t('小 13')}</option>
            <option value="3">{t('正文 16')}</option>
            <option value="4">{t('中 18')}</option>
            <option value="5">{t('大 24')}</option>
            <option value="6">{t('特大 32')}</option>
          </select>

          <span className="doc-tool-sep" />

          <div className="doc-tool-group">
            <ToolButton label={t('加粗')} active={format.bold} onClick={() => applyCommand('bold')}>
              <Bold size={15} />
            </ToolButton>
            <ToolButton label={t('斜体')} active={format.italic} onClick={() => applyCommand('italic')}>
              <Italic size={15} />
            </ToolButton>
            <ToolButton
              label={t('下划线')}
              active={format.underline}
              onClick={() => applyCommand('underline')}
            >
              <Underline size={15} />
            </ToolButton>
            <ToolButton
              label={t('删除线')}
              active={format.strike}
              onClick={() => applyCommand('strikeThrough')}
            >
              <Strikethrough size={15} />
            </ToolButton>
          </div>

          <span className="doc-tool-sep" />

          <Dropdown
            className="doc-tool-btn doc-tool-drop"
            align="left"
            title={t('文字颜色')}
            trigger={
              <>
                <span className="doc-color-glyph">A</span>
                <ChevronDown size={10} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('文字颜色')}</div>
                <div className="doc-swatches">
                  {TEXT_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className="doc-swatch"
                      style={{ background: color.value }}
                      title={t(color.name)}
                      aria-label={t(color.name)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        applyCommand('foreColor', color.value)
                        close()
                      }}
                    />
                  ))}
                </div>
                <label className="doc-custom-color">
                  {t('自定义')}
                  <input
                    type="color"
                    defaultValue="#201e1a"
                    onChange={(event) => {
                      applyCommand('foreColor', event.target.value)
                      close()
                    }}
                  />
                </label>
              </>
            )}
          </Dropdown>

          <Dropdown
            className="doc-tool-btn doc-tool-drop"
            align="left"
            title={t('高亮')}
            trigger={
              <>
                <Highlighter size={15} />
                <ChevronDown size={10} />
              </>
            }
          >
            {(close) => (
              <>
                <div className="menu-label">{t('高亮')}</div>
                <div className="doc-swatches">
                  {HIGHLIGHTS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="doc-swatch"
                      style={{ background: color }}
                      aria-label={t('高亮颜色')}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        applyCommand('hiliteColor', color)
                        close()
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="menu-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    applyCommand('hiliteColor', 'transparent')
                    close()
                  }}
                >
                  <RemoveFormatting size={13} />
                  {t('清除高亮')}
                </button>
              </>
            )}
          </Dropdown>

          <span className="doc-tool-sep" />

          <div className="doc-tool-group">
            <ToolButton
              label={t('左对齐')}
              active={format.align === 'left'}
              onClick={() => applyCommand('justifyLeft')}
            >
              <AlignLeft size={15} />
            </ToolButton>
            <ToolButton
              label={t('居中')}
              active={format.align === 'center'}
              onClick={() => applyCommand('justifyCenter')}
            >
              <AlignCenter size={15} />
            </ToolButton>
            <ToolButton
              label={t('右对齐')}
              active={format.align === 'right'}
              onClick={() => applyCommand('justifyRight')}
            >
              <AlignRight size={15} />
            </ToolButton>
            <ToolButton
              label={t('两端对齐')}
              active={format.align === 'justify'}
              onClick={() => applyCommand('justifyFull')}
            >
              <AlignJustify size={15} />
            </ToolButton>
          </div>

          <span className="doc-tool-sep" />

          <div className="doc-tool-group">
            <ToolButton
              label={t('无序列表')}
              active={format.unordered}
              onClick={() => applyCommand('insertUnorderedList')}
            >
              <List size={15} />
            </ToolButton>
            <ToolButton
              label={t('有序列表')}
              active={format.ordered}
              onClick={() => applyCommand('insertOrderedList')}
            >
              <ListOrdered size={15} />
            </ToolButton>
            <ToolButton
              label={t('引用块')}
              active={format.block === 'blockquote'}
              onClick={() => applyCommand('formatBlock', format.block === 'blockquote' ? '<p>' : '<blockquote>')}
            >
              <Quote size={15} />
            </ToolButton>
          </div>

          <span className="doc-tool-sep" />

          <div className="doc-tool-group">
            <ToolButton label={t('插入链接')} onClick={openLinkDialog}>
              <Link2 size={15} />
            </ToolButton>
            <ToolButton label={t('插入图片')} onClick={() => imageRef.current?.click()}>
              <ImagePlus size={15} />
            </ToolButton>
            <ToolButton label={t('插入表格')} onClick={() => setTableOpen(true)}>
              <Table2 size={15} />
            </ToolButton>
            <ToolButton label={t('插入分隔线')} onClick={() => applyCommand('insertHorizontalRule')}>
              <Minus size={15} />
            </ToolButton>
          </div>

          <span className="doc-tool-sep" />

          <ToolButton
            label={t('清除格式')}
            onClick={() => {
              applyCommand('removeFormat')
              applyCommand('formatBlock', '<p>')
            }}
          >
            <RemoveFormatting size={15} />
          </ToolButton>

          <div className="doc-tool-spacer" />

          <button
            type="button"
            className="doc-ai-btn"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openAiTask()}
            title={t('打开 AI 任务窗口，处理当前文档')}
          >
            <Sparkles size={13} />
            AI
          </button>

          <Dropdown
            className="doc-export-btn"
            trigger={
              <>
                <Download size={14} />
                {t('导出')}
                <ChevronDown size={11} />
              </>
            }
          >
            {(close) => (
              <>
                {doc.sourceDocx && (
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      close()
                      exportSourceDocx()
                    }}
                  >
                    <FileType2 size={14} />
                    {sourceDirty || sourceUntracked ? t('导入时的原稿（.docx）') : t('原始 Word（.docx）')}
                  </button>
                )}
                <button
                  type="button"
                  className="menu-item"
                  disabled={exporting}
                  onClick={() => {
                    close()
                    void exportDocx()
                  }}
                >
                  <FileDown size={14} />
                  {exporting
                    ? t('正在生成 DOCX…')
                    : doc.sourceDocx
                      ? t('编辑版 Word（.docx）')
                      : t('Word 文档（.docx）')}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    exportHtml()
                  }}
                >
                  <Code2 size={14} />
                  {t('HTML 网页（.html）')}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close()
                    printPdf()
                  }}
                >
                  <Printer size={14} />
                  {t('打印为 PDF')}
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
                  {t('删除文档…')}
                </button>
              </>
            )}
          </Dropdown>
        </div>
        )}

        {view === 'source' && doc.sourceDocx ? (
          <div key="source" className="doc-canvas doc-canvas-source">
            <div className="doc-source-view">
              <header className="doc-source-head">
                <div className="doc-source-caption">
                  <strong>{t('原稿版式')}</strong>
                  <span>
                    {t('与 Word / WPS 打开效果一致，保留分页、页眉页脚与表格。需要修改内容时转为可编辑。')}
                  </span>
                </div>
                <div className="doc-source-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setView('edit')}>
                    <PenLine size={13} />
                    {t('转为可编辑')}
                  </button>
                  {sourceDirty || sourceUntracked ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void syncSourceFromEdits()}
                      disabled={syncingSource}
                    >
                      <RefreshCw size={13} className={syncingSource ? 'spin' : undefined} />
                      {syncingSource ? t('正在生成原稿…') : t('用当前内容更新原稿')}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={exportSourceDocx}>
                      <Download size={13} />
                      {t('下载原稿')}
                    </button>
                  )}
                </div>
              </header>
              {(sourceDirty || sourceUntracked) && (
                <div className="doc-source-dirty" role="status">
                  <span className="doc-source-dirty-dot" aria-hidden="true" />
                  <div className="doc-source-dirty-copy">
                    <strong>{sourceUntracked ? t('这是早期导入的原稿') : t('原稿是导入时的版本')}</strong>
                    <span>
                      {sourceUntracked
                        ? t(
                            '编辑内容已单独保存在本机。点击「用当前内容更新原稿」后，原稿预览与导出的 Word 会包含你的修改。',
                          )
                        : t('你的修改已保存在本机，并且重新打开时会直接进入编辑视图；原稿预览仍显示导入时的内容。')}
                    </span>
                  </div>
                  {sourceDirty && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView('edit')}>
                      {t('查看修改')}
                    </button>
                  )}
                </div>
              )}
              {sourceLoading && (
                <div className="doc-source-loading">
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  {t('正在排版原稿…')}
                </div>
              )}
              {sourceError && (
                <div className="doc-source-error">
                  {t('原稿渲染失败：{error}。可以切换回编辑视图继续修改。', { error: sourceError })}
                </div>
              )}
              <div ref={sourceBodyRef} className="doc-source-body" aria-label={t('Word 原稿预览')} />
              <div ref={sourceStyleRef} className="doc-source-styles" />
            </div>
          </div>
        ) : (
        <div key="edit" className="doc-canvas" ref={canvasRef}>
          <div className={cn('doc-page', doc.sourceDocx && 'is-imported')}>
            <header className="doc-page-head">
              <div className="doc-kicker">
                <span className="dot" />
                LOCAL DOCUMENT
                <span className="doc-kicker-date">{createdLabel}</span>
              </div>
              <input
                ref={titleInputRef}
                className="doc-title-input"
                value={title}
                placeholder={t('未命名文档')}
                aria-label={t('文档标题')}
                spellCheck={false}
                onChange={(event) => handleTitleChange(event.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    editorRef.current?.focus()
                  }
                }}
              />
              <div className="doc-meta">
                <span className="tabular">{t('{n} 字', { n: stats.words })}</span>
                <span className="doc-meta-dot">·</span>
                <span className="tabular">{t('{n} 字符', { n: stats.chars })}</span>
                <span className="spacer" />
                <span className="doc-meta-save">
                  <span className="dot dot-green" />
                  {t('自动保存到本机')}
                </span>
              </div>
              <div className="doc-title-rule" />
            </header>

            <div
              ref={editorRef}
              className="doc-body"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label={t('文档正文')}
              spellCheck={false}
              data-empty="false"
              data-placeholder={t('从这里开始写，内容会自动保存在本机…')}
              onInput={handleInput}
              onBlur={() => {
                if (commitTimer.current) {
                  window.clearTimeout(commitTimer.current)
                  commitTimer.current = undefined
                }
                commitNow()
              }}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault()
                  document.execCommand('insertText', false, '  ')
                  handleInput()
                }
              }}
            />
          </div>
          <div className="doc-canvas-foot">
            <span>{t('草稿保存在这台设备')}</span>
            <span className="doc-canvas-foot-sep" />
            <span>{t('选中文字可直接交给 AI 润色或续写')}</span>
          </div>
        </div>
        )}
      </div>

      {bubble && (
        <div
          className="doc-ai-bubble"
          style={{ top: bubble.top, left: bubble.left }}
          role="toolbar"
          aria-label={t('AI 文字操作')}
        >
          <span className="doc-ai-bubble-mark">
            <Sparkles size={12} />
          </span>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runAi('polish')}>
            {t('润色')}
          </button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runAi('summary')}>
            {t('总结')}
          </button>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runAi('continue')}>
            {t('续写')}
          </button>
        </div>
      )}

      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void insertImage(file)
          event.target.value = ''
        }}
      />

      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={t('插入链接')}
        description={t('选中的文字会变成链接；如果没有选中文字，将插入链接地址本身。')}
        width={440}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setLinkOpen(false)}>
              {t('取消')}
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmLink} disabled={!linkUrl.trim()}>
              {t('插入链接')}
            </button>
          </>
        }
      >
        <div className="field">
          <label className="field-label" htmlFor="doc-link-url">
            {t('链接地址')}
          </label>
          <input
            id="doc-link-url"
            className="input"
            value={linkUrl}
            autoFocus
            placeholder="https://example.com"
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                confirmLink()
              }
            }}
          />
        </div>
      </Modal>

      <Modal
        open={tableOpen}
        onClose={() => setTableOpen(false)}
        title={t('插入表格')}
        description={t('第一行会作为表头。插入后可直接在单元格里输入。')}
        width={420}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setTableOpen(false)}>
              {t('取消')}
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmTable}>
              {t('插入 {rows} × {cols}', {
                rows: clamp(Number(tableSize.rows) || 3, 1, 10),
                cols: clamp(Number(tableSize.cols) || 3, 1, 8),
              })}
            </button>
          </>
        }
      >
        <div className="doc-table-form">
          <div className="field">
            <label className="field-label" htmlFor="doc-table-rows">
              {t('行数')}
            </label>
            <input
              id="doc-table-rows"
              className="input"
              type="number"
              min={1}
              max={10}
              value={tableSize.rows}
              onChange={(event) => setTableSize((state) => ({ ...state, rows: Number(event.target.value) }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="doc-table-cols">
              {t('列数')}
            </label>
            <input
              id="doc-table-cols"
              className="input"
              type="number"
              min={1}
              max={8}
              value={tableSize.cols}
              onChange={(event) => setTableSize((state) => ({ ...state, cols: Number(event.target.value) }))}
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title={t('删除这份文档？')}
        description={t('《{title}》会从此设备移除，此操作无法撤销。建议先在「设置 · 数据」导出备份。', {
          title: title.trim() || t('未命名文档'),
        })}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          deleteFile('doc', doc.id)
          toast(t('文档已删除'), 'success')
        }}
      />
    </>
  )
}

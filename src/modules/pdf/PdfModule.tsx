import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  ClipboardCopy,
  Download,
  Droplets,
  FileDown,
  FileImage,
  FilePlus2,
  FileStack,
  FileText,
  Hash,
  ImagePlus,
  Loader2,
  Lock,
  Merge,
  MessageSquare,
  Minimize2,
  PenLine,
  Plus,
  RotateCcw,
  RotateCw,
  ScanText,
  Scissors,
  Sparkles,
  SquareStack,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AiContext } from '../../types'
import { registerAiContext } from '../../lib/aiContext'
import {
  addPdfPageNumbers,
  addPdfWatermark,
  compressPdf,
  createSamplePdf,
  exportPdfImages,
  extractPdfPages,
  extractPdfText,
  imagesToPdf,
  mergePdfs,
  naturalPages,
  ocrPdf,
  openPdf,
  pdfPagesToDocx,
  removePdfPages,
  rotatePdfPages,
  splitPdf,
  stampPdfImage,
  type PageNumberOptions,
  type PdfCompressResult,
  type PdfImagePlacement,
  type WatermarkOptions,
} from '../../lib/pdf'
import { NOTE_TONE_COLORS, noteDataUrl, type NoteTone } from '../../lib/pdfArt'
import { cn, downloadBlob, downloadBytes, downloadText, safeFilename, uid } from '../../lib/utils'
import { openFiles } from '../../lib/openFiles'
import { useUI } from '../../store/ui'
import { PdfPageThumb } from './PdfPageThumb'
import { SignatureStudio, type SignatureScope } from './SignatureStudio'

interface PdfItem {
  id: string
  name: string
  size: number
  bytes: Uint8Array
  pageCount: number
  doc: PDFDocumentProxy
}

interface ImageItem {
  id: string
  name: string
  size: number
  file: File
}

type ToolTab = 'pages' | 'signature' | 'watermark' | 'numbers' | 'compress' | 'convert' | 'ocr'

interface OcrRun {
  page: number
  pages: number
  status: string
  progress: number
}

const TOOL_TABS: Array<{ id: ToolTab; label: string; icon: typeof SquareStack }> = [
  { id: 'pages', label: '页面', icon: SquareStack },
  { id: 'signature', label: '签章', icon: PenLine },
  { id: 'watermark', label: '水印', icon: Droplets },
  { id: 'numbers', label: '页码', icon: Hash },
  { id: 'compress', label: '压缩', icon: Minimize2 },
  { id: 'convert', label: '转换', icon: ArrowLeftRight },
  { id: 'ocr', label: 'OCR', icon: ScanText },
]

const WATERMARK_COLORS = ['#c8442b', '#201e1a', '#7a7369']

const COMPRESS_PRESETS = [
  { id: 'screen', label: '屏幕阅读', dpi: 96, quality: 0.55, note: '邮件与快速预览' },
  { id: 'balanced', label: '均衡', dpi: 144, quality: 0.68, note: '日常归档' },
  { id: 'print', label: '高清', dpi: 200, quality: 0.8, note: '打印与合同' },
] as const

type CompressPreset = (typeof COMPRESS_PRESETS)[number]['id']

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '')
}

async function zipBytes(entries: Array<{ name: string; bytes: Uint8Array }>): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  entries.forEach((entry) => zip.file(entry.name, entry.bytes))
  return zip.generateAsync({ type: 'blob' })
}

export function PdfModule() {
  const toast = useUI((s) => s.toast)
  const openAiTask = useUI((s) => s.openAiTask)

  const [files, setFiles] = useState<PdfItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [images, setImages] = useState<ImageItem[]>([])
  const [selection, setSelection] = useState<number[]>([])
  const [anchor, setAnchor] = useState<number | null>(null)
  const [tab, setTab] = useState<ToolTab>('pages')
  const [loading, setLoading] = useState<string | null>(null)
  const [task, setTask] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const [wm, setWm] = useState<WatermarkOptions>({
    text: '内部资料 · 请勿外传',
    size: 36,
    opacity: 0.16,
    angle: -30,
    color: '#c8442b',
    tiled: true,
  })
  const [pn, setPn] = useState<PageNumberOptions>({
    position: 'bottom-center',
    start: 1,
    size: 10,
    skipFirst: false,
    template: 'fraction',
  })
  const [splitEvery, setSplitEvery] = useState(1)
  const [imgFormat, setImgFormat] = useState<'png' | 'jpeg'>('png')
  const [imgScale, setImgScale] = useState(2)
  const [imagePageSize, setImagePageSize] = useState<'a4' | 'fit'>('a4')
  const [convertText, setConvertText] = useState<{ name: string; text: string } | null>(null)
  const [ocrLang, setOcrLang] = useState<'chi_sim+eng' | 'chi_sim' | 'eng'>('chi_sim+eng')
  const [preferLayer, setPreferLayer] = useState(true)
  const [ocrRun, setOcrRun] = useState<OcrRun | null>(null)
  const [ocrText, setOcrText] = useState<{ name: string; text: string } | null>(null)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteAuthor, setNoteAuthor] = useState('')
  const [noteTone, setNoteTone] = useState<NoteTone>('accent')
  const [notePlace, setNotePlace] = useState<PdfImagePlacement>('top-right')
  const [compressPreset, setCompressPreset] = useState<CompressPreset>('balanced')
  const [compressQuality, setCompressQuality] = useState(0.68)
  const [compressGrayscale, setCompressGrayscale] = useState(false)
  const [compressPreserveText, setCompressPreserveText] = useState(true)
  const [compressProgress, setCompressProgress] = useState<{ done: number; total: number } | null>(null)
  const [compressResult, setCompressResult] = useState<(PdfCompressResult & { name: string }) | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const dragDepthRef = useRef(0)
  const ocrCancelRef = useRef(false)
  const contextRef = useRef<AiContext | null>(null)
  const extractedRef = useRef(new Map<string, string>())

  const active = files.find((file) => file.id === activeId) ?? files[0] ?? null
  const busy = Boolean(task || ocrRun)
  const scopePages = useMemo(
    () => (selection.length ? selection : active ? naturalPages(active.pageCount) : []),
    [selection, active],
  )
  const scopeLabel = active
    ? selection.length
      ? `已选 ${selection.length} 页`
      : `全部 ${active.pageCount} 页`
    : ''
  const totalPages = files.reduce((sum, file) => sum + file.pageCount, 0)
  const notePreview = useMemo(
    () => (noteText.trim() ? noteDataUrl({ text: noteText, author: noteAuthor, tone: noteTone }).dataUrl : null),
    [noteText, noteAuthor, noteTone],
  )

  useEffect(() => registerAiContext('pdf', () => contextRef.current), [])

  useEffect(() => {
    setCompressResult(null)
  }, [activeId])

  useEffect(() => {
    if (!active) {
      contextRef.current = null
      return
    }
    const title = `${active.name} · ${active.pageCount} 页`
    const cached = extractedRef.current.get(active.id)
    contextRef.current = { kind: 'pdf', title, text: cached ?? '正在本地提取文本…' }
    if (cached !== undefined) return
    let cancelled = false
    const pages = naturalPages(active.pageCount).slice(0, 30)
    extractPdfText(active.doc, pages)
      .then((list) => {
        const text = list
          .map((page) => page.text.trim())
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 8000)
        extractedRef.current.set(active.id, text)
        if (!cancelled) {
          contextRef.current = {
            kind: 'pdf',
            title,
            text: text || '（这份 PDF 没有可提取的文字层，可在 OCR 面板做本地识别。）',
          }
        }
      })
      .catch(() => {
        if (!cancelled) contextRef.current = { kind: 'pdf', title, text: '（无法提取 PDF 文本层）' }
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const runTask = async (label: string, fn: () => Promise<void>) => {
    if (busy) return
    setTask(label)
    try {
      await fn()
    } catch (error) {
      toast(error instanceof Error ? error.message : '处理失败，请重试', 'error')
    } finally {
      setTask(null)
    }
  }

  const downloadPdf = (bytes: Uint8Array, filename: string) => {
    downloadBytes(bytes, filename, 'application/pdf')
    toast(`已生成 ${filename}`, 'success')
  }

  const addFiles = async (input: FileList | File[] | null) => {
    if (!input) return
    const list = Array.from(input)
    const pdfs = list.filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
    const pictures = list.filter((file) => file.type.startsWith('image/'))
    if (pictures.length) {
      setImages((prev) => [
        ...prev,
        ...pictures.map((file) => ({ id: uid(), name: file.name, size: file.size, file })),
      ])
      setTab('convert')
      toast(`已加入 ${pictures.length} 张图片`, 'success')
    }
    if (!pdfs.length) {
      if (!pictures.length) toast('请选择 PDF 或图片文件', 'error')
      return
    }
    for (const file of pdfs) {
      if (file.size > 80 * 1024 * 1024) {
        toast(`${file.name} 超过 80MB，暂不处理`, 'error')
        continue
      }
      setLoading(`正在打开 ${file.name}`)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const { doc, pageCount } = await openPdf(bytes)
        const item: PdfItem = {
          id: uid(),
          name: file.name,
          size: file.size,
          bytes,
          pageCount,
          doc,
        }
        setFiles((prev) => [...prev, item])
        setActiveId((current) => current ?? item.id)
        setSelection([])
        setAnchor(null)
        setConvertText(null)
        setOcrText(null)
        toast(`已打开 ${file.name}`, 'success')
      } catch (error) {
        const encrypted = error instanceof Error && /password/i.test(`${error.name}${error.message}`)
        toast(encrypted ? `${file.name} 已加密，暂不支持密码 PDF` : `${file.name} 无法解析，可能已损坏`, 'error')
      }
    }
    setLoading(null)
  }

  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles

  useEffect(() => {
    const onOpen = (event: Event) => {
      const incoming = (event as CustomEvent<File[]>).detail
      if (incoming?.length) void addFilesRef.current(incoming)
    }
    window.addEventListener('ruodao:open-pdf', onOpen)
    return () => window.removeEventListener('ruodao:open-pdf', onOpen)
  }, [])

  const openPicker = () => fileInputRef.current?.click()

  const loadSample = async () => {
    if (loading) return
    setLoading('正在生成示例 PDF')
    try {
      const bytes = await createSamplePdf()
      const { doc, pageCount } = await openPdf(bytes)
      const item: PdfItem = {
        id: uid(),
        name: '若道办公 · 示例合同.pdf',
        size: bytes.byteLength,
        bytes,
        pageCount,
        doc,
      }
      setFiles((prev) => [...prev, item])
      setActiveId(item.id)
      setSelection([])
      setAnchor(null)
      setTab('pages')
      toast('示例 PDF 已载入', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '示例生成失败', 'error')
    } finally {
      setLoading(null)
    }
  }

  const selectFile = (id: string) => {
    setActiveId(id)
    setSelection([])
    setAnchor(null)
    setConvertText(null)
    setOcrText(null)
    setTab('pages')
  }

  const removeFile = (id: string) => {
    const target = files.find((file) => file.id === id)
    const next = files.filter((file) => file.id !== id)
    setFiles(next)
    if (activeId === id) setActiveId(next[0]?.id ?? null)
    setSelection([])
    setAnchor(null)
    setConvertText(null)
    setOcrText(null)
    if (target) void target.doc.destroy().catch(() => {})
  }

  const moveFile = (id: string, delta: number) => {
    setFiles((prev) => {
      const index = prev.findIndex((file) => file.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const togglePage = (page: number, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (!active) return
    if (event.shiftKey && anchor !== null) {
      const start = Math.min(anchor, page)
      const end = Math.max(anchor, page)
      const range = Array.from({ length: end - start + 1 }, (_, index) => start + index)
      setSelection((prev) => Array.from(new Set([...prev, ...range])).sort((a, b) => a - b))
      return
    }
    if (event.ctrlKey || event.metaKey) {
      setSelection((prev) =>
        prev.includes(page) ? prev.filter((item) => item !== page) : [...prev, page].sort((a, b) => a - b),
      )
      setAnchor(page)
      return
    }
    setSelection([page])
    setAnchor(page)
  }

  const selectAll = () => {
    if (!active) return
    setSelection(naturalPages(active.pageCount))
  }

  const invertSelection = () => {
    if (!active) return
    setSelection(naturalPages(active.pageCount).filter((page) => !selection.includes(page)))
  }

  const openAi = (text?: string, prompt?: string) => {
    if (text && active) {
      contextRef.current = {
        kind: 'pdf',
        title: `${active.name} · 文本`,
        text: text.slice(0, 12000),
      }
    }
    openAiTask(prompt)
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('已复制到剪贴板', 'success')
    } catch {
      toast('复制失败，请手动选择文本', 'error')
    }
  }

  const handleMerge = () => {
    if (files.length < 2) {
      toast('至少添加两个 PDF 才能合并', 'info')
      return
    }
    void runTask('合并 PDF', async () => {
      const bytes = await mergePdfs(files.map((file) => file.bytes))
      downloadPdf(bytes, safeFilename(`${baseName(files[0].name)}_合并`, 'pdf'))
    })
  }

  const handleExtract = () => {
    if (!active || !selection.length) return
    void runTask('提取页面', async () => {
      const bytes = await extractPdfPages(active.bytes, selection)
      downloadPdf(bytes, safeFilename(`${baseName(active.name)}_提取`, 'pdf'))
    })
  }

  const handleDeletePages = () => {
    if (!active || !selection.length) return
    void runTask('删除页面', async () => {
      const bytes = await removePdfPages(active.bytes, selection)
      downloadPdf(bytes, safeFilename(`${baseName(active.name)}_删页`, 'pdf'))
    })
  }

  const handleRotate = (delta: number) => {
    if (!active) return
    void runTask(`旋转 ${Math.abs(delta)}°`, async () => {
      const bytes = await rotatePdfPages(active.bytes, selection.length ? selection : null, delta)
      downloadPdf(bytes, safeFilename(`${baseName(active.name)}_旋转`, 'pdf'))
    })
  }

  const handleSplit = () => {
    if (!active) return
    void runTask('拆分 PDF', async () => {
      const chunks = await splitPdf(active.bytes, scopePages, splitEvery)
      if (!chunks.length) throw new Error('没有可拆分的页面')
      const base = baseName(active.name)
      if (chunks.length === 1) {
        downloadPdf(chunks[0].bytes, safeFilename(`${base}_${chunks[0].label}`, 'pdf'))
        return
      }
      const blob = await zipBytes(
        chunks.map((chunk) => ({
          name: safeFilename(`${base}_${chunk.label}`, 'pdf'),
          bytes: chunk.bytes,
        })),
      )
      downloadBlob(blob, safeFilename(`${base}_拆分`, 'zip'))
      toast(`已拆分为 ${chunks.length} 个文件`, 'success')
    })
  }

  const handleWatermark = () => {
    if (!active) return
    if (!wm.text.trim()) {
      toast('请先填写水印文字', 'info')
      return
    }
    void runTask('添加水印', async () => {
      const bytes = await addPdfWatermark(active.bytes, selection.length ? selection : null, {
        ...wm,
        text: wm.text.trim(),
      })
      downloadPdf(bytes, safeFilename(`${baseName(active.name)}_水印`, 'pdf'))
    })
  }

  const handlePageNumbers = () => {
    if (!active) return
    void runTask('添加页码', async () => {
      const bytes = await addPdfPageNumbers(active.bytes, selection.length ? selection : null, pn)
      downloadPdf(bytes, safeFilename(`${baseName(active.name)}_页码`, 'pdf'))
    })
  }

  const handleSignatureApply = (payload: {
    dataUrl: string
    place: PdfImagePlacement
    widthRatio: number
    opacity: number
    scope: SignatureScope
  }) => {
    if (!active) return
    const pages =
      payload.scope === 'all'
        ? null
        : payload.scope === 'last'
          ? [active.pageCount]
          : payload.scope === 'first'
            ? [1]
            : selection.length
              ? selection
              : [active.pageCount]
    void runTask('写入签名', async () => {
      const bytes = await stampPdfImage(active.bytes, pages, payload.dataUrl, {
        place: payload.place,
        widthRatio: payload.widthRatio,
        opacity: payload.opacity,
      })
      downloadPdf(bytes, safeFilename(`${baseName(active.name)}_签署`, 'pdf'))
    })
  }

  const handleAddNote = () => {
    if (!active) return
    if (!noteText.trim()) {
      toast('请先填写批注内容', 'info')
      return
    }
    const art = noteDataUrl({ text: noteText.trim(), author: noteAuthor, tone: noteTone })
    const pages = selection.length ? selection : [1]
    void runTask('写入批注', async () => {
      const bytes = await stampPdfImage(active.bytes, pages, art.dataUrl, {
        place: notePlace,
        widthRatio: 0.52,
        opacity: 0.98,
      })
      downloadPdf(bytes, safeFilename(`${baseName(active.name)}_批注`, 'pdf'))
    })
  }

  const handleCompress = () => {
    if (!active) return
    const preset = COMPRESS_PRESETS.find((item) => item.id === compressPreset) ?? COMPRESS_PRESETS[1]
    void runTask('压缩 PDF', async () => {
      setCompressProgress({ done: 0, total: scopePages.length })
      try {
        const result = await compressPdf(
          active.bytes,
          active.doc,
          selection.length ? selection : null,
          {
            dpi: preset.dpi,
            quality: compressQuality,
            grayscale: compressGrayscale,
            preserveText: compressPreserveText,
          },
          (done, total) => setCompressProgress({ done, total }),
        )
        setCompressResult({ ...result, name: safeFilename(`${baseName(active.name)}_压缩`, 'pdf') })
        toast(`压缩完成：${formatBytes(result.before)} → ${formatBytes(result.after)}`, 'success')
      } finally {
        setCompressProgress(null)
      }
    })
  }

  const handlePdfToWord = () => {
    if (!active) return
    void runTask('转换为 Word', async () => {
      const pages = await extractPdfText(active.doc, scopePages)
      const usable = pages.filter((page) => page.text.trim())
      if (!usable.length) throw new Error('没有可提取的文字层，请先对扫描页做 OCR')
      const blob = await pdfPagesToDocx(baseName(active.name), usable, usable.length > 1)
      downloadBlob(blob, safeFilename(`${baseName(active.name)}_文字版`, 'docx'))
      toast(`已转换 ${usable.length} 页文字为 Word`, 'success')
    })
  }

  const handleExportImages = () => {
    if (!active) return
    void runTask('导出图片', async () => {
      const results = await exportPdfImages(active.doc, scopePages, imgScale, imgFormat)
      if (!results.length) throw new Error('没有可导出的页面')
      const ext = imgFormat === 'png' ? 'png' : 'jpg'
      const base = baseName(active.name)
      if (results.length === 1) {
        downloadBlob(results[0].blob, safeFilename(`${base}_第${results[0].page}页`, ext))
      } else {
        const entries: Array<{ name: string; bytes: Uint8Array }> = []
        for (const result of results) {
          entries.push({
            name: `${base}_第${String(result.page).padStart(2, '0')}页.${ext}`,
            bytes: new Uint8Array(await result.blob.arrayBuffer()),
          })
        }
        downloadBlob(await zipBytes(entries), safeFilename(`${base}_图片`, 'zip'))
      }
      toast(`已导出 ${results.length} 张图片`, 'success')
    })
  }

  const handleExtractText = () => {
    if (!active) return
    void runTask('提取文本', async () => {
      const pages = await extractPdfText(active.doc, scopePages)
      const text = pages
        .map((page) => {
          const body = page.text.trim()
          if (!body) return `— 第 ${page.page} 页 · 无文字层 —`
          return pages.length > 1 ? `— 第 ${page.page} 页 —\n${body}` : body
        })
        .join('\n\n')
        .trim()
      setConvertText({ name: active.name, text })
      if (text) {
        extractedRef.current.set(active.id, text.slice(0, 8000))
        contextRef.current = { kind: 'pdf', title: `${active.name} · 文本`, text: text.slice(0, 12000) }
        toast('文本已提取', 'success')
      } else {
        toast('没有文字层，请改用 OCR 识别', 'info')
      }
    })
  }

  const handleImagesToPdf = () => {
    if (!images.length) return
    void runTask('生成 PDF', async () => {
      const bytes = await imagesToPdf(images.map((item) => item.file), imagePageSize)
      downloadPdf(bytes, safeFilename(`图片合集_${images.length}张`, 'pdf'))
    })
  }

  const startOcr = async () => {
    if (!active || busy) return
    ocrCancelRef.current = false
    setOcrText(null)
    setOcrRun({ page: 0, pages: scopePages.length, status: '准备中', progress: 0 })
    try {
      const results = await ocrPdf(
        active.doc,
        scopePages,
        ocrLang,
        (info) => setOcrRun(info),
        () => ocrCancelRef.current,
        preferLayer,
      )
      const text = results
        .map((item) => `— 第 ${item.page} 页${item.ocr ? ' · OCR' : ''} —\n${item.text}`)
        .join('\n\n')
        .trim()
      setOcrText({ name: active.name, text })
      extractedRef.current.set(active.id, text.slice(0, 8000))
      contextRef.current = { kind: 'pdf', title: `${active.name} · OCR`, text: text.slice(0, 12000) }
      toast(results.some((item) => item.ocr) ? 'OCR 识别完成' : '已读取 PDF 文字层', 'success')
    } catch (error) {
      if (error instanceof Error && error.message.includes('已取消')) toast('已取消识别', 'info')
      else toast(error instanceof Error ? error.message : 'OCR 识别失败', 'error')
    } finally {
      setOcrRun(null)
    }
  }

  const cancelOcr = () => {
    ocrCancelRef.current = true
    setOcrRun((prev) => (prev ? { ...prev, status: '正在取消…' } : prev))
  }

  const ocrPercent = ocrRun
    ? Math.min(100, Math.round(((Math.max(0, ocrRun.page - 1) + ocrRun.progress) / Math.max(1, ocrRun.pages)) * 100))
    : 0

  return (
    <div
      className={cn('pdf-shell', dragOver && 'is-dragging')}
      data-file-drop="local"
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepthRef.current += 1
        setDragOver(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDragOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepthRef.current = 0
        setDragOver(false)
        const all = Array.from(event.dataTransfer.files)
        const local = all.filter(
          (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name) || file.type.startsWith('image/'),
        )
        const rest = all.filter((file) => !local.includes(file))
        if (local.length) void addFiles(local)
        if (rest.length) void openFiles(rest)
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp"
        onChange={(event) => {
          const input = event.currentTarget
          void addFiles(input.files).finally(() => {
            input.value = ''
          })
        }}
      />

      <aside className="pdf-side">
        <header className="pdf-side-head">
          <div>
            <div className="pdf-side-title">
              PDF 工具箱
              <span className="pdf-side-count">{files.length}</span>
            </div>
            <p className="pdf-side-sub">离线处理 · 文件不上传</p>
          </div>
          <button type="button" className="icon-btn" onClick={openPicker} title="添加文件" aria-label="添加文件">
            <Plus size={17} />
          </button>
        </header>

        <button type="button" className="pdf-import" onClick={openPicker}>
          <UploadCloud size={15} />
          导入 PDF 或图片
        </button>

        <div className="pdf-file-list">
          {files.map((file, index) => (
            <div key={file.id} className={cn('pdf-file', file.id === active?.id && 'active')}>
              <button type="button" className="pdf-file-main" onClick={() => selectFile(file.id)}>
                <span className="pdf-file-icon">
                  <FileText size={15} />
                </span>
                <span className="pdf-file-body">
                  <span className="pdf-file-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="pdf-file-meta">
                    {file.pageCount} 页 · {formatBytes(file.size)}
                  </span>
                </span>
              </button>
              <div className="pdf-file-tools">
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  title="上移"
                  aria-label={`上移 ${file.name}`}
                  disabled={index === 0}
                  onClick={() => moveFile(file.id, -1)}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  title="下移"
                  aria-label={`下移 ${file.name}`}
                  disabled={index === files.length - 1}
                  onClick={() => moveFile(file.id, 1)}
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm pdf-file-remove"
                  title="移除"
                  aria-label={`移除 ${file.name}`}
                  onClick={() => removeFile(file.id)}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ))}
          {images.length ? (
            <button
              type="button"
              className="pdf-images-chip"
              onClick={() => setTab('convert')}
              title="查看图片队列"
            >
              <ImagePlus size={13} />
              {images.length} 张图片待转换
            </button>
          ) : null}
          {!files.length && !loading ? (
            <div className="pdf-side-empty">
              <FileStack size={18} />
              <span>队列是空的</span>
              <small>PDF 只在当前页面内处理</small>
            </div>
          ) : null}
          {loading ? (
            <div className="pdf-side-loading">
              <Loader2 size={13} className="spin" />
              <span>{loading}</span>
            </div>
          ) : null}
        </div>

        <footer className="pdf-side-foot">
          <Lock size={12} />
          <span>关闭页面即清空内存中的文件</span>
        </footer>
      </aside>

      <main className="pdf-main">
        {!active ? (
          <div className="pdf-empty">
            <div className="pdf-empty-card">
              <span className="pdf-empty-mark">
                <FileStack size={28} />
              </span>
              <p className="pdf-empty-eyebrow">LOCAL PDF WORKBENCH</p>
              <h1>PDF 工具箱</h1>
              <p className="pdf-empty-desc">
                合并、拆分、水印、签章、批注、压缩、OCR 与格式转换，全部在本地完成。没有上传队列，没有水印费用，页数也不设上限。
              </p>
              <div className="pdf-empty-actions">
                <button type="button" className="btn btn-primary btn-lg" onClick={openPicker}>
                  <Plus size={16} />
                  选择 PDF
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-lg"
                  onClick={() => void loadSample()}
                  disabled={Boolean(loading)}
                >
                  {loading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                  载入示例
                </button>
              </div>
              <div className="pdf-empty-features">
                <span>
                  <SquareStack size={13} /> 合并与拆分
                </span>
                <span>
                  <PenLine size={13} /> 电子签章
                </span>
                <span>
                  <ScanText size={13} /> 离线 OCR
                </span>
                <span>
                  <Minimize2 size={13} /> 智能压缩
                </span>
                <span>
                  <FileImage size={13} /> 图片互转
                </span>
              </div>
              <p className="pdf-empty-note">
                <Lock size={12} />
                无账号 · 无上传 · 关闭页面即清空
              </p>
              <div className="pdf-empty-drop">
                <UploadCloud size={14} />
                也可以把 PDF 或图片直接拖进来
              </div>
            </div>
          </div>
        ) : (
          <>
            <header className="pdf-head">
              <div className="pdf-head-info">
                <div className="pdf-head-eyebrow">
                  <Lock size={11} />
                  本地处理 · 文件不上传
                </div>
                <h1 className="pdf-head-title" title={active.name}>
                  {active.name}
                </h1>
                <div className="pdf-head-meta">
                  {active.pageCount} 页 · {formatBytes(active.size)}
                  {files.length > 1 ? ` · 队列共 ${files.length} 个文件` : ''}
                </div>
              </div>
              <div className="pdf-head-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openAi()}>
                  <Sparkles size={14} />
                  AI 任务
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={openPicker}>
                  <Plus size={14} />
                  添加
                </button>
              </div>
            </header>

            <div className="pdf-body">
              <section className="pdf-gallery">
                <div className="pdf-gallery-bar">
                  <div className="pdf-scope">
                    <strong>{scopeLabel}</strong>
                    <span>{selection.length ? `共 ${active.pageCount} 页` : '未选择时处理全部页面'}</span>
                  </div>
                  <div className="pdf-scope-actions">
                    <span className="pdf-select-hint">Shift 连选 · Ctrl 点选</span>
                    <button type="button" onClick={selectAll}>
                      全选
                    </button>
                    <button type="button" onClick={invertSelection}>
                      反选
                    </button>
                    <button type="button" onClick={() => setSelection([])} disabled={!selection.length}>
                      清除
                    </button>
                  </div>
                </div>
                <div className="pdf-pages" ref={pagesRef}>
                  {naturalPages(active.pageCount).map((page) => (
                    <PdfPageThumb
                      key={`${active.id}:${page}`}
                      doc={active.doc}
                      pageNumber={page}
                      selected={selection.includes(page)}
                      onToggle={togglePage}
                      rootRef={pagesRef}
                    />
                  ))}
                </div>
              </section>

              <aside className="pdf-tools">
                <div className="pdf-tools-head">
                  <span>工具</span>
                  <span className="pdf-tools-scope">{scopeLabel}</span>
                </div>
                <div className="pdf-tools-tabs" role="tablist" aria-label="PDF 工具">
                  {TOOL_TABS.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.id}
                        className={cn('pdf-tool-tab', tab === item.id && 'active')}
                        onClick={() => setTab(item.id)}
                      >
                        <Icon size={14} />
                        <span>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="pdf-tools-body">
                  {task ? (
                    <div className="pdf-task">
                      <Loader2 size={14} className="spin" />
                      <span>{task}…</span>
                    </div>
                  ) : null}

                  {tab === 'pages' ? (
                    <div className="pdf-tool">
                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">页面操作</div>
                        <div className="pdf-btn-grid">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleRotate(90)}
                            disabled={busy}
                          >
                            <RotateCw size={13} />
                            顺时针 90°
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleRotate(-90)}
                            disabled={busy}
                          >
                            <RotateCcw size={13} />
                            逆时针 90°
                          </button>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm btn-block"
                          onClick={() => handleRotate(180)}
                          disabled={busy}
                        >
                          翻转 180°
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm btn-block"
                          onClick={handleDeletePages}
                          disabled={!selection.length || selection.length >= active.pageCount || busy}
                        >
                          <Trash2 size={13} />
                          删除所选页面
                        </button>
                        <p className="hint">旋转会作用于{selection.length ? '所选页面' : '全部页面'}；删除前请先点选页面。</p>
                      </div>

                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">提取与拆分</div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-block"
                          onClick={handleExtract}
                          disabled={!selection.length || busy}
                        >
                          <Scissors size={13} />
                          提取所选页为新 PDF
                        </button>
                        <div className="pdf-split-row">
                          <span>每</span>
                          <input
                            className="input pdf-num"
                            type="number"
                            min={1}
                            max={100}
                            value={splitEvery}
                            aria-label="每份页数"
                            onChange={(event) =>
                              setSplitEvery(Math.min(100, Math.max(1, Number(event.target.value) || 1)))
                            }
                          />
                          <span>页一份</span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={handleSplit}
                            disabled={busy}
                          >
                            拆分
                          </button>
                        </div>
                        <p className="hint">
                          {selection.length ? '按所选页拆分。' : '未选择时按全部页面拆分。'}多份结果会打包为 ZIP。
                        </p>
                      </div>

                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">合并队列</div>
                        <p className="hint">
                          {files.length} 个文件 · 共 {totalPages} 页。按左侧顺序合并，可用箭头调整。
                        </p>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-block"
                          onClick={handleMerge}
                          disabled={files.length < 2 || busy}
                        >
                          <Merge size={13} />
                          合并为 PDF
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {tab === 'signature' ? (
                    <div className="pdf-tool">
                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">电子签名台</div>
                        <div className="pdf-sign-cta">
                          <span className="pdf-sign-badge">
                            <PenLine size={18} />
                          </span>
                          <div>
                            <strong>手写 · 键入 · 上传 · 电子印章</strong>
                            <p>画板与印章均在本地渲染，可注明签署人与日期，支持调整尺寸和浓度。</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-block"
                          onClick={() => setSignatureOpen(true)}
                          disabled={busy}
                        >
                          <PenLine size={13} />
                          打开签名台
                        </button>
                        <p className="hint">
                          {selection.length ? `当前已选 ${selection.length} 页，` : ''}
                          签署合同通常落在最后一页；印章可批量盖到全部页面。
                        </p>
                      </div>

                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">页边批注</div>
                        <textarea
                          className="textarea pdf-note-input"
                          value={noteText}
                          maxLength={160}
                          placeholder="例如：第 3 条付款节点需法务复核。"
                          aria-label="批注内容"
                          onChange={(event) => setNoteText(event.target.value)}
                        />
                        <div className="pdf-note-row">
                          <div className="pdf-note-tones" aria-label="批注色">
                            {(Object.keys(NOTE_TONE_COLORS) as NoteTone[]).map((tone) => (
                              <button
                                key={tone}
                                type="button"
                                className={cn('pdf-swatch', noteTone === tone && 'active')}
                                style={{ background: NOTE_TONE_COLORS[tone] }}
                                title={tone}
                                aria-label={`批注色 ${tone}`}
                                onClick={() => setNoteTone(tone)}
                              />
                            ))}
                          </div>
                          <select
                            className="select pdf-note-place"
                            value={notePlace}
                            aria-label="批注位置"
                            onChange={(event) => setNotePlace(event.target.value as PdfImagePlacement)}
                          >
                            <option value="top-right">右上角</option>
                            <option value="bottom-right">右下角</option>
                            <option value="top-left">左上角</option>
                            <option value="bottom-left">左下角</option>
                          </select>
                        </div>
                        <input
                          className="input"
                          value={noteAuthor}
                          maxLength={16}
                          placeholder="批注人（可留空）"
                          onChange={(event) => setNoteAuthor(event.target.value)}
                        />
                        {notePreview ? (
                          <div className="pdf-note-preview">
                            <img src={notePreview} alt="批注预览" />
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm btn-block"
                          onClick={handleAddNote}
                          disabled={busy || !noteText.trim()}
                        >
                          <MessageSquare size={13} />
                          写入批注 · {selection.length ? `所选 ${selection.length} 页` : '第 1 页'}
                        </button>
                        <p className="hint">批注作为独立图层贴在页边，不修改原文内容。写入前请保留原件。</p>
                      </div>
                    </div>
                  ) : null}

                  {tab === 'watermark' ? (
                    <div className="pdf-tool">
                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">水印文字</div>
                        <input
                          className="input"
                          value={wm.text}
                          maxLength={40}
                          placeholder="例如：内部资料"
                          onChange={(event) => setWm((prev) => ({ ...prev, text: event.target.value }))}
                        />
                        <div className="pdf-wm-preview" aria-hidden>
                          {Array.from({ length: 8 }).map((_, index) => (
                            <span
                              key={index}
                              style={{
                                color: wm.color,
                                opacity: Math.max(0.12, wm.opacity),
                                transform: `rotate(${wm.angle}deg)`,
                              }}
                            >
                              {wm.text.trim() || '水印'}
                            </span>
                          ))}
                        </div>
                        <label className="pdf-range">
                          <span>字号</span>
                          <input
                            type="range"
                            min={14}
                            max={72}
                            value={wm.size}
                            onChange={(event) => setWm((prev) => ({ ...prev, size: Number(event.target.value) }))}
                          />
                          <em>{wm.size}pt</em>
                        </label>
                        <label className="pdf-range">
                          <span>透明度</span>
                          <input
                            type="range"
                            min={5}
                            max={50}
                            value={Math.round(wm.opacity * 100)}
                            onChange={(event) =>
                              setWm((prev) => ({ ...prev, opacity: Number(event.target.value) / 100 }))
                            }
                          />
                          <em>{Math.round(wm.opacity * 100)}%</em>
                        </label>
                        <label className="pdf-range">
                          <span>角度</span>
                          <input
                            type="range"
                            min={-60}
                            max={60}
                            step={5}
                            value={wm.angle}
                            onChange={(event) => setWm((prev) => ({ ...prev, angle: Number(event.target.value) }))}
                          />
                          <em>{wm.angle}°</em>
                        </label>
                        <div className="pdf-color-row">
                          <span>颜色</span>
                          {WATERMARK_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={cn('pdf-swatch', wm.color === color && 'active')}
                              style={{ background: color }}
                              title={color}
                              aria-label={`水印颜色 ${color}`}
                              onClick={() => setWm((prev) => ({ ...prev, color }))}
                            />
                          ))}
                          <label className="pdf-check">
                            <input
                              type="checkbox"
                              checked={wm.tiled}
                              onChange={(event) => setWm((prev) => ({ ...prev, tiled: event.target.checked }))}
                            />
                            铺满页面
                          </label>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-block"
                          onClick={handleWatermark}
                          disabled={busy}
                        >
                          <Droplets size={13} />
                          添加水印 · {scopeLabel}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {tab === 'numbers' ? (
                    <div className="pdf-tool">
                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">页码</div>
                        <div className="field">
                          <label className="field-label" htmlFor="pn-position">
                            位置
                          </label>
                          <select
                            id="pn-position"
                            className="select"
                            value={pn.position}
                            onChange={(event) =>
                              setPn((prev) => ({ ...prev, position: event.target.value as PageNumberOptions['position'] }))
                            }
                          >
                            <option value="bottom-center">底部居中</option>
                            <option value="bottom-right">底部靠右</option>
                            <option value="bottom-left">底部靠左</option>
                            <option value="top-center">顶部居中</option>
                          </select>
                        </div>
                        <div className="field">
                          <label className="field-label" htmlFor="pn-template">
                            样式
                          </label>
                          <select
                            id="pn-template"
                            className="select"
                            value={pn.template}
                            onChange={(event) =>
                              setPn((prev) => ({ ...prev, template: event.target.value as PageNumberOptions['template'] }))
                            }
                          >
                            <option value="fraction">1 / 12</option>
                            <option value="plain">1</option>
                          </select>
                        </div>
                        <div className="pdf-inline">
                          <label className="field">
                            <span className="field-label">起始页码</span>
                            <input
                              className="input pdf-num"
                              type="number"
                              min={0}
                              max={9999}
                              value={pn.start}
                              onChange={(event) =>
                                setPn((prev) => ({ ...prev, start: Math.max(0, Number(event.target.value) || 0) }))
                              }
                            />
                          </label>
                          <label className="field">
                            <span className="field-label">字号</span>
                            <input
                              className="input pdf-num"
                              type="number"
                              min={7}
                              max={24}
                              value={pn.size}
                              onChange={(event) =>
                                setPn((prev) => ({ ...prev, size: Math.min(24, Math.max(7, Number(event.target.value) || 10)) }))
                              }
                            />
                          </label>
                        </div>
                        <label className="pdf-check">
                          <input
                            type="checkbox"
                            checked={pn.skipFirst}
                            onChange={(event) => setPn((prev) => ({ ...prev, skipFirst: event.target.checked }))}
                          />
                          首页不显示页码
                        </label>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-block"
                          onClick={handlePageNumbers}
                          disabled={busy}
                        >
                          <Hash size={13} />
                          添加页码 · {scopeLabel}
                        </button>
                        <p className="hint">页码使用内嵌标准字体绘制，不依赖网络或系统字体。</p>
                      </div>
                    </div>
                  ) : null}

                  {tab === 'compress' ? (
                    <div className="pdf-tool">
                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">压缩级别</div>
                        <div className="pdf-preset-list">
                          {COMPRESS_PRESETS.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={cn('pdf-preset', compressPreset === item.id && 'active')}
                              onClick={() => {
                                setCompressPreset(item.id)
                                setCompressQuality(item.quality)
                              }}
                            >
                              <span className="pdf-preset-dot" aria-hidden />
                              <span className="pdf-preset-body">
                                <strong>{item.label}</strong>
                                <small>{item.note}</small>
                              </span>
                              <em>{item.dpi} DPI</em>
                            </button>
                          ))}
                        </div>
                        <label className="pdf-range">
                          <span>画质</span>
                          <input
                            type="range"
                            min={35}
                            max={90}
                            value={Math.round(compressQuality * 100)}
                            onChange={(event) => setCompressQuality(Number(event.target.value) / 100)}
                          />
                          <em>{Math.round(compressQuality * 100)}%</em>
                        </label>
                        <label className="pdf-check">
                          <input
                            type="checkbox"
                            checked={compressPreserveText}
                            onChange={(event) => setCompressPreserveText(event.target.checked)}
                          />
                          保留文字页矢量（推荐）
                        </label>
                        <label className="pdf-check">
                          <input
                            type="checkbox"
                            checked={compressGrayscale}
                            onChange={(event) => setCompressGrayscale(event.target.checked)}
                          />
                          转为灰度（扫描件体积更小）
                        </label>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-block"
                          onClick={handleCompress}
                          disabled={busy}
                        >
                          <Minimize2 size={13} />
                          压缩 {scopeLabel}
                        </button>
                        <p className="hint">
                          扫描页与图片页会重新采样为 JPEG；文字页保持矢量清晰。{selection.length ? `当前仅压缩所选 ${selection.length} 页。` : ''}
                        </p>
                        {compressProgress ? (
                          <div className="pdf-compress-progress">
                            <div className="pdf-ocr-status">
                              <span>正在重新采样页面</span>
                              <span>
                                {compressProgress.done} / {compressProgress.total} 页
                              </span>
                            </div>
                            <div className="pdf-progress">
                              <span
                                style={{
                                  width: `${Math.round((compressProgress.done / Math.max(1, compressProgress.total)) * 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ) : null}
                        {compressResult ? (
                          <div className="pdf-compress-result">
                            <div className="pdf-compress-sizes">
                              <span>
                                <small>原始</small>
                                <strong>{formatBytes(compressResult.before)}</strong>
                              </span>
                              <span className="pdf-compress-arrow">→</span>
                              <span>
                                <small>压缩后</small>
                                <strong>{formatBytes(compressResult.after)}</strong>
                              </span>
                              {compressResult.after < compressResult.before ? (
                                <em className="is-down">
                                  -{Math.round((1 - compressResult.after / Math.max(1, compressResult.before)) * 100)}%
                                </em>
                              ) : (
                                <em className="is-up">+{Math.round((compressResult.after / Math.max(1, compressResult.before) - 1) * 100)}%</em>
                              )}
                            </div>
                            <div className="pdf-compress-meta">
                              重采样 {compressResult.rasterized} 页 · 保留文字 {compressResult.preserved} 页
                            </div>
                            {compressResult.after >= compressResult.before ? (
                              <p className="pdf-compress-warning">这份文件已接近最优体积，建议保留原件；扫描件压缩效果通常更明显。</p>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm btn-block"
                              onClick={() => downloadPdf(compressResult.bytes, compressResult.name)}
                            >
                              <Download size={13} />
                              {compressResult.after < compressResult.before ? '下载压缩文件' : '仍要下载（体积更大）'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">无损处理</div>
                        <p className="hint">
                          只想删空白页或调整方向？在「页面」标签中提取、删除与旋转，不会损失任何画质。
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {tab === 'convert' ? (
                    <div className="pdf-tool">
                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">PDF 转 Word</div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-block"
                          onClick={handlePdfToWord}
                          disabled={busy}
                        >
                          <FileDown size={13} />
                          转为 Word · {scopeLabel}
                        </button>
                        <p className="hint">
                          重建标题与段落结构，保留分页；复杂表格、图片和原版式不会还原。扫描件请先在 OCR
                          标签识别。
                        </p>
                      </div>

                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">PDF 转图片</div>
                        <div className="pdf-inline">
                          <label className="field">
                            <span className="field-label">格式</span>
                            <select
                              className="select"
                              value={imgFormat}
                              onChange={(event) => setImgFormat(event.target.value as 'png' | 'jpeg')}
                            >
                              <option value="png">PNG</option>
                              <option value="jpeg">JPEG</option>
                            </select>
                          </label>
                          <label className="field">
                            <span className="field-label">清晰度</span>
                            <select
                              className="select"
                              value={imgScale}
                              onChange={(event) => setImgScale(Number(event.target.value))}
                            >
                              <option value={1}>1×</option>
                              <option value={2}>2×</option>
                              <option value={3}>3×</option>
                            </select>
                          </label>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm btn-block"
                          onClick={handleExportImages}
                          disabled={busy}
                        >
                          <FileImage size={13} />
                          导出 {scopeLabel}图片
                        </button>
                        <p className="hint">多页结果会自动打包为 ZIP。</p>
                      </div>

                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">PDF 转文本</div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm btn-block"
                          onClick={handleExtractText}
                          disabled={busy}
                        >
                          <FileText size={13} />
                          提取 {scopeLabel}文本
                        </button>
                        <p className="hint">读取已有文字层；扫描件请使用 OCR。</p>
                        {convertText ? (
                          <div className="pdf-result">
                            <textarea
                              className="textarea pdf-textarea"
                              value={convertText.text}
                              onChange={(event) => setConvertText({ ...convertText, text: event.target.value })}
                              aria-label="提取的文本"
                            />
                            <div className="pdf-result-meta">
                              {convertText.text.replace(/\s/g, '').length} 字
                            </div>
                            <div className="pdf-result-actions">
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() =>
                                  downloadText(
                                    convertText.text,
                                    safeFilename(`${baseName(convertText.name)}_文本`, 'txt'),
                                  )
                                }
                              >
                                <Download size={12} />
                                TXT
                              </button>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyText(convertText.text)}>
                                <ClipboardCopy size={12} />
                                复制
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() =>
                                  openAi(
                                    convertText.text,
                                    '请把下面的 PDF 文本整理成结构清晰的中文要点清单，并标出关键数字与日期。',
                                  )
                                }
                              >
                                <Sparkles size={12} />
                                AI 整理
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">图片转 PDF</div>
                        {images.length ? (
                          <div className="pdf-image-list">
                            {images.map((image) => (
                              <div key={image.id} className="pdf-image-item">
                                <ImagePlus size={13} />
                                <span title={image.name}>{image.name}</span>
                                <em>{formatBytes(image.size)}</em>
                                <button
                                  type="button"
                                  className="icon-btn icon-btn-sm"
                                  title="移除图片"
                                  aria-label={`移除 ${image.name}`}
                                  onClick={() => setImages((prev) => prev.filter((item) => item.id !== image.id))}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="hint">还没有图片。把 JPG / PNG 拖进窗口，或点下方添加。</p>
                        )}
                        <button type="button" className="btn btn-secondary btn-sm btn-block" onClick={openPicker}>
                          <ImagePlus size={13} />
                          添加图片
                        </button>
                        <select
                          className="select"
                          value={imagePageSize}
                          onChange={(event) => setImagePageSize(event.target.value as 'a4' | 'fit')}
                          aria-label="图片 PDF 页面尺寸"
                        >
                          <option value="a4">A4 页面 · 居中留白</option>
                          <option value="fit">页面贴合图片</option>
                        </select>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-block"
                          onClick={handleImagesToPdf}
                          disabled={!images.length || busy}
                        >
                          <FilePlus2 size={13} />
                          生成 PDF（{images.length} 张）
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {tab === 'ocr' ? (
                    <div className="pdf-tool">
                      <div className="pdf-tool-section">
                        <div className="pdf-tool-title">离线 OCR</div>
                        <p className="hint">
                          Tesseract 引擎与中文语言包随应用保存在本机，扫描件不会上传。首次识别会初始化约 6MB
                          的模型文件。
                        </p>
                        <div className="field">
                          <label className="field-label" htmlFor="ocr-lang">
                            识别语言
                          </label>
                          <select
                            id="ocr-lang"
                            className="select"
                            value={ocrLang}
                            onChange={(event) => setOcrLang(event.target.value as typeof ocrLang)}
                          >
                            <option value="chi_sim+eng">中文简体 + 英文</option>
                            <option value="chi_sim">仅中文简体</option>
                            <option value="eng">仅英文</option>
                          </select>
                        </div>
                        <label className="pdf-check">
                          <input
                            type="checkbox"
                            checked={preferLayer}
                            onChange={(event) => setPreferLayer(event.target.checked)}
                          />
                          优先使用已有文字层
                        </label>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm btn-block"
                          onClick={() => void startOcr()}
                          disabled={busy}
                        >
                          {ocrRun ? <Loader2 size={13} className="spin" /> : <ScanText size={13} />}
                          {ocrRun ? '识别中…' : `识别 ${scopeLabel}`}
                        </button>
                        <p className="hint">中英文混排时逐页显示进度，可以随时取消。</p>
                      </div>

                      {ocrRun ? (
                        <div className="pdf-ocr-progress">
                          <div className="pdf-ocr-status">
                            <span>{ocrRun.status}</span>
                            <span>
                              {Math.min(ocrRun.page, ocrRun.pages)} / {ocrRun.pages} 页 · {ocrPercent}%
                            </span>
                          </div>
                          <div className="pdf-progress">
                            <span style={{ width: `${ocrPercent}%` }} />
                          </div>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={cancelOcr}>
                            取消识别
                          </button>
                        </div>
                      ) : null}

                      {ocrText ? (
                        <div className="pdf-result">
                          <textarea
                            className="textarea pdf-textarea pdf-textarea-tall"
                            value={ocrText.text}
                            onChange={(event) => setOcrText({ ...ocrText, text: event.target.value })}
                            aria-label="OCR 识别结果"
                          />
                          <div className="pdf-result-meta">{ocrText.text.replace(/\s/g, '').length} 字</div>
                          <div className="pdf-result-actions">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() =>
                                downloadText(ocrText.text, safeFilename(`${baseName(ocrText.name)}_OCR`, 'txt'))
                              }
                            >
                              <Download size={12} />
                              TXT
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyText(ocrText.text)}>
                              <ClipboardCopy size={12} />
                              复制
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                openAi(ocrText.text, '请校正下面的 OCR 文本，补全断行，并整理成结构清晰的要点。')
                              }
                            >
                              <Sparkles size={12} />
                              AI 校对
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </aside>
            </div>

            <footer className="pdf-status">
              <span>
                <Check size={12} />
                全部处理在浏览器内完成
              </span>
              <span>
                {files.length} 个文件 · {totalPages} 页
              </span>
            </footer>
          </>
        )}
      </main>

      <SignatureStudio
        open={signatureOpen}
        busy={busy}
        pageCount={active?.pageCount ?? 0}
        selectedCount={selection.length}
        onClose={() => setSignatureOpen(false)}
        onApply={handleSignatureApply}
      />

      {dragOver ? (
        <div className="pdf-drop-overlay">
          <div>
            <UploadCloud size={26} />
            <strong>松开即可加入队列</strong>
            <span>支持 PDF、JPG、PNG 等图片格式</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

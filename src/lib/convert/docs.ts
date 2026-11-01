import { exportToDocx } from '../docxExport'
import { renderMarkdown, sanitizeDocHtml } from '../markdown'
import {
  escapeHtml,
  htmlToText,
  readFileAsArrayBuffer,
  readFileAsText,
} from '../utils'
import { t } from '../../i18n'
import { fileBase, fileExtension } from './formats'

export interface DocOptions {
  pageSize: 'a4' | 'letter'
  fontSize: number
}

interface SourceDocument {
  title: string
  text: string
  html: string
  warnings?: number
}

const TODAY = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())

function titleFromMarkdown(markdown: string, fallback: string): string {
  const match = /^\s*#\s+(.+)$/m.exec(markdown)
  return match?.[1].trim() || fallback
}

function titleFromHtml(html: string, fallback: string): string {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (!match) return fallback
  const text = htmlToText(match[1]).replace(/\s+/g, ' ').trim()
  return text || fallback
}

export function plainTextToHtml(text: string): string {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  return paragraphs
    .map((paragraph) => {
      const body = escapeHtml(paragraph).replace(/\n/g, '<br>')
      return body.trim() ? `<p>${body}</p>` : ''
    })
    .filter(Boolean)
    .join('\n')
}

async function loadMammoth() {
  const mod: unknown = await import('mammoth/mammoth.browser.js')
  return ((mod as { default?: unknown }).default ?? mod) as {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }, options?: Record<string, unknown>) => Promise<{
      value: string
      messages: Array<{ type: string; message: string }>
    }>
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>
  }
}

export async function readDocument(file: File): Promise<SourceDocument> {
  const ext = fileExtension(file.name)
  const fallbackTitle = fileBase(file.name)
  if (ext === 'docx') {
    const mammoth = await loadMammoth()
    const buffer = await readFileAsArrayBuffer(file)
    const result = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
        ],
      },
    )
    const html = sanitizeDocHtml(result.value)
    const raw = await mammoth.extractRawText({ arrayBuffer: buffer })
    const warnings = result.messages.filter((message) => message.type === 'warning').length
    return {
      title: titleFromHtml(html, fallbackTitle),
      text: raw.value.trim(),
      html,
      warnings,
    }
  }
  const source = await readFileAsText(file)
  if (ext === 'html' || ext === 'htm') {
    const html = sanitizeDocHtml(source)
    return { title: titleFromHtml(html, fallbackTitle), text: htmlToText(html), html }
  }
  if (ext === 'md' || ext === 'markdown') {
    return {
      title: titleFromMarkdown(source, fallbackTitle),
      text: source,
      html: renderMarkdown(source),
    }
  }
  return { title: fallbackTitle, text: source, html: plainTextToHtml(source) }
}

export function documentToHtml(title: string, body: string, sourceLabel: string): string {
  const hasHeading = /<h1[\s>]/i.test(body)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink: #201e1a; --ink-2: #4d4841; --muted: #7a7369; --line: #e3ded4; --accent: #c8442b; --paper: #fffdf9; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f3f1ec; color: var(--ink); font: 16px/1.8 "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; }
  .page { max-width: 780px; margin: 48px auto; padding: 64px 72px 56px; background: var(--paper); border: 1px solid var(--line); box-shadow: 0 20px 60px -30px rgba(40, 33, 22, 0.35); }
  .kicker { color: var(--accent); font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; }
  header h1 { font: 700 34px/1.3 "Songti SC", "Source Han Serif SC", "SimSun", serif; margin: 14px 0 10px; letter-spacing: -0.01em; }
  header .meta { color: var(--muted); font-size: 12px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
  article { margin-top: 34px; }
  h1, h2, h3, h4 { font-family: "Songti SC", "Source Han Serif SC", "SimSun", serif; line-height: 1.4; color: var(--ink); }
  h1 { font-size: 28px; margin: 34px 0 14px; }
  h2 { font-size: 22px; margin: 32px 0 12px; padding-left: 12px; border-left: 3px solid var(--accent); }
  h3 { font-size: 18px; margin: 24px 0 10px; }
  p { margin: 0 0 15px; color: var(--ink-2); }
  a { color: #35587a; }
  blockquote { margin: 18px 0; padding: 4px 0 4px 18px; border-left: 2px solid var(--accent); color: var(--muted); font-style: italic; }
  code { font-family: "Cascadia Code", Consolas, monospace; font-size: 0.9em; background: #f4efe5; padding: 2px 5px; border-radius: 3px; }
  pre { background: #f6f1e7; border: 1px solid var(--line); padding: 16px 18px; overflow: auto; }
  pre code { background: none; padding: 0; }
  table { width: 100%; border-collapse: collapse; margin: 22px 0; font-size: 13.5px; }
  th, td { border: 1px solid var(--line); padding: 9px 11px; text-align: left; vertical-align: top; }
  th { background: #f4eee4; font-weight: 650; }
  img { max-width: 100%; height: auto; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 30px 0; }
  ul, ol { padding-left: 24px; margin: 0 0 16px; color: var(--ink-2); }
  li { margin: 5px 0; }
  footer { margin-top: 52px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; display: flex; justify-content: space-between; }
  @media print { body { background: #fff; } .page { margin: 0; border: 0; box-shadow: none; padding: 0; } }
</style>
</head>
<body>
<main class="page">
<header>
  <div class="kicker">Ruodao Office · Local document</div>
  ${hasHeading ? '' : `<h1>${escapeHtml(title)}</h1>`}
  <div class="meta">${escapeHtml(t('{source} · {date} · 由若道办公本地导出', { source: sourceLabel, date: TODAY }))}</div>
</header>
<article>${body}</article>
<footer><span>${t('若道办公 · 文件未离开本机')}</span><span>${escapeHtml(title)}</span></footer>
</main>
</body>
</html>`
}

export async function documentToDocx(title: string, html: string): Promise<{ blob: Blob; skippedImages: number }> {
  return exportToDocx(html, title)
}

export async function documentToEpub(title: string, html: string): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const body = html.replace(/^[\s\S]*<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '')
  const xhtmlBody = body
    .replace(/<(br|hr|img|input|meta|link)([^>]*?)(?<!\/)>/gi, '<$1$2/>')
    .replace(/&nbsp;/g, '&#160;')
  const identifier = `urn:uuid:${crypto.randomUUID()}`
  const bookTitle = escapeHtml(title)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${identifier}</dc:identifier>
    <dc:title>${bookTitle}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>${escapeHtml(t('若道办公'))}</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="content"/></spine>
</package>`,
  )
  zip.file(
    'OEBPS/style.css',
    `body { color: #201e1a; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; line-height: 1.75; margin: 5%; }
h1, h2, h3 { font-family: "Songti SC", "Source Han Serif SC", serif; line-height: 1.4; }
h1 { font-size: 1.7em; margin: 1.4em 0 0.6em; }
h2 { font-size: 1.35em; border-left: 3px solid #c8442b; padding-left: 0.45em; }
p { margin: 0 0 0.85em; }
blockquote { border-left: 2px solid #c8442b; color: #6b6459; margin: 1em 0; padding-left: 0.8em; font-style: italic; }
code { font-family: Consolas, monospace; background: #f4efe5; padding: 0.12em 0.3em; }
pre { background: #f6f1e7; padding: 0.8em; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
th, td { border: 1px solid #d9d2c5; padding: 0.4em 0.55em; text-align: left; }
th { background: #f4eee4; }
img { max-width: 100%; height: auto; }
footer { color: #7a7369; font-size: 0.8em; margin-top: 2em; border-top: 1px solid #e3ded4; padding-top: 0.8em; }`,
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><title>${t('目录')}</title></head>
<body><nav epub:type="toc" id="toc"><h1>${t('目录')}</h1><ol><li><a href="content.xhtml">${t('正文')}</a></li></ol></nav></body>
</html>`,
  )
  zip.file(
    'OEBPS/content.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><title>${bookTitle}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${xhtmlBody}
<footer>${t('由若道办公本地导出 · {date}', { date: TODAY })}</footer>
</body>
</html>`,
  )
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string; quote?: boolean }
  | { kind: 'list'; ordered: boolean; items: Array<{ text: string; depth: number; marker: string }> }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'image'; src: string; alt: string }

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function directText(node: HTMLElement): string {
  let text = ''
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? ''
    else if (child instanceof HTMLElement && !/^(UL|OL)$/.test(child.tagName)) text += directText(child)
  })
  return normalizeText(text)
}

function collectBlocks(root: ParentNode, blocks: Block[], depth = 0): void {
  Array.from(root.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return
    const tag = child.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) {
      const text = normalizeText(child.textContent ?? '')
      if (text) blocks.push({ kind: 'heading', level: Number(tag.slice(1)), text })
      return
    }
    if (tag === 'p') {
      const text = normalizeText(child.textContent ?? '')
      if (text) blocks.push({ kind: 'paragraph', text })
      child.querySelectorAll('img').forEach((img) => {
        blocks.push({ kind: 'image', src: img.getAttribute('src') ?? '', alt: img.getAttribute('alt') ?? '' })
      })
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      const items: Array<{ text: string; depth: number; marker: string }> = []
      const ordered = tag === 'ol'
      let index = Number(child.getAttribute('start') ?? '1') || 1
      Array.from(child.children).forEach((li) => {
        if (!(li instanceof HTMLElement) || li.tagName.toLowerCase() !== 'li') return
        const text = directText(li)
        const marker = ordered ? `${index}.` : depth % 2 === 0 ? '•' : '–'
        index += 1
        if (text) items.push({ text, depth, marker })
        li.querySelectorAll(':scope > ul, :scope > ol').forEach((nested) => {
          collectNestedList(nested as HTMLElement, items, depth + 1)
        })
      })
      if (items.length) blocks.push({ kind: 'list', ordered, items })
      return
    }
    if (tag === 'blockquote') {
      const text = normalizeText(child.textContent ?? '')
      if (text) blocks.push({ kind: 'paragraph', text, quote: true })
      return
    }
    if (tag === 'pre') {
      const text = (child.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n$/, '')
      if (text.trim()) blocks.push({ kind: 'code', text })
      return
    }
    if (tag === 'table') {
      const rows = Array.from(child.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => normalizeText(cell.textContent ?? '')))
        .filter((row) => row.some((cell) => cell.trim()))
      if (rows.length) blocks.push({ kind: 'table', rows })
      return
    }
    if (tag === 'hr') {
      blocks.push({ kind: 'rule' })
      return
    }
    if (tag === 'img') {
      blocks.push({ kind: 'image', src: child.getAttribute('src') ?? '', alt: child.getAttribute('alt') ?? '' })
      return
    }
    if (tag === 'figure') {
      child.querySelectorAll('img').forEach((img) => {
        blocks.push({ kind: 'image', src: img.getAttribute('src') ?? '', alt: img.getAttribute('alt') ?? '' })
      })
      const caption = normalizeText(child.querySelector('figcaption')?.textContent ?? '')
      if (caption) blocks.push({ kind: 'paragraph', text: caption })
      return
    }
    if (['div', 'section', 'article', 'main', 'body', 'header', 'footer'].includes(tag)) {
      collectBlocks(child, blocks, depth)
      return
    }
    const text = normalizeText(child.textContent ?? '')
    if (text) blocks.push({ kind: 'paragraph', text })
  })
}

function collectNestedList(list: HTMLElement, items: Array<{ text: string; depth: number; marker: string }>, depth: number): void {
  const ordered = list.tagName.toLowerCase() === 'ol'
  let index = Number(list.getAttribute('start') ?? '1') || 1
  Array.from(list.children).forEach((li) => {
    if (!(li instanceof HTMLElement) || li.tagName.toLowerCase() !== 'li') return
    const text = directText(li)
    const marker = ordered ? `${index}.` : depth % 2 === 1 ? '•' : '–'
    index += 1
    if (text) items.push({ text, depth, marker })
    li.querySelectorAll(':scope > ul, :scope > ol').forEach((nested) => {
      collectNestedList(nested as HTMLElement, items, depth + 1)
    })
  })
}

const PAGE_SIZES = {
  a4: { width: 794, height: 1123 },
  letter: { width: 816, height: 1056 },
} as const

const CANVAS_SCALE = 2
const MARGIN_X = 68
const MARGIN_TOP = 92
const MARGIN_BOTTOM = 82
const SERIF = '"Songti SC", "Source Han Serif SC", "Noto Serif SC", "SimSun", serif'
const SANS = '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif'
const MONO = '"Cascadia Code", "SFMono-Regular", Consolas, monospace'
const ACCENT = '#c8442b'
const INK = '#2a2722'
const MUTED = '#7a7369'
const LINE = '#e3ded4'

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n')
  for (const raw of paragraphs) {
    if (!raw) {
      lines.push('')
      continue
    }
    const tokens = raw.match(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]|[A-Za-z0-9_@#$%&*+=/\\.,;:'"!?()[\]{}<>|-]+|\s+|./gu) ?? [raw]
    let line = ''
    for (const token of tokens) {
      const candidate = line + token
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate
        continue
      }
      if (line.trimEnd()) {
        lines.push(line.trimEnd())
        line = ''
      }
      if (ctx.measureText(token).width <= maxWidth) {
        line = token.trimStart()
        continue
      }
      let chunk = ''
      for (const char of token) {
        if (chunk && ctx.measureText(chunk + char).width > maxWidth) {
          lines.push(chunk)
          chunk = char
        } else {
          chunk += char
        }
      }
      line = chunk
    }
    lines.push(line.trimEnd())
  }
  return lines.length ? lines : ['']
}

function loadLocalImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src || !/^(data:|blob:)/i.test(src)) {
      resolve(null)
      return
    }
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

class DocumentLayout {
  private context: CanvasRenderingContext2D
  private readonly pageWidth: number
  private readonly pageHeight: number
  private readonly contentWidth: number
  private readonly baseSize: number
  private readonly lineHeight: number
  private readonly pages: string[] = []
  private readonly images = new Map<string, HTMLImageElement | null>()
  private canvas!: HTMLCanvasElement
  private y = 0
  private pageNo = 0

  constructor(
    private readonly title: string,
    private readonly options: DocOptions,
  ) {
    const size = PAGE_SIZES[options.pageSize]
    this.pageWidth = size.width
    this.pageHeight = size.height
    this.contentWidth = size.width - MARGIN_X * 2
    this.baseSize = options.fontSize
    this.lineHeight = Math.round(options.fontSize * 1.78)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(t('无法创建文档画布'))
    this.canvas = canvas
    this.context = ctx
  }

  async loadImages(blocks: Block[]): Promise<void> {
    const sources = Array.from(new Set(blocks.filter((block): block is Extract<Block, { kind: 'image' }> => block.kind === 'image').map((block) => block.src)))
    for (const src of sources) {
      this.images.set(src, await loadLocalImage(src))
    }
  }

  layout(blocks: Block[]): string[] {
    this.newPage()
    let firstBlock: Block | undefined = blocks[0]
    if (!firstBlock || firstBlock.kind !== 'heading' || firstBlock.level > 1) {
      this.drawTitle()
    }
    let imageCount = 0
    for (const block of blocks) {
      if (block.kind === 'image') {
        if (imageCount >= 80) continue
        imageCount += 1
        this.drawImage(block)
        continue
      }
      if (block.kind === 'heading') this.drawHeading(block.level, block.text)
      else if (block.kind === 'paragraph') this.drawParagraph(block.text, block.quote)
      else if (block.kind === 'list') this.drawList(block.items)
      else if (block.kind === 'code') this.drawCode(block.text)
      else if (block.kind === 'table') this.drawTable(block.rows)
      else if (block.kind === 'rule') this.drawRule()
    }
    this.finalize()
    return this.pages
  }

  private newPage(): void {
    if (this.pageNo > 0) this.finalize()
    this.pageNo += 1
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.pageWidth * CANVAS_SCALE
    this.canvas.height = this.pageHeight * CANVAS_SCALE
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error(t('无法创建文档画布'))
    ctx.scale(CANVAS_SCALE, CANVAS_SCALE)
    ctx.fillStyle = '#fffdf9'
    ctx.fillRect(0, 0, this.pageWidth, this.pageHeight)
    this.context = ctx
    ctx.fillStyle = MUTED
    ctx.font = `500 9px ${MONO}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(this.title.slice(0, 60).toUpperCase(), MARGIN_X, 48)
    ctx.textAlign = 'right'
    ctx.fillText('RUODAO / LOCAL', this.pageWidth - MARGIN_X, 48)
    ctx.textAlign = 'left'
    ctx.strokeStyle = LINE
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(MARGIN_X, 62)
    ctx.lineTo(this.pageWidth - MARGIN_X, 62)
    ctx.stroke()
    this.y = MARGIN_TOP
  }

  private finalize(): void {
    if (!this.context) return
    const ctx = this.context
    ctx.strokeStyle = LINE
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(MARGIN_X, this.pageHeight - 58)
    ctx.lineTo(this.pageWidth - MARGIN_X, this.pageHeight - 58)
    ctx.stroke()
    ctx.fillStyle = MUTED
    ctx.font = `400 8.5px ${SANS}`
    ctx.fillText(t('若道办公 · 本地导出'), MARGIN_X, this.pageHeight - 40)
    ctx.textAlign = 'right'
    ctx.font = `500 8.5px ${MONO}`
    ctx.fillText(`PAGE ${String(this.pageNo).padStart(2, '0')}`, this.pageWidth - MARGIN_X, this.pageHeight - 40)
    ctx.textAlign = 'left'
    this.pages.push(this.canvas.toDataURL('image/jpeg', 0.92))
  }

  private get bottom(): number {
    return this.pageHeight - MARGIN_BOTTOM
  }

  private ensure(height: number): void {
    if (this.y + height <= this.bottom) return
    if (this.pages.length > 260) throw new Error(t('文档页数过多，请拆分后再转换'))
    this.newPage()
  }

  private drawTitle(): void {
    const ctx = this.context
    ctx.fillStyle = ACCENT
    ctx.font = `600 8.5px ${MONO}`
    ctx.fillText(t('LOCAL DOCUMENT / 本地文档'), MARGIN_X, this.y + 4)
    this.y += 22
    ctx.fillStyle = INK
    ctx.font = `700 27px ${SERIF}`
    const lines = wrapText(ctx, this.title, this.contentWidth)
    for (const line of lines) {
      this.ensure(38)
      ctx.fillText(line, MARGIN_X, this.y + 27)
      this.y += 36
    }
    ctx.fillStyle = MUTED
    ctx.font = `400 10px ${SANS}`
    this.y += 4
    ctx.fillText(t('由若道办公导出 · {date}', { date: TODAY }), MARGIN_X, this.y + 10)
    this.y += 22
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(MARGIN_X, this.y)
    ctx.lineTo(MARGIN_X + 38, this.y)
    ctx.stroke()
    this.y += 26
  }

  private drawHeading(level: number, text: string): void {
    const ctx = this.context
    const sizes = [30, 23, 18.5, 16.5, 15.5, 14.5]
    const size = sizes[Math.min(5, Math.max(0, level - 1))]
    const before = level === 1 ? 26 : level === 2 ? 24 : 18
    const after = level <= 2 ? 12 : 8
    ctx.font = `${level <= 2 ? 700 : 600} ${size}px ${level <= 2 ? SERIF : SANS}`
    const lines = wrapText(ctx, text, level === 2 ? this.contentWidth - 14 : this.contentWidth)
    const blockHeight = lines.length * Math.round(size * 1.42)
    this.ensure(before + blockHeight + after)
    if (this.y > MARGIN_TOP + 4) this.y += before
    ctx.fillStyle = INK
    if (level === 2) {
      ctx.fillStyle = ACCENT
      ctx.fillRect(MARGIN_X, this.y + 4, 3, blockHeight - 8)
      ctx.fillStyle = INK
    }
    const offset = level === 2 ? 14 : 0
    let cursor = this.y
    lines.forEach((line) => {
      ctx.fillText(line, MARGIN_X + offset, cursor + size * 1.05)
      cursor += Math.round(size * 1.42)
    })
    this.y = cursor + after
  }

  private drawParagraph(text: string, quote?: boolean): void {
    const ctx = this.context
    ctx.font = `${quote ? 'italic ' : ''}400 ${this.baseSize}px ${SANS}`
    ctx.fillStyle = quote ? '#675f54' : INK
    const indent = quote ? 18 : 0
    const lines = wrapText(ctx, text, this.contentWidth - indent)
    for (const line of lines) {
      this.ensure(this.lineHeight)
      if (quote) {
        ctx.fillStyle = '#f7f0e5'
        ctx.fillRect(MARGIN_X, this.y, this.contentWidth, this.lineHeight)
        ctx.fillStyle = ACCENT
        ctx.fillRect(MARGIN_X, this.y, 2.5, this.lineHeight)
        ctx.fillStyle = '#675f54'
      }
      ctx.fillText(line, MARGIN_X + indent, this.y + this.lineHeight * 0.72)
      this.y += this.lineHeight
    }
    this.y += Math.round(this.baseSize * 0.85)
  }

  private drawList(items: Array<{ text: string; depth: number; marker: string }>): void {
    const ctx = this.context
    items.forEach((item) => {
      const indent = 6 + item.depth * 24
      const markerWidth = 23
      ctx.font = `400 ${this.baseSize}px ${SANS}`
      ctx.fillStyle = INK
      const lines = wrapText(ctx, item.text, this.contentWidth - indent - markerWidth)
      lines.forEach((line, index) => {
        this.ensure(this.lineHeight)
        ctx.fillStyle = MUTED
        ctx.font = `500 ${this.baseSize}px ${SANS}`
        if (index === 0) ctx.fillText(item.marker, MARGIN_X + indent, this.y + this.lineHeight * 0.72)
        ctx.fillStyle = INK
        ctx.font = `400 ${this.baseSize}px ${SANS}`
        ctx.fillText(line, MARGIN_X + indent + markerWidth, this.y + this.lineHeight * 0.72)
        this.y += this.lineHeight
      })
      this.y += 4
    })
    this.y += Math.round(this.baseSize * 0.55)
  }

  private drawCode(text: string): void {
    const ctx = this.context
    ctx.font = `400 12px ${MONO}`
    const lines: string[] = []
    for (const raw of text.split('\n')) {
      lines.push(...wrapText(ctx, raw, this.contentWidth - 30))
    }
    const lineHeight = 19
    let index = 0
    while (index < lines.length) {
      const available = Math.floor((this.bottom - this.y - 22) / lineHeight)
      if (available < 2) {
        this.newPage()
        continue
      }
      const count = Math.min(available, lines.length - index)
      const height = count * lineHeight + 22
      ctx.fillStyle = '#f6f1e7'
      ctx.fillRect(MARGIN_X, this.y, this.contentWidth, height)
      ctx.fillStyle = '#e3d8c6'
      ctx.fillRect(MARGIN_X, this.y, 2, height)
      ctx.fillStyle = '#4a4238'
      ctx.font = `400 12px ${MONO}`
      for (let i = 0; i < count; i += 1) {
        ctx.fillText(lines[index + i] || ' ', MARGIN_X + 16, this.y + 16 + i * lineHeight)
      }
      this.y += height
      index += count
      if (index < lines.length) this.newPage()
    }
    this.y += 14
  }

  private drawTable(rowsInput: string[][]): void {
    const ctx = this.context
    const rows = rowsInput.slice(0, 260).map((row) => row.map((cell) => normalizeText(cell)))
    if (!rows.length) return
    const cols = Math.max(...rows.map((row) => row.length))
    if (!cols) return
    const fontSize = cols > 6 ? 10.5 : 12
    const pad = 7
    const lineHeight = Math.round(fontSize * 1.5)
    ctx.font = `400 ${fontSize}px ${SANS}`
    const natural = Array.from({ length: cols }, (_, col) => {
      const widest = Math.max(...rows.map((row) => ctx.measureText(row[col] ?? '').width))
      return Math.min(this.contentWidth * 0.46, Math.max(46, widest + pad * 2))
    })
    const total = natural.reduce((sum, width) => sum + width, 0)
    const scale = this.contentWidth / total
    const widths = natural.map((width) => width * scale)

    const renderRow = (row: string[], header: boolean): number => {
      const cells = Array.from({ length: cols }, (_, col) => row[col] ?? '')
      const wrapped = cells.map((cell, col) => wrapText(ctx, cell, Math.max(20, widths[col] - pad * 2)))
      const height = Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + pad * 2
      this.ensure(height + 2)
      let x = MARGIN_X
      wrapped.forEach((lines, col) => {
        if (header) {
          ctx.fillStyle = '#f4eee4'
          ctx.fillRect(x, this.y, widths[col], height)
        } else if (rows.indexOf(row) % 2 === 0) {
          ctx.fillStyle = '#fcf9f3'
          ctx.fillRect(x, this.y, widths[col], height)
        }
        ctx.strokeStyle = '#ddd5c7'
        ctx.lineWidth = 0.6
        ctx.strokeRect(x, this.y, widths[col], height)
        ctx.fillStyle = header ? INK : '#3f3a33'
        ctx.font = `${header ? 600 : 400} ${fontSize}px ${SANS}`
        lines.forEach((line, index) => {
          ctx.fillText(line, x + pad, this.y + pad + lineHeight * 0.72 + index * lineHeight)
        })
        x += widths[col]
      })
      this.y += height
      return height
    }

    if (this.y + 60 > this.bottom) this.newPage()
    renderRow(rows[0], true)
    let index = 1
    while (index < rows.length) {
      const row = rows[index]
      ctx.font = `400 ${fontSize}px ${SANS}`
      const cellLines = Array.from({ length: cols }, (_, col) => wrapText(ctx, row[col] ?? '', Math.max(20, widths[col] - pad * 2)))
      const height = Math.max(...cellLines.map((lines) => lines.length)) * lineHeight + pad * 2
      if (this.y + height > this.bottom) {
        this.newPage()
        renderRow(rows[0], true)
      }
      renderRow(row, false)
      index += 1
    }
    this.y += 20
  }

  private drawRule(): void {
    this.ensure(24)
    this.context.strokeStyle = LINE
    this.context.lineWidth = 0.8
    this.context.beginPath()
    this.context.moveTo(MARGIN_X, this.y + 10)
    this.context.lineTo(this.pageWidth - MARGIN_X, this.y + 10)
    this.context.stroke()
    this.y += 26
  }

  private drawImage(block: Extract<Block, { kind: 'image' }>): void {
    const ctx = this.context
    const image = this.images.get(block.src) ?? null
    if (!image) {
      if (block.alt.trim()) {
        ctx.fillStyle = MUTED
        ctx.font = `italic 400 ${this.baseSize - 1}px ${SANS}`
        this.ensure(this.lineHeight)
        ctx.fillText(t('［图片：{alt}］', { alt: block.alt.trim() }), MARGIN_X, this.y + this.lineHeight * 0.72)
        this.y += this.lineHeight + 8
      }
      return
    }
    const maxHeight = Math.min(430, (this.bottom - MARGIN_TOP) * 0.72)
    const scale = Math.min(this.contentWidth / image.width, maxHeight / image.height, 1)
    const width = Math.max(1, image.width * scale)
    const height = Math.max(1, image.height * scale)
    this.ensure(height + 20)
    const x = MARGIN_X + (this.contentWidth - width) / 2
    ctx.drawImage(image, x, this.y, width, height)
    this.y += height + 8
    if (block.alt.trim()) {
      ctx.fillStyle = MUTED
      ctx.font = `400 9.5px ${SANS}`
      ctx.textAlign = 'center'
      ctx.fillText(block.alt.trim(), MARGIN_X + this.contentWidth / 2, this.y + 10)
      ctx.textAlign = 'left'
      this.y += 16
    }
    this.y += 10
  }
}

async function blocksFromHtml(html: string): Promise<Block[]> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks: Block[] = []
  collectBlocks(doc.body, blocks)
  return blocks
}

export async function htmlToPdfBlob(
  title: string,
  html: string,
  options: DocOptions,
  onProgress?: (ratio: number, label?: string) => void,
): Promise<Uint8Array> {
  onProgress?.(0.05, t('整理文档结构'))
  const blocks = await blocksFromHtml(html)
  if (!blocks.length) throw new Error(t('这份文档没有可排版的正文'))
  onProgress?.(0.14, t('加载图片'))
  const layout = new DocumentLayout(title, options)
  await layout.loadImages(blocks)
  onProgress?.(0.24, t('排版分页'))
  const pages = layout.layout(blocks)
  if (!pages.length) throw new Error(t('排版失败'))
  onProgress?.(0.52, t('渲染 {n} 页', { n: pages.length }))
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const [pageWidth, pageHeight] = options.pageSize === 'a4' ? [595.28, 841.89] : [612, 792]
  for (let index = 0; index < pages.length; index += 1) {
    const data = pages[index].split(',')[1] ?? ''
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const image = await doc.embedJpg(bytes)
    const page = doc.addPage([pageWidth, pageHeight])
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight })
    onProgress?.(0.52 + (0.46 * (index + 1)) / pages.length, t('写入第 {n} 页', { n: index + 1 }))
    if (index % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const output = await doc.save()
  onProgress?.(1)
  return output
}

export async function documentToPdfBlob(
  file: File,
  options: DocOptions,
  onProgress?: (ratio: number, label?: string) => void,
): Promise<Uint8Array> {
  const source = await readDocument(file)
  return htmlToPdfBlob(source.title, source.html, options, onProgress)
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '').replace(/\\/g, '\\\\').replace(/([*_`[\]])/g, '\\$1').replace(/\s+/g, ' ')
    }
    if (!(node instanceof HTMLElement)) return ''
    const tag = node.tagName.toLowerCase()
    const children = Array.from(node.childNodes).map(inline).join('')
    if (tag === 'strong' || tag === 'b') return children.trim() ? `**${children.trim()}**` : ''
    if (tag === 'em' || tag === 'i') return children.trim() ? `*${children.trim()}*` : ''
    if (tag === 'del' || tag === 's') return children.trim() ? `~~${children.trim()}~~` : ''
    if (tag === 'code') return `\`${node.textContent ?? ''}\``
    if (tag === 'a') {
      const href = node.getAttribute('href') ?? ''
      return href ? `[${children.trim() || href}](${href})` : children
    }
    if (tag === 'br') return '  \n'
    if (tag === 'img') {
      const src = node.getAttribute('src') ?? ''
      const alt = node.getAttribute('alt') ?? ''
      if (/^https?:/i.test(src)) return `![${alt}](${src})`
      return alt ? `*${t('[图片：{alt}]', { alt })}*` : `*${t('[图片]')}*`
    }
    return children
  }

  const list = (node: HTMLElement, depth: number): string[] => {
    const ordered = node.tagName.toLowerCase() === 'ol'
    const lines: string[] = []
    let index = Number(node.getAttribute('start') ?? '1') || 1
    Array.from(node.children).forEach((child) => {
      if (!(child instanceof HTMLElement) || child.tagName.toLowerCase() !== 'li') return
      const clone = child.cloneNode(true) as HTMLElement
      const nested: HTMLElement[] = []
      clone.querySelectorAll(':scope > ul, :scope > ol').forEach((nestedList) => {
        nested.push(nestedList as HTMLElement)
        nestedList.remove()
      })
      const text = inline(clone).trim().replace(/\n{2,}/g, ' ').replace(/\n/g, '  \n')
      lines.push(`${'  '.repeat(depth)}${ordered ? `${index}.` : '-'} ${text}`)
      index += 1
      nested.forEach((nestedList) => lines.push(...list(nestedList, depth + 1)))
    })
    return lines
  }

  const table = (node: HTMLElement): string[] => {
    const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((cell) => inline(cell).trim().replace(/\|/g, '\\|')),
    )
    if (!rows.length) return []
    const cols = Math.max(...rows.map((row) => row.length))
    const filled = rows.map((row) => Array.from({ length: cols }, (_, index) => row[index] ?? ''))
    const lines = [
      `| ${filled[0].join(' | ')} |`,
      `| ${filled[0].map(() => '---').join(' | ')} |`,
      ...filled.slice(1).map((row) => `| ${row.join(' | ')} |`),
    ]
    return lines
  }

  const blocks = (root: ParentNode): string[] => {
    const lines: string[] = []
    Array.from(root.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return
      const tag = child.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        const text = inline(child).trim()
        if (text) lines.push(`${'#'.repeat(Number(tag.slice(1)))} ${text}`, '')
        return
      }
      if (tag === 'p') {
        const text = inline(child).trim()
        if (text) lines.push(text, '')
        return
      }
      if (tag === 'ul' || tag === 'ol') {
        lines.push(...list(child, 0), '')
        return
      }
      if (tag === 'blockquote') {
        const inner = blocks(child).join('\n').trim()
        if (inner) lines.push(...inner.split('\n').map((line) => (line.trim() ? `> ${line}` : '>')), '')
        return
      }
      if (tag === 'pre') {
        lines.push('```', (child.textContent ?? '').replace(/\n$/, ''), '```', '')
        return
      }
      if (tag === 'table') {
        lines.push(...table(child), '')
        return
      }
      if (tag === 'hr') {
        lines.push('---', '')
        return
      }
      if (['div', 'section', 'article', 'main', 'body', 'header', 'footer'].includes(tag)) {
        lines.push(...blocks(child))
        return
      }
      const text = inline(child).trim()
      if (text) lines.push(text, '')
    })
    return lines
  }

  return `${blocks(doc.body).join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export async function docxToMarkdown(file: File): Promise<string> {
  const source = await readDocument(file)
  return htmlToMarkdown(source.html)
}

export async function docxToPdf(
  file: File,
  options: DocOptions,
  onProgress?: (ratio: number, label?: string) => void,
): Promise<Uint8Array> {
  const source = await readDocument(file)
  return htmlToPdfBlob(source.title, source.html, options, onProgress)
}

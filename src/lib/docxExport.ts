import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  ShadingType,
  LevelFormat,
  BorderStyle,
  type IRunOptions,
} from 'docx'

interface RunFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  size?: number
  font?: string
}

interface BuildResult {
  paragraphs: Array<Paragraph | Table>
  skippedImages: number
}

const FONT_BODY = '宋体'
const FONT_HEAD = '黑体'
const FONT_MONO = 'Consolas'

function pxToHalfPoints(px: string): number | undefined {
  const n = Number.parseFloat(px)
  if (!Number.isFinite(n)) return undefined
  return Math.round(n * 0.75 * 2)
}

function normalizeColor(color: string | null | undefined): string | undefined {
  if (!color) return undefined
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (m) {
    const hex = [m[1], m[2], m[3]]
      .map((v) => Number(v).toString(16).padStart(2, '0'))
      .join('')
    return hex.toUpperCase()
  }
  const hex = color.replace('#', '')
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase()
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return hex
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase()
  }
  return undefined
}

function mergeFormat(format: RunFormat, tag: string, element?: HTMLElement): RunFormat {
  const next: RunFormat = { ...format }
  switch (tag) {
    case 'strong':
    case 'b':
      next.bold = true
      break
    case 'em':
    case 'i':
      next.italic = true
      break
    case 'u':
      next.underline = true
      break
    case 's':
    case 'del':
    case 'strike':
      next.strike = true
      break
    case 'code':
    case 'kbd':
      next.font = FONT_MONO
      next.size = 20
      break
    case 'a':
      next.underline = true
      next.color = '1D4E89'
      break
    case 'font': {
      const size = element?.getAttribute('size')
      if (size) next.size = [16, 20, 24, 28, 36, 48, 64][Number(size) - 1] ?? next.size
      const color = normalizeColor(element?.getAttribute('color'))
      if (color) next.color = color
      break
    }
    case 'span': {
      const style = element?.style
      if (style?.fontSize) next.size = pxToHalfPoints(style.fontSize) ?? next.size
      if (style?.color) next.color = normalizeColor(style.color) ?? next.color
      if (style?.fontWeight && Number(style.fontWeight) >= 600) next.bold = true
      if (style?.fontStyle === 'italic') next.italic = true
      break
    }
    default:
      break
  }
  return next
}

class DocBuilder {
  skippedImages = 0

  inlineRuns(node: Node, format: RunFormat = {}): TextRun[] {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (!text) return []
      return [new TextRun({ ...(format as IRunOptions), text })]
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') return [new TextRun({ break: 1 })]
    if (tag === 'img') {
      this.skippedImages += 1
      return []
    }
    const nextFormat = mergeFormat(format, tag, el)
    const runs: TextRun[] = []
    el.childNodes.forEach((child) => {
      runs.push(...this.inlineRuns(child, nextFormat))
    })
    if (tag === 'a' && runs.length === 0) {
      return [new TextRun({ text: el.textContent ?? '', ...(nextFormat as IRunOptions) })]
    }
    return runs
  }

  paragraph(node: HTMLElement, base: Partial<IRunOptions> = {}, spacing = { after: 140, line: 340 }): Paragraph {
    const runs = this.inlineRuns(node, base as RunFormat)
    return new Paragraph({
      children: runs.length ? runs : [new TextRun({ text: '' })],
      spacing,
    })
  }

  heading(node: HTMLElement): Paragraph {
    const level = Number(node.tagName.slice(1)) || 1
    const sizes: Record<number, number> = { 1: 40, 2: 32, 3: 28, 4: 24, 5: 24, 6: 24 }
    return new Paragraph({
      children: this.inlineRuns(node, { bold: true, size: sizes[level] ?? 24, font: FONT_HEAD, color: '201E1A' }),
      spacing: { before: level === 1 ? 320 : 260, after: 160 },
    })
  }

  list(node: HTMLElement, depth = 0): Paragraph[] {
    const ordered = node.tagName.toLowerCase() === 'ol'
    const out: Paragraph[] = []
    let index = 1
    let start = 1
    if (ordered) {
      const attr = node.getAttribute('start')
      start = attr ? Number(attr) || 1 : 1
      index = start
    }
    Array.from(node.children).forEach((child) => {
      if (child.tagName.toLowerCase() !== 'li') return
      const li = child as HTMLElement
      const clone = li.cloneNode(true) as HTMLElement
      const nested: HTMLElement[] = []
      clone.querySelectorAll(':scope > ul, :scope > ol').forEach((n) => {
        nested.push(n as HTMLElement)
        n.remove()
      })
      const runs = this.inlineRuns(clone, { size: 24, font: FONT_BODY })
      const prefix = ordered ? `${index}. ` : '• '
      if (ordered) {
        out.push(
          new Paragraph({
            children: [new TextRun({ text: prefix, bold: true }), ...runs],
            spacing: { after: 90, line: 320 },
            indent: { left: 420 + depth * 420, hanging: 260 },
          }),
        )
        index += 1
      } else {
        out.push(
          new Paragraph({
            children: [new TextRun({ text: prefix }), ...runs],
            spacing: { after: 90, line: 320 },
            indent: { left: 420 + depth * 420, hanging: 260 },
          }),
        )
      }
      nested.forEach((n) => out.push(...this.list(n, depth + 1)))
    })
    return out
  }

  table(node: HTMLElement): Table {
    const rows = Array.from(node.querySelectorAll('tr'))
    const tableRows = rows.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('th,td'))
      return new TableRow({
        children: cells.map((cell) => {
          const isHead = cell.tagName.toLowerCase() === 'th'
          const runs = this.inlineRuns(cell, { ...(isHead ? { bold: true, font: FONT_HEAD } : {}), size: 22 })
          return new TableCell({
            children: [new Paragraph({ children: runs.length ? runs : [new TextRun({ text: '' })] })],
            shading: isHead ? { type: ShadingType.CLEAR, fill: 'F2ECE1', color: 'auto' } : undefined,
            margins: { top: 90, bottom: 90, left: 120, right: 120 },
          })
        }),
      })
    })
    return new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    })
  }

  block(node: HTMLElement): Array<Paragraph | Table> {
    const tag = node.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) return [this.heading(node)]
    if (tag === 'p') return [this.paragraph(node, { size: 24, font: FONT_BODY })]
    if (tag === 'ul' || tag === 'ol') return this.list(node)
    if (tag === 'blockquote') {
      const para = this.paragraph(node, { size: 24, font: FONT_BODY, italics: true, color: '6B6358' })
      return [
        new Paragraph({
          children: para.options.children ?? [],
          spacing: { before: 120, after: 160, line: 340 },
          indent: { left: 480 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'C8442B', space: 10 } },
        }),
      ]
    }
    if (tag === 'pre') {
      return (node.textContent ?? '')
        .split('\n')
        .map(
          (line) =>
            new Paragraph({
              children: [new TextRun({ text: line || ' ', font: FONT_MONO, size: 20 })],
              spacing: { after: 40 },
              shading: { type: ShadingType.CLEAR, fill: 'F4F0E8', color: 'auto' },
            }),
        )
    }
    if (tag === 'table') return [this.table(node)]
    if (tag === 'hr') {
      return [new Paragraph({ text: '', border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D9D3C7' } } })]
    }
    if (tag === 'div' || tag === 'section' || tag === 'article') {
      const hasBlocks = node.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote')
      if (hasBlocks) {
        return Array.from(node.children).flatMap((child) =>
          child instanceof HTMLElement ? this.block(child) : [],
        )
      }
    }
    return [this.paragraph(node, { size: 24, font: FONT_BODY })]
  }
}

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'TABLE',
  'BLOCKQUOTE',
  'PRE',
  'HR',
])

export async function exportToDocx(html: string, title: string): Promise<{ blob: Blob; skippedImages: number }> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const builder = new DocBuilder()
  const children: Array<Paragraph | Table> = []

  // contentEditable can leave bare text or inline nodes as direct body children
  let pending: Node[] = []
  const flushInline = () => {
    if (!pending.length) return
    const wrapper = doc.createElement('p')
    pending.forEach((node) => wrapper.appendChild(node.cloneNode(true)))
    pending = []
    children.push(builder.paragraph(wrapper, { size: 24, font: FONT_BODY }))
  }

  Array.from(doc.body.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? '').trim()) pending.push(node)
      else flushInline()
      return
    }
    if (node instanceof HTMLElement) {
      if (BLOCK_TAGS.has(node.tagName)) {
        flushInline()
        children.push(...builder.block(node))
      } else {
        pending.push(node)
      }
    }
  })
  flushInline()

  if (!children.length) children.push(new Paragraph({ text: '' }))

  const document = new Document({
    title,
    creator: '若道办公',
    styles: {
      default: {
        document: {
          run: { font: FONT_BODY, size: 24, color: '2A2722' },
          paragraph: { spacing: { line: 340 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  })

  const blob = await Packer.toBlob(document)
  return { blob, skippedImages: builder.skippedImages }
}

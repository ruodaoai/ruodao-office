import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { escapeHtml } from './utils'

marked.setOptions({ gfm: true, breaks: true })

const CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`)/g

function replaceWikilinksOutsideCode(markdown: string): string {
  return markdown
    .split(CODE_SEGMENT)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias?: string) => {
            const cleanTarget = target.trim()
            const label = (alias ?? target).trim()
            return `<a href="#wikilink" class="wikilink" data-wikilink="${escapeHtml(cleanTarget)}">${escapeHtml(label)}</a>`
          }),
    )
    .join('')
}

export function renderMarkdown(markdown: string, options: { wikilinks?: boolean } = {}): string {
  const source = options.wikilinks ? replaceWikilinksOutsideCode(markdown) : markdown
  const html = marked.parse(source, { async: false }) as string
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-wikilink', 'target', 'rel'],
    ADD_TAGS: ['mark'],
  })
}

export function renderMarkdownUnsafeInline(markdown: string): string {
  return DOMPurify.sanitize(marked.parseInline(markdown, { async: false }) as string)
}

export interface WikiLink {
  target: string
  label: string
}

export function extractWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = []
  const seen = new Set<string>()
  const prose = markdown.replace(CODE_SEGMENT, ' ')
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(prose))) {
    const target = match[1].trim()
    if (!target || seen.has(target.toLowerCase())) continue
    seen.add(target.toLowerCase())
    links.push({ target, label: (match[2] ?? target).trim() })
  }
  return links
}

export function noteExcerpt(markdown: string, length = 90): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$1')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > length ? `${plain.slice(0, length)}…` : plain
}

export function sanitizeDocHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  parsed.querySelectorAll('script,style,link,meta,iframe,object,embed').forEach((el) => el.remove())
  return DOMPurify.sanitize(parsed.body.innerHTML, {
    ADD_ATTR: ['style', 'width', 'height', 'colspan', 'rowspan', 'data-wikilink'],
    ADD_TAGS: ['font', 'mark', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'u', 's'],
  })
}

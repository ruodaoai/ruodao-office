import { renderMarkdown } from './markdown'
import { escapeHtml } from './utils'
import { t } from '../i18n'

export interface OutlineItem {
  level: number
  text: string
}

export function normalizeNoteTitle(title: string): string {
  return title.trim().toLowerCase()
}

export function uniqueNoteTitle(existing: string[], base: string): string {
  const taken = new Set(existing.map(normalizeNoteTitle))
  const clean = base.trim() || t('未命名笔记')
  if (!taken.has(normalizeNoteTitle(clean))) return clean
  let index = 2
  while (taken.has(normalizeNoteTitle(`${clean} ${index}`))) index += 1
  return `${clean} ${index}`
}

export function stripTitleHeading(content: string, title: string): string {
  const key = normalizeNoteTitle(title)
  if (!key) return content
  const match = /^\uFEFF?[ \t]*#\s+([^\n]+)(?:\n+|$)/.exec(content)
  if (!match) return content
  const heading = match[1].replace(/\s+#+\s*$/, '').trim()
  if (normalizeNoteTitle(heading) !== key) return content
  return content.slice(match[0].length).replace(/^\n+/, '')
}

function plainInline(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias?: string) => (alias ?? target).trim())
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

export function extractOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let inFence = false
  for (const raw of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw)
    if (!match) continue
    const text = plainInline(match[2])
    if (text) items.push({ level: match[1].length, text })
  }
  return items
}

export function linkSnippet(content: string, target: string, length = 88): string {
  const key = `[[${target.trim().toLowerCase()}`
  const line = content.split('\n').find((row) => row.toLowerCase().includes(key))
  if (!line) return ''
  const clean = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, targetText: string, alias?: string) => (alias ?? targetText).trim())
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[*_`>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > length ? `${clean.slice(0, length)}…` : clean
}

const NOTE_DOCUMENT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: #f3f1ec;
  color: #201e1a;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.85;
  -webkit-font-smoothing: antialiased;
}
.doc {
  width: min(760px, calc(100% - 48px));
  margin: 40px auto;
  padding: 54px 62px 44px;
  background: #fffdf9;
  border: 1px solid #e3ded4;
  border-radius: 3px;
  box-shadow: 0 2px 6px rgba(38, 32, 22, 0.06), 0 24px 60px -22px rgba(38, 32, 22, 0.22);
}
.doc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 13px;
  border-bottom: 1px solid #e3ded4;
  color: #a29a8e;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.doc-title {
  margin: 26px 0 4px;
  font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif;
  font-size: 31px;
  line-height: 1.32;
  letter-spacing: -0.012em;
}
.doc-mark {
  display: block;
  margin-bottom: 34px;
  color: #8d2f1d;
  font-size: 10.5px;
  letter-spacing: 0.06em;
}
.doc-mark::before {
  content: "";
  display: inline-block;
  width: 15px;
  height: 1px;
  margin-right: 8px;
  background: #c8442b;
  vertical-align: 3px;
}
.prose > :first-child { margin-top: 0; }
.prose > :last-child { margin-bottom: 0; }
.prose p { margin: 0 0 15px; color: #4d4841; }
.prose h1, .prose h2, .prose h3, .prose h4 {
  font-family: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif;
  color: #201e1a;
  line-height: 1.4;
  letter-spacing: -0.005em;
}
.prose h1 { margin: 30px 0 14px; font-size: 25px; }
.prose h2 { margin: 28px 0 11px; padding-bottom: 7px; border-bottom: 1px solid #e3ded4; font-size: 19px; }
.prose h3 { margin: 23px 0 9px; font-size: 15.5px; }
.prose h4 { margin: 20px 0 8px; font-size: 14px; }
.prose ul, .prose ol { margin: 0 0 15px; padding-left: 1.5em; }
.prose li { margin: 5px 0; color: #4d4841; }
.prose li::marker { color: #b3a999; }
.prose strong { color: #201e1a; font-weight: 650; }
.prose blockquote {
  margin: 20px 0;
  padding: 12px 17px;
  border-left: 2px solid #c8442b;
  border-radius: 0 6px 6px 0;
  background: #fbf3ef;
  color: #6b4c40;
}
.prose blockquote p { margin: 0; color: inherit; }
.prose code {
  padding: 1px 5px;
  border-radius: 4px;
  background: #f1ede4;
  color: #8d4a35;
  font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: 0.86em;
}
.prose pre {
  margin: 18px 0;
  padding: 15px 17px;
  overflow-x: auto;
  border-radius: 7px;
  background: #26231e;
  color: #f4eee4;
  font-size: 12.5px;
  line-height: 1.7;
}
.prose pre code { padding: 0; background: none; color: inherit; }
.prose a { color: #8d2f1d; text-decoration: none; border-bottom: 1px solid rgba(200, 68, 43, 0.4); }
.prose .wikilink { color: #8d2f1d; }
.prose hr { height: 1px; margin: 28px 0; border: 0; background: #e3ded4; }
.prose table { width: 100%; margin: 20px 0; border-collapse: collapse; font-size: 13px; }
.prose th, .prose td { padding: 8px 10px; border: 1px solid #e3ded4; text-align: left; vertical-align: top; }
.prose th { background: #f8f5ef; color: #4d4841; font-weight: 650; }
.prose img { max-width: 100%; border-radius: 7px; border: 1px solid #e3ded4; }
.prose input[type="checkbox"] { width: 13px; height: 13px; margin: 0 6px 0 0; accent-color: #c8442b; vertical-align: -2px; }
.prose .empty { color: #a29a8e; font-style: italic; }
.doc-foot {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-top: 44px;
  padding-top: 14px;
  border-top: 1px solid #e3ded4;
  color: #a29a8e;
  font-size: 10px;
}
@media (max-width: 640px) {
  .doc { width: 100%; margin: 0; padding: 32px 24px; border: 0; border-radius: 0; box-shadow: none; }
  .doc-title { font-size: 26px; }
}
@media print {
  body { background: #fff; font-size: 10.5pt; }
  .doc { width: auto; margin: 0; padding: 0; border: 0; box-shadow: none; }
  .doc-mark { margin-bottom: 18px; }
  .doc-title { margin-top: 18px; font-size: 24pt; }
  .prose a { color: inherit; border: 0; }
  .prose pre, .prose blockquote, .prose table, .prose img { break-inside: avoid; }
  .doc-foot { margin-top: 28px; }
  @page { margin: 18mm 16mm; }
}
`

export function buildStandaloneNoteHtml(title: string, markdown: string, exportedAt: string): string {
  const rendered = renderMarkdown(markdown, { wikilinks: true })
  const parsed = new DOMParser().parseFromString(rendered, 'text/html')
  parsed.body.querySelectorAll('a').forEach((anchor) => {
    if (anchor.classList.contains('wikilink')) {
      const span = parsed.createElement('span')
      span.className = 'wikilink'
      span.textContent = anchor.textContent ?? ''
      anchor.replaceWith(span)
      return
    }
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })
  const body = parsed.body.innerHTML || `<p class="empty">${t('这篇笔记还没有正文。')}</p>`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${NOTE_DOCUMENT_CSS}</style>
</head>
<body>
<main class="doc">
  <header class="doc-head">
    <span>${t('若道办公 · 笔记')}</span>
    <span>${escapeHtml(exportedAt)}</span>
  </header>
  <h1 class="doc-title">${escapeHtml(title)}</h1>
  <span class="doc-mark">${t('双向链接笔记')}</span>
  <div class="prose">${body}</div>
  <footer class="doc-foot">
    <span>${t('导出自若道办公')}</span>
    <span>${t('文件与内容只保存在本机')}</span>
  </footer>
</main>
</body>
</html>`
}

export function printHtmlDocument(html: string): boolean {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) {
    frame.remove()
    return false
  }
  doc.open()
  doc.write(html)
  doc.close()
  window.setTimeout(() => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } finally {
      window.setTimeout(() => frame.remove(), 2500)
    }
  }, 320)
  return true
}

import { isEnglish, t } from '../i18n'

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function estimateTextWidth(text: string): number {
  let width = 0
  for (const ch of text) width += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 13 : 7.5
  return width
}

export function estimateWrappedLines(text: string, available: number): number {
  if (!text) return 1
  const width = Math.max(24, available)
  let lines = 0
  for (const segment of text.split('\n')) {
    lines += Math.max(1, Math.ceil(estimateTextWidth(segment) / width))
  }
  return lines
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'))
  doc.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,tr,blockquote,pre').forEach((el) => {
    el.append('\n')
  })
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

export function countText(text: string): { chars: number; words: number } {
  const chars = text.replace(/\s/g, '').length
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_'-]+/g) ?? []).length
  return { chars, words: cjk + latin }
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return t('刚刚')
  if (diff < 3_600_000) return t('{count} 分钟前', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('{count} 小时前', { count: Math.floor(diff / 3_600_000) })
  if (diff < 7 * 86_400_000) return t('{count} 天前', { count: Math.floor(diff / 86_400_000) })
  const d = new Date(ts)
  return t('{month} 月 {day} 日', { month: d.getMonth() + 1, day: d.getDate() })
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function todayLabel(): string {
  const d = new Date()
  if (isEnglish()) {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d)
  }
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${week}`
}

export function safeFilename(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || t('未命名')
  return `${base}.${ext.replace(/^\./, '')}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  downloadBlob(new Blob([copy], { type: mime }), filename)
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename)
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  return base64ToBytes(base64)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}-${bytes.length.toString(16)}`
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

export const shortcut = isMac() ? '⌘' : 'Ctrl'

export function formatCellNumber(value: number, fmt: string): string {
  if (!Number.isFinite(value)) return '#N/A'
  switch (fmt) {
    case 'number':
      return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    case 'percent':
      return `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
    case 'currency':
      return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case 'text':
      return String(value)
    default: {
      if (Number.isInteger(value)) return String(value)
      const abs = Math.abs(value)
      if (abs !== 0 && (abs < 0.000001 || abs >= 1e12)) return value.toExponential(4)
      return String(Math.round(value * 1e10) / 1e10)
    }
  }
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: A | null = null
  const wrapped = (...args: A) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const a = lastArgs
      lastArgs = null
      if (a) fn(...a)
    }, ms)
  }
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      if (lastArgs) fn(...lastArgs)
      lastArgs = null
    }
  }
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    lastArgs = null
  }
  return wrapped
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(t('图片加载失败')))
    image.src = src
  })
}

export async function compressImageFile(file: File, maxWidth = 1600): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!file.type.startsWith('image/')) throw new Error(t('请选择图片文件'))
  if (file.size > 12 * 1024 * 1024) throw new Error(t('图片不能超过 12MB'))
  const source = await readFileAsDataUrl(file)
  const image = await loadImageElement(source)
  const scale = Math.min(1, maxWidth / image.width)
  if (scale === 1 && file.size <= 900 * 1024) {
    return { dataUrl: source, width: image.width, height: image.height }
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('无法处理图片'))
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const png = file.type === 'image/png' || file.type === 'image/svg+xml'
  const dataUrl = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.86)
  return { dataUrl, width: canvas.width, height: canvas.height }
}

export type ConvertKind = 'image' | 'pdf' | 'text' | 'docx' | 'sheet' | 'json' | 'archive'

export type TargetId =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'bmp'
  | 'ico'
  | 'image-pdf'
  | 'pdf-png'
  | 'pdf-jpeg'
  | 'pdf-txt'
  | 'pdf-docx'
  | 'text-pdf'
  | 'text-docx'
  | 'text-html'
  | 'text-txt'
  | 'text-md'
  | 'text-epub'
  | 'docx-html'
  | 'docx-md'
  | 'docx-txt'
  | 'docx-pdf'
  | 'sheet-xlsx'
  | 'sheet-csv'
  | 'sheet-json'
  | 'sheet-html'
  | 'sheet-md'
  | 'json-xlsx'
  | 'json-csv'
  | 'json-html'
  | 'zip-extract'
  | 'zip-pdf'

export type TargetGroup = '图片' | 'PDF' | '文档' | '表格与数据' | '压缩包'

export interface TargetSpec {
  id: TargetId
  label: string
  ext: string
  group: TargetGroup
  accepts: ConvertKind[]
  hint: string
  mergeable?: boolean
}

export const TARGETS: TargetSpec[] = [
  { id: 'png', label: 'PNG', ext: 'png', group: '图片', accepts: ['image'], hint: '保留透明通道' },
  { id: 'jpeg', label: 'JPEG', ext: 'jpg', group: '图片', accepts: ['image'], hint: '可调画质，适合照片' },
  { id: 'webp', label: 'WebP', ext: 'webp', group: '图片', accepts: ['image'], hint: '体积更小的现代格式' },
  { id: 'bmp', label: 'BMP', ext: 'bmp', group: '图片', accepts: ['image'], hint: '无压缩位图' },
  { id: 'ico', label: 'ICO', ext: 'ico', group: '图片', accepts: ['image'], hint: '网站图标，多尺寸' },
  { id: 'image-pdf', label: 'PDF 画册', ext: 'pdf', group: '图片', accepts: ['image'], hint: '每张图一页或合并成册', mergeable: true },

  { id: 'pdf-png', label: 'PNG 分页', ext: 'zip', group: 'PDF', accepts: ['pdf'], hint: '逐页导出为图片' },
  { id: 'pdf-jpeg', label: 'JPEG 分页', ext: 'zip', group: 'PDF', accepts: ['pdf'], hint: '逐页导出为图片' },
  { id: 'pdf-txt', label: '纯文本', ext: 'txt', group: 'PDF', accepts: ['pdf'], hint: '读取文字层' },
  { id: 'pdf-docx', label: 'Word', ext: 'docx', group: 'PDF', accepts: ['pdf'], hint: '按页重建可编辑文字' },

  { id: 'text-pdf', label: 'PDF 文档', ext: 'pdf', group: '文档', accepts: ['text'], hint: '排版后离线渲染' },
  { id: 'text-docx', label: 'Word', ext: 'docx', group: '文档', accepts: ['text'], hint: '保留标题与列表' },
  { id: 'text-html', label: '网页', ext: 'html', group: '文档', accepts: ['text'], hint: '单文件 HTML' },
  { id: 'text-txt', label: '纯文本', ext: 'txt', group: '文档', accepts: ['text'], hint: '去掉标记后的正文' },
  { id: 'text-md', label: 'Markdown', ext: 'md', group: '文档', accepts: ['text'], hint: '结构化纯文本' },
  { id: 'text-epub', label: 'EPUB', ext: 'epub', group: '文档', accepts: ['text'], hint: '电子书，可重新排版' },

  { id: 'docx-html', label: '网页', ext: 'html', group: '文档', accepts: ['docx'], hint: 'Word 转单文件 HTML' },
  { id: 'docx-md', label: 'Markdown', ext: 'md', group: '文档', accepts: ['docx'], hint: '标题、列表、表格尽量保留' },
  { id: 'docx-txt', label: '纯文本', ext: 'txt', group: '文档', accepts: ['docx'], hint: '只取正文文字' },
  { id: 'docx-pdf', label: 'PDF 文档', ext: 'pdf', group: '文档', accepts: ['docx'], hint: '简排版渲染，图片保留' },

  { id: 'sheet-xlsx', label: 'Excel', ext: 'xlsx', group: '表格与数据', accepts: ['sheet'], hint: '统一为 XLSX 工作簿' },
  { id: 'sheet-csv', label: 'CSV', ext: 'csv', group: '表格与数据', accepts: ['sheet'], hint: '多工作表自动打包' },
  { id: 'sheet-json', label: 'JSON', ext: 'json', group: '表格与数据', accepts: ['sheet'], hint: '首行作为字段名' },
  { id: 'sheet-html', label: '网页表格', ext: 'html', group: '表格与数据', accepts: ['sheet'], hint: '可直接分享的表格页' },
  { id: 'sheet-md', label: 'Markdown', ext: 'md', group: '表格与数据', accepts: ['sheet'], hint: '每张表转成 Markdown 表' },

  { id: 'json-xlsx', label: 'Excel', ext: 'xlsx', group: '表格与数据', accepts: ['json'], hint: '数组或对象皆可' },
  { id: 'json-csv', label: 'CSV', ext: 'csv', group: '表格与数据', accepts: ['json'], hint: '多组数据自动打包' },
  { id: 'json-html', label: '网页表格', ext: 'html', group: '表格与数据', accepts: ['json'], hint: '离线可读的数据页' },

  { id: 'zip-extract', label: '解包', ext: 'zip', group: '压缩包', accepts: ['archive'], hint: '逐项取回压缩包内容' },
  { id: 'zip-pdf', label: 'PDF 画册', ext: 'pdf', group: '压缩包', accepts: ['archive'], hint: 'CBZ / 图片 ZIP 合成 PDF' },
]

export const TARGET_MAP = new Map(TARGETS.map((target) => [target.id, target]))

export const GROUP_ORDER: TargetGroup[] = ['图片', 'PDF', '文档', '表格与数据', '压缩包']

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico'])
const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'text', 'log', 'html', 'htm'])

export function fileExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1).toLowerCase() : ''
}

export function fileBase(name: string): string {
  const index = name.lastIndexOf('.')
  const base = index > 0 ? name.slice(0, index) : name
  return base.trim() || '未命名'
}

export function kindOf(name: string): ConvertKind | null {
  const ext = fileExtension(name)
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (TEXT_EXT.has(ext)) return 'text'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || ext === 'tsv') return 'sheet'
  if (ext === 'json') return 'json'
  if (ext === 'zip' || ext === 'cbz') return 'archive'
  return null
}

export const KIND_LABEL: Record<ConvertKind, string> = {
  image: '图片',
  pdf: 'PDF',
  text: '文本',
  docx: 'Word',
  sheet: '表格',
  json: '数据',
  archive: '压缩包',
}

export function targetsFor(kind: ConvertKind): TargetSpec[] {
  return TARGETS.filter((target) => target.accepts.includes(kind))
}

export function isTargetCompatible(target: TargetSpec, kind: ConvertKind): boolean {
  return target.accepts.includes(kind)
}

const DEFAULT_TARGET: Record<ConvertKind, TargetId> = {
  image: 'webp',
  pdf: 'pdf-png',
  text: 'text-pdf',
  docx: 'docx-html',
  sheet: 'sheet-xlsx',
  json: 'json-xlsx',
  archive: 'zip-extract',
}

export function defaultTargetFor(kinds: ConvertKind[]): TargetId | null {
  if (!kinds.length) return null
  const counts = new Map<TargetId, number>()
  for (const target of TARGETS) {
    const count = kinds.filter((kind) => target.accepts.includes(kind)).length
    if (count) counts.set(target.id, count)
  }
  let best: TargetId | null = null
  let bestCount = 0
  for (const kind of kinds) {
    const candidate = DEFAULT_TARGET[kind]
    const count = counts.get(candidate) ?? 0
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  if (best) return best
  for (const target of TARGETS) {
    const count = counts.get(target.id) ?? 0
    if (count > bestCount) {
      best = target.id
      bestCount = count
    }
  }
  return best
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

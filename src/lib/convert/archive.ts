import type { ImageOptions } from './image'
import { imageToJpeg, imagesToPdfBlob } from './image'
import { fileBase, fileExtension, formatBytes } from './formats'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'])
const SKIP = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)/i

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  json: 'application/json;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  cbz: 'application/vnd.comicbook+zip',
}

export function mimeForName(name: string): string {
  return MIME[fileExtension(name)] ?? 'application/octet-stream'
}

export interface ArchiveEntry {
  name: string
  blob: Blob
  note?: string
}

async function loadZip(file: File) {
  if (file.size > 160 * 1024 * 1024) throw new Error('压缩包超过 160MB，请拆分后再处理')
  const JSZip = (await import('jszip')).default
  try {
    return await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    throw new Error('无法读取这个压缩包，请确认它没有加密或损坏')
  }
}

export async function extractArchive(
  file: File,
  onProgress?: (ratio: number, label?: string) => void,
): Promise<ArchiveEntry[]> {
  onProgress?.(0.1, '读取压缩包')
  const zip = await loadZip(file)
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir && !SKIP.test(name))
  if (!names.length) throw new Error('压缩包里没有可导出的文件')
  if (names.length > 500) throw new Error('压缩包内文件超过 500 个，请先在系统中解压后分批转换')
  const entries: ArchiveEntry[] = []
  for (let index = 0; index < names.length; index += 1) {
    const path = names[index]
    const entry = zip.files[path]
    const blob = await entry.async('blob')
    const base = path.split('/').pop() || path
    entries.push({
      name: base,
      blob: new Blob([blob], { type: mimeForName(base) }),
      note: `${path}${blob.size ? ` · ${formatBytes(blob.size)}` : ''}`,
    })
    onProgress?.(0.1 + (0.9 * (index + 1)) / names.length, `解出 ${index + 1}/${names.length}`)
    if (index % 6 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return entries
}

export async function archiveImagesToPdf(
  file: File,
  options: ImageOptions,
  onProgress?: (ratio: number, label?: string) => void,
): Promise<{ blob: Blob; pages: number }> {
  onProgress?.(0.05, '读取图片压缩包')
  const zip = await loadZip(file)
  const names = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && !SKIP.test(name) && IMAGE_EXTENSIONS.has(fileExtension(name)))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
  if (!names.length) throw new Error('压缩包里没有 PNG、JPEG 或 WebP 图片')
  if (names.length > 300) throw new Error('图片超过 300 张，请分批合成')
  const images: Array<{ blob: Blob; width: number; height: number }> = []
  for (let index = 0; index < names.length; index += 1) {
    const path = names[index]
    const blob = await zip.files[path].async('blob')
    const name = path.split('/').pop() || path
    const imageFile = new File([blob], name, { type: mimeForName(name) })
    const image = await imageToJpeg(imageFile, { ...options, crop: 'none', grayscale: false })
    images.push(image)
    onProgress?.(0.05 + (0.55 * (index + 1)) / names.length, `整理 ${index + 1}/${names.length}`)
    if (index % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const bytes = await imagesToPdfBlob(images, (ratio) => onProgress?.(0.6 + ratio * 0.4, '合成 PDF 画册'))
  return { blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), pages: images.length }
}

export async function packArchive(
  files: File[],
  onProgress?: (ratio: number, label?: string) => void,
): Promise<Blob> {
  if (!files.length) throw new Error('队列里没有文件')
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const used = new Set<string>()
  files.forEach((file, index) => {
    const base = fileBase(file.name)
    const ext = fileExtension(file.name)
    let name = ext ? `${base}.${ext}` : base
    let suffix = 2
    while (used.has(name)) {
      name = `${base} (${suffix})${ext ? `.${ext}` : ''}`
      suffix += 1
    }
    used.add(name)
    zip.file(name, file)
    onProgress?.(0.05 + (0.35 * (index + 1)) / files.length, `加入 ${index + 1}/${files.length}`)
  })
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => onProgress?.(0.4 + meta.percent / 100 * 0.6, '压缩'),
  )
  onProgress?.(1)
  return blob
}

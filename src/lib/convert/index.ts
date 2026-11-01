import {
  canvasToBlob,
  extractPdfText,
  naturalPages,
  openPdf,
  pdfPagesToDocx,
  renderPdfPage,
} from '../pdf'
import { downloadBlob, htmlToText } from '../utils'
import { t } from '../../i18n'
import { archiveImagesToPdf, extractArchive, mimeForName } from './archive'
import { convertData } from './data'
import {
  documentToDocx,
  documentToEpub,
  documentToHtml,
  htmlToMarkdown,
  htmlToPdfBlob,
  readDocument,
} from './docs'
import { fileBase, fileExtension, formatBytes, kindOf, TARGET_MAP, type ConvertKind, type TargetId } from './formats'
import { convertImage, imageToJpeg, imagesToPdfBlob, type ImageOptions } from './image'
import type { DocOptions } from './docs'

export interface ConvertOptions {
  image: ImageOptions
  doc: DocOptions
  pdfScale: number
  mergeImages: boolean
}

export const DEFAULT_CONVERT_OPTIONS: ConvertOptions = {
  image: { maxEdge: 0, quality: 0.88, grayscale: false, crop: 'none' },
  doc: { pageSize: 'a4', fontSize: 15.5 },
  pdfScale: 2,
  mergeImages: true,
}

export interface ConvertedOutput {
  name: string
  blob: Blob
  ext: string
  note?: string
}

export interface BatchFile {
  id: string
  file: File
}

export interface BatchResult {
  id: string
  outputs: ConvertedOutput[]
  error?: string
  mergedInto?: string
  skipped?: string
}

export type ProgressFn = (id: string, ratio: number, label?: string) => void

const LIMITS: Record<ConvertKind, number> = {
  image: 40 * 1024 * 1024,
  pdf: 120 * 1024 * 1024,
  text: 24 * 1024 * 1024,
  docx: 40 * 1024 * 1024,
  sheet: 40 * 1024 * 1024,
  json: 24 * 1024 * 1024,
  archive: 160 * 1024 * 1024,
}

function guardSize(file: File, kind: ConvertKind): void {
  if (file.size > LIMITS[kind]) {
    throw new Error(t('{name} 超过 {size}，请拆分后再转换', { name: file.name, size: formatBytes(LIMITS[kind]) }))
  }
}

export function safeOutputName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || t('未命名')
}

function nameWithExt(base: string, ext: string): string {
  return safeOutputName(`${base}.${ext}`)
}

function textBlob(text: string, mime: string, bom = false): Blob {
  return new Blob([bom ? `\uFEFF${text}` : text], { type: mime })
}

function titleOf(base: string): string {
  return base.trim() || t('未命名文档')
}

async function convertPdfPages(
  file: File,
  base: string,
  format: 'png' | 'jpeg',
  scale: number,
  onProgress: (ratio: number, label?: string) => void,
): Promise<ConvertedOutput> {
  const loaded = await openPdf(new Uint8Array(await file.arrayBuffer()))
  const pages = naturalPages(loaded.pageCount)
  try {
    const results: Array<{ name: string; blob: Blob }> = []
    for (let index = 0; index < pages.length; index += 1) {
      const canvas = await renderPdfPage(loaded.doc, pages[index], scale)
      const blob = await canvasToBlob(canvas, format, 0.92)
      const pageName = safeOutputName(`${base}-${String(index + 1).padStart(2, '0')}.${format === 'png' ? 'png' : 'jpg'}`)
      results.push({ name: pageName, blob })
      canvas.width = 0
      canvas.height = 0
      onProgress(0.08 + (0.82 * (index + 1)) / pages.length, t('渲染 {current}/{total} 页', { current: index + 1, total: pages.length }))
      if (index % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (results.length === 1) {
      return { name: results[0].name, blob: results[0].blob, ext: format === 'png' ? 'png' : 'jpg', note: t('1 页') }
    }
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    results.forEach((item) => zip.file(item.name, item.blob))
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
    onProgress(0.98, t('打包图片'))
    return {
      name: nameWithExt(`${base}-${format === 'png' ? 'png' : 'jpg'}`, 'zip'),
      blob,
      ext: 'zip',
      note: t('{n} 页 · {format}', { n: results.length, format: format.toUpperCase() }),
    }
  } finally {
    await loaded.doc.destroy().catch(() => undefined)
  }
}

async function convertPdfText(
  file: File,
  base: string,
  target: 'pdf-txt' | 'pdf-docx',
  onProgress: (ratio: number, label?: string) => void,
): Promise<ConvertedOutput> {
  const loaded = await openPdf(new Uint8Array(await file.arrayBuffer()))
  try {
    const pages = await extractPdfText(loaded.doc, naturalPages(loaded.pageCount), (page) => {
      onProgress(0.1 + (0.75 * page) / loaded.pageCount, t('读取 {current}/{total} 页', { current: page, total: loaded.pageCount }))
    })
    if (target === 'pdf-txt') {
      const text = pages
        .map((page) => (loaded.pageCount > 1 ? `${t('— 第 {n} 页 —', { n: page.page })}\n${page.text}` : page.text))
        .join('\n\n')
      onProgress(0.96, t('写入文本'))
      return {
        name: nameWithExt(base, 'txt'),
        blob: textBlob(text, 'text/plain;charset=utf-8', true),
        ext: 'txt',
        note: t('{n} 页文字层', { n: loaded.pageCount }),
      }
    }
    const blob = await pdfPagesToDocx(titleOf(base), pages, loaded.pageCount > 1)
    onProgress(0.96, t('生成 Word'))
    return {
      name: nameWithExt(base, 'docx'),
      blob,
      ext: 'docx',
      note: t('{n} 页 · 可编辑文字', { n: loaded.pageCount }),
    }
  } finally {
    await loaded.doc.destroy().catch(() => undefined)
  }
}

async function convertText(
  file: File,
  base: string,
  target: TargetId,
  options: ConvertOptions,
  onProgress: (ratio: number, label?: string) => void,
): Promise<ConvertedOutput> {
  onProgress(0.06, t('读取文本'))
  const source = await readDocument(file)
  onProgress(0.28, t('整理内容'))
  const ext = fileExtension(file.name)
  if (target === 'text-pdf') {
    const bytes = await htmlToPdfBlob(source.title, source.html, options.doc, (ratio, label) => {
      onProgress(0.3 + ratio * 0.68, label)
    })
    return {
      name: nameWithExt(base, 'pdf'),
      blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
      ext: 'pdf',
      note: t('{size} · 本地排版', { size: options.doc.pageSize === 'a4' ? 'A4' : 'Letter' }),
    }
  }
  if (target === 'text-docx') {
    const { blob, skippedImages } = await documentToDocx(source.title, source.html)
    onProgress(0.94, t('生成 Word'))
    return {
      name: nameWithExt(base, 'docx'),
      blob,
      ext: 'docx',
      note: skippedImages ? t('{n} 张图片未嵌入', { n: skippedImages }) : t('保留标题与列表'),
    }
  }
  if (target === 'text-epub') {
    const blob = await documentToEpub(source.title, source.html)
    onProgress(0.94, t('打包 EPUB'))
    return { name: nameWithExt(base, 'epub'), blob, ext: 'epub', note: t('EPUB 3 · 可重排') }
  }
  if (target === 'text-html') {
    const html = documentToHtml(
      source.title,
      source.html,
      ext === 'md' || ext === 'markdown' ? t('Markdown 文档') : ext === 'txt' ? t('纯文本') : t('HTML 文档'),
    )
    onProgress(0.94, t('生成网页'))
    return {
      name: nameWithExt(base, 'html'),
      blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
      ext: 'html',
      note: t('单文件 HTML'),
    }
  }
  if (target === 'text-md') {
    const markdown =
      ext === 'html' || ext === 'htm'
        ? htmlToMarkdown(source.html)
        : ext === 'md' || ext === 'markdown'
          ? source.text
          : source.text.replace(/\r\n?/g, '\n')
    onProgress(0.94, t('整理 Markdown'))
    return {
      name: nameWithExt(base, 'md'),
      blob: textBlob(markdown, 'text/markdown;charset=utf-8'),
      ext: 'md',
      note: t('结构化文本'),
    }
  }
  const plain = ext === 'txt' || ext === 'text' || ext === 'log' ? source.text : htmlToText(source.html)
  onProgress(0.94, t('提取正文'))
  return {
    name: nameWithExt(base, 'txt'),
    blob: textBlob(plain.replace(/\n{3,}/g, '\n\n').trim() + '\n', 'text/plain;charset=utf-8', true),
    ext: 'txt',
    note: t('纯文本'),
  }
}

async function convertDocx(
  file: File,
  base: string,
  target: TargetId,
  options: ConvertOptions,
  onProgress: (ratio: number, label?: string) => void,
): Promise<ConvertedOutput> {
  onProgress(0.05, t('读取 Word 文档'))
  const source = await readDocument(file)
  onProgress(0.3, t('整理版式'))
  const warn = source.warnings ? t(' · {n} 处版式近似', { n: source.warnings }) : ''
  if (target === 'docx-html') {
    const html = documentToHtml(source.title, source.html, t('Word 文档 · 本地转换'))
    onProgress(0.94, t('生成网页'))
    return {
      name: nameWithExt(base, 'html'),
      blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
      ext: 'html',
      note: t('图片尽量保留{warn}', { warn }),
    }
  }
  if (target === 'docx-md') {
    const markdown = htmlToMarkdown(source.html)
    onProgress(0.94, t('生成 Markdown'))
    return {
      name: nameWithExt(base, 'md'),
      blob: textBlob(markdown, 'text/markdown;charset=utf-8'),
      ext: 'md',
      note: t('标题、列表、表格{warn}', { warn }),
    }
  }
  if (target === 'docx-txt') {
    onProgress(0.94, t('提取正文'))
    return {
      name: nameWithExt(base, 'txt'),
      blob: textBlob(source.text.trim() + '\n', 'text/plain;charset=utf-8', true),
      ext: 'txt',
      note: t('纯文本'),
    }
  }
  const bytes = await htmlToPdfBlob(source.title, source.html, options.doc, (ratio, label) => {
    onProgress(0.3 + ratio * 0.66, label)
  })
  return {
    name: nameWithExt(base, 'pdf'),
    blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
    ext: 'pdf',
    note: t('简排版渲染 · 图片尽量保留{warn}', { warn }),
  }
}

export async function convertOne(
  file: File,
  targetId: TargetId,
  options: ConvertOptions,
  onProgress: (ratio: number, label?: string) => void = () => undefined,
): Promise<ConvertedOutput[]> {
  const target = TARGET_MAP.get(targetId)
  if (!target) throw new Error(t('未知的输出格式'))
  const kind = kindOf(file.name)
  if (!kind) throw new Error(t('无法识别这种文件格式'))
  if (!target.accepts.includes(kind)) {
    throw new Error(t('{name} 不能转换为 {target}', { name: file.name, target: t(target.label) }))
  }
  guardSize(file, kind)
  const base = fileBase(file.name)

  if (kind === 'image') {
    if (targetId === 'image-pdf') {
      const image = await imageToJpeg(file, options.image, (ratio) => onProgress(ratio * 0.7, t('处理图片')))
      const bytes = await imagesToPdfBlob([image], (ratio) => onProgress(0.7 + ratio * 0.28, t('写入 PDF')))
      return [
        {
          name: nameWithExt(base, 'pdf'),
          blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
          ext: 'pdf',
          note: `${image.width} × ${image.height} · A4`,
        },
      ]
    }
    const format = targetId === 'jpeg' ? 'jpeg' : targetId
    if (format !== 'png' && format !== 'jpeg' && format !== 'webp' && format !== 'bmp' && format !== 'ico') {
      throw new Error(t('不支持的图片输出'))
    }
    const result = await convertImage(file, format, options.image, (ratio) => onProgress(ratio * 0.94, t('处理图片')))
    const ext = format === 'jpeg' ? 'jpg' : format
    return [
      {
        name: nameWithExt(base, ext),
        blob: result.blob,
        ext,
        note: `${result.width} × ${result.height}${format === 'ico' ? t(' · 多尺寸图标') : ''}`,
      },
    ]
  }

  if (kind === 'pdf') {
    if (targetId === 'pdf-png' || targetId === 'pdf-jpeg') {
      return [await convertPdfPages(file, base, targetId === 'pdf-png' ? 'png' : 'jpeg', options.pdfScale, onProgress)]
    }
    if (targetId === 'pdf-txt' || targetId === 'pdf-docx') {
      return [await convertPdfText(file, base, targetId, onProgress)]
    }
  }

  if (kind === 'text') {
    if (['text-pdf', 'text-docx', 'text-html', 'text-txt', 'text-md', 'text-epub'].includes(targetId)) {
      return [await convertText(file, base, targetId, options, onProgress)]
    }
  }

  if (kind === 'docx') {
    if (['docx-html', 'docx-md', 'docx-txt', 'docx-pdf'].includes(targetId)) {
      return [await convertDocx(file, base, targetId, options, onProgress)]
    }
  }

  if (kind === 'sheet' || kind === 'json') {
    if (targetId.startsWith('sheet-') || targetId.startsWith('json-')) {
      onProgress(0.05, t('读取表格'))
      const result = await convertData(
        file,
        targetId as 'sheet-xlsx' | 'sheet-csv' | 'sheet-json' | 'sheet-html' | 'sheet-md' | 'json-xlsx' | 'json-csv' | 'json-html',
        (ratio) => onProgress(0.1 + ratio * 0.85),
      )
      return [
        {
          name: nameWithExt(base, result.ext),
          blob: result.blob,
          ext: result.ext,
          note: result.note,
        },
      ]
    }
  }

  if (kind === 'archive') {
    if (targetId === 'zip-extract') {
      const entries = await extractArchive(file, onProgress)
      return entries.map((entry) => ({ name: entry.name, blob: entry.blob, ext: fileExtension(entry.name), note: entry.note }))
    }
    if (targetId === 'zip-pdf') {
      const result = await archiveImagesToPdf(file, options.image, onProgress)
      return [
        {
          name: nameWithExt(base, 'pdf'),
          blob: result.blob,
          ext: 'pdf',
          note: t('{n} 张图片 · A4', { n: result.pages }),
        },
      ]
    }
  }

  throw new Error(t('{name} 不支持输出为 {target}', { name: file.name, target: t(target.label) }))
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const ext = fileExtension(name)
  const base = ext ? name.slice(0, -(ext.length + 1)) : name
  let index = 2
  let candidate = `${base} (${index})${ext ? `.${ext}` : ''}`
  while (used.has(candidate)) {
    index += 1
    candidate = `${base} (${index})${ext ? `.${ext}` : ''}`
  }
  used.add(candidate)
  return candidate
}

export async function convertBatch(
  files: BatchFile[],
  targetId: TargetId,
  options: ConvertOptions,
  onProgress: ProgressFn,
): Promise<BatchResult[]> {
  const target = TARGET_MAP.get(targetId)
  if (!target || !files.length) return []
  const used = new Set<string>()
  const results: BatchResult[] = files.map((item) => ({ id: item.id, outputs: [] }))
  const compatible = files.filter((item) => {
    const kind = kindOf(item.file.name)
    return Boolean(kind && target.accepts.includes(kind))
  })
  files.forEach((item, index) => {
    const kind = kindOf(item.file.name)
    if (!kind) results[index].skipped = t('格式不支持')
    else if (!target.accepts.includes(kind)) results[index].skipped = t('不适用于 {target}', { target: t(target.label) })
    else if (item.file.size > LIMITS[kind]) {
      results[index].error = t('超过 {size}，请拆分后再转换', { size: formatBytes(LIMITS[kind]) })
    }
  })
  const usable = compatible.filter((item) => {
    const index = files.findIndex((f) => f.id === item.id)
    return !results[index].error
  })

  if (targetId === 'image-pdf' && options.mergeImages && usable.length > 1) {
    const images: Array<{ blob: Blob; width: number; height: number }> = []
    const mergedIds: string[] = []
    for (const item of usable) {
      try {
        onProgress(item.id, 0.02, t('处理图片'))
        const image = await imageToJpeg(item.file, options.image, (ratio) => onProgress(item.id, ratio * 0.5, t('处理图片')))
        images.push(image)
        mergedIds.push(item.id)
      } catch (error) {
        const index = files.findIndex((f) => f.id === item.id)
        results[index].error = error instanceof Error ? error.message : t('图片处理失败')
      }
    }
    if (!images.length) return results
    try {
      const bytes = await imagesToPdfBlob(images, (ratio) => {
        mergedIds.forEach((id) => onProgress(id, 0.52 + ratio * 0.45, t('合并 PDF')))
      })
      const first = files.find((item) => item.id === mergedIds[0])!
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const name = uniqueName(
        nameWithExt(t('{base} 等 {n} 张', { base: fileBase(first.file.name), n: images.length }), 'pdf'),
        used,
      )
      const firstIndex = files.findIndex((f) => f.id === first.id)
      results[firstIndex].outputs.push({
        name,
        blob,
        ext: 'pdf',
        note: t('合并 {n} 张图片 · A4', { n: images.length }),
      })
      mergedIds.slice(1).forEach((id) => {
        const index = files.findIndex((f) => f.id === id)
        results[index].mergedInto = name
        onProgress(id, 1, t('已合并'))
      })
      onProgress(first.id, 1, t('完成'))
    } catch (error) {
      const message = error instanceof Error ? error.message : t('合并失败')
      mergedIds.forEach((id) => {
        const index = files.findIndex((f) => f.id === id)
        results[index].error = message
      })
    }
    return results
  }

  for (const item of usable) {
    const index = files.findIndex((f) => f.id === item.id)
    try {
      onProgress(item.id, 0.03, t('准备'))
      const outputs = await convertOne(item.file, targetId, options, (ratio, label) => onProgress(item.id, ratio, label))
      results[index].outputs.push(
        ...outputs.map((output) => ({ ...output, name: uniqueName(output.name, used) })),
      )
      onProgress(item.id, 1, t('完成'))
    } catch (error) {
      results[index].error = error instanceof Error ? error.message : t('转换失败')
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return results
}

export function downloadOutputs(outputs: ConvertedOutput[]): void {
  outputs.forEach((output, index) => {
    window.setTimeout(() => downloadBlob(output.blob, output.name), index * 350)
  })
}

export function outputMime(output: ConvertedOutput): string {
  return output.blob.type || mimeForName(output.name)
}

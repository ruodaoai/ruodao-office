import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { Paragraph as DocxParagraph } from 'docx'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { t } from '../i18n'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PageNumberPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center'

export interface WatermarkOptions {
  text: string
  size: number
  opacity: number
  angle: number
  color: string
  tiled: boolean
}

export interface PageNumberOptions {
  position: PageNumberPosition
  start: number
  size: number
  skipFirst: boolean
  template: 'fraction' | 'plain'
}

export type PdfImagePlacement =
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'top-right'
  | 'top-left'
  | 'center'

export interface PdfImageStampOptions {
  place: PdfImagePlacement
  widthRatio: number
  opacity: number
  margin?: number
}

export interface PdfCompressOptions {
  dpi: number
  quality: number
  grayscale: boolean
  preserveText: boolean
}

export interface PdfCompressResult {
  bytes: Uint8Array
  before: number
  after: number
  pages: number
  rasterized: number
  preserved: number
}

export interface LoadedPdf {
  doc: PDFDocumentProxy
  pageCount: number
}

export async function openPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  })
  const doc = await task.promise
  return { doc, pageCount: doc.numPages }
}

export function naturalPages(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, i) => i + 1)
}

export async function renderPdfPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber)
  return renderPageProxy(page, scale)
}

async function renderPageProxy(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('无法创建画布'))
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  page.cleanup()
  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: 'png' | 'jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error(t('图片生成失败')))
      },
      format === 'png' ? 'image/png' : 'image/jpeg',
      quality,
    )
  })
}

export async function exportPdfImages(
  doc: PDFDocumentProxy,
  pages: number[],
  scale: number,
  format: 'png' | 'jpeg',
): Promise<Array<{ page: number; blob: Blob }>> {
  const output: Array<{ page: number; blob: Blob }> = []
  for (const pageNumber of pages) {
    const page = await doc.getPage(pageNumber)
    const canvas = await renderPageProxy(page, scale)
    output.push({ page: pageNumber, blob: await canvasToBlob(canvas, format) })
  }
  return output
}

export async function extractPageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const content = await page.getTextContent()
  let text = ''
  for (const item of content.items) {
    if (!('str' in item)) continue
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  page.cleanup()
  return text.replace(/[ \t]+\n/g, '\n').trim()
}

export async function extractPdfText(
  doc: PDFDocumentProxy,
  pages: number[],
  onPage?: (page: number) => void,
): Promise<Array<{ page: number; text: string }>> {
  const output: Array<{ page: number; text: string }> = []
  for (const pageNumber of pages) {
    const text = await extractPageText(doc, pageNumber)
    output.push({ page: pageNumber, text })
    onPage?.(pageNumber)
  }
  return output
}

function pageSelection(pages: number[] | null, pageCount: number): number[] {
  const list = pages?.length ? pages : naturalPages(pageCount)
  return list
    .filter((page, index) => page >= 1 && page <= pageCount && list.indexOf(page) === index)
    .sort((a, b) => a - b)
}

export async function mergePdfs(sources: Uint8Array[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const output = await PDFDocument.create()
  for (const bytes of sources) {
    const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const copied = await output.copyPages(source, source.getPageIndices())
    copied.forEach((page) => output.addPage(page))
  }
  return output.save()
}

export async function extractPdfPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const output = await PDFDocument.create()
  const selected = pageSelection(pages, source.getPageCount()).map((page) => page - 1)
  if (!selected.length) throw new Error(t('请先选择要保留的页面'))
  const copied = await output.copyPages(source, selected)
  copied.forEach((page) => output.addPage(page))
  return output.save()
}

export async function removePdfPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const removed = new Set(pageSelection(pages, source.getPageCount()))
  const keep = source.getPageIndices().filter((index) => !removed.has(index + 1))
  if (!keep.length) throw new Error(t('不能删除全部页面'))
  if (keep.length === source.getPageCount()) throw new Error(t('请先选择要删除的页面'))
  const output = await PDFDocument.create()
  const copied = await output.copyPages(source, keep)
  copied.forEach((page) => output.addPage(page))
  return output.save()
}

export async function rotatePdfPages(bytes: Uint8Array, pages: number[] | null, delta: number): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const targets = new Set(pageSelection(pages, doc.getPageCount()))
  doc.getPages().forEach((page, index) => {
    if (!targets.has(index + 1)) return
    const current = page.getRotation().angle
    page.setRotation(degrees((((current + delta) % 360) + 360) % 360))
  })
  return doc.save()
}

export async function splitPdf(
  bytes: Uint8Array,
  pages: number[],
  chunkSize: number,
): Promise<Array<{ label: string; pages: number[]; bytes: Uint8Array }>> {
  const { PDFDocument } = await import('pdf-lib')
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const selected = pageSelection(pages, source.getPageCount())
  const size = Math.max(1, Math.floor(chunkSize))
  const chunks: Array<{ label: string; pages: number[]; bytes: Uint8Array }> = []
  for (let start = 0; start < selected.length; start += size) {
    const part = selected.slice(start, start + size)
    const output = await PDFDocument.create()
    const copied = await output.copyPages(source, part.map((page) => page - 1))
    copied.forEach((page) => output.addPage(page))
    chunks.push({
      label:
        part.length === 1
          ? t('第{page}页', { page: part[0] })
          : t('第{from}-{to}页', { from: part[0], to: part[part.length - 1] }),
      pages: part,
      bytes: await output.save(),
    })
  }
  return chunks
}

function drawWatermarkCanvas(
  width: number,
  height: number,
  options: WatermarkOptions,
): HTMLCanvasElement {
  const ratio = 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * ratio))
  canvas.height = Math.max(1, Math.round(height * ratio))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('无法创建水印图层'))
  ctx.scale(ratio, ratio)
  ctx.globalAlpha = options.opacity
  ctx.fillStyle = options.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${options.size}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`
  const angle = (options.angle * Math.PI) / 180
  ctx.translate(width / 2, height / 2)
  ctx.rotate(angle)
  if (!options.tiled) {
    ctx.fillText(options.text, 0, 0)
    return canvas
  }
  const stepX = Math.max(options.size * 4, ctx.measureText(options.text).width + options.size * 2)
  const stepY = Math.max(options.size * 2.6, 90)
  const reach = Math.hypot(width, height) / 2 + Math.max(stepX, stepY)
  let row = 0
  for (let y = -reach; y <= reach; y += stepY) {
    const offset = row % 2 === 0 ? 0 : stepX / 2
    for (let x = -reach - stepX; x <= reach + stepX; x += stepX) {
      ctx.fillText(options.text, x + offset, y)
    }
    row += 1
  }
  return canvas
}

export async function addPdfWatermark(
  bytes: Uint8Array,
  pages: number[] | null,
  options: WatermarkOptions,
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const targets = new Set(pageSelection(pages, doc.getPageCount()))
  const cache = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>()
  for (const [index, page] of doc.getPages().entries()) {
    if (!targets.has(index + 1)) continue
    const width = page.getWidth()
    const height = page.getHeight()
    const key = `${Math.round(width)}x${Math.round(height)}`
    let image = cache.get(key)
    if (!image) {
      const canvas = drawWatermarkCanvas(width, height, options)
      image = await doc.embedPng(canvas.toDataURL('image/png'))
      cache.set(key, image)
    }
    page.drawImage(image, { x: 0, y: 0, width, height })
  }
  return doc.save()
}

export async function addPdfPageNumbers(
  bytes: Uint8Array,
  pages: number[] | null,
  options: PageNumberOptions,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const targets = pageSelection(pages, doc.getPageCount())
  const total = targets.length
  const margin = 24
  let counter = Math.max(0, Math.floor(options.start))
  targets.forEach((pageNumber, order) => {
    const skip = options.skipFirst && order === 0
    if (!skip) {
      const label =
        options.template === 'fraction' ? `${counter} / ${total}` : String(counter)
      const page = doc.getPage(pageNumber - 1)
      const width = page.getWidth()
      const height = page.getHeight()
      const textWidth = font.widthOfTextAtSize(label, options.size)
      const top = options.position === 'top-center'
      const y = top ? height - margin - options.size : margin
      let x = (width - textWidth) / 2
      if (options.position === 'bottom-right') x = width - margin - textWidth
      if (options.position === 'bottom-left') x = margin
      page.drawText(label, {
        x,
        y,
        size: options.size,
        font,
        color: rgb(0.28, 0.26, 0.23),
      })
    }
    counter += 1
  })
  return doc.save()
}

export async function stampPdfImage(
  bytes: Uint8Array,
  pages: number[] | null,
  dataUrl: string,
  options: PdfImageStampOptions,
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const image = await doc.embedPng(dataUrl)
  const targets = new Set(pageSelection(pages, doc.getPageCount()))
  if (!targets.size) throw new Error(t('请先选择页面'))
  const ratio = Math.max(0.08, Math.min(0.7, options.widthRatio))
  const opacity = Math.max(0.1, Math.min(1, options.opacity))
  const margin = options.margin ?? 42
  doc.getPages().forEach((page, index) => {
    if (!targets.has(index + 1)) return
    const pageWidth = page.getWidth()
    const pageHeight = page.getHeight()
    const width = Math.min(pageWidth * 0.92, pageWidth * ratio)
    const height = width * (image.height / image.width)
    let x = pageWidth - margin - width
    let y = margin
    if (options.place === 'bottom-left') x = margin
    if (options.place === 'bottom-center') x = (pageWidth - width) / 2
    if (options.place === 'top-left') {
      x = margin
      y = pageHeight - margin - height
    }
    if (options.place === 'top-right') y = pageHeight - margin - height
    if (options.place === 'center') {
      x = (pageWidth - width) / 2
      y = (pageHeight - height) / 2
    }
    page.drawImage(image, { x, y, width, height, opacity })
  })
  return doc.save()
}

function grayscaleCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = frame.data
  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114)
    data[index] = gray
    data[index + 1] = gray
    data[index + 2] = gray
  }
  ctx.putImageData(frame, 0, 0)
  return canvas
}

export async function compressPdf(
  sourceBytes: Uint8Array,
  doc: PDFDocumentProxy,
  pages: number[] | null,
  options: PdfCompressOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfCompressResult> {
  const { PDFDocument } = await import('pdf-lib')
  const targets = new Set(pageSelection(pages, doc.numPages))
  if (!targets.size) throw new Error(t('请选择要压缩的页面'))
  const source = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
  const output = await PDFDocument.create()
  const scale = Math.max(0.5, Math.min(4, options.dpi / 72))
  const quality = Math.max(0.3, Math.min(0.95, options.quality))
  let done = 0
  let preserved = 0
  for (let index = 0; index < doc.numPages; index += 1) {
    const pageNumber = index + 1
    if (!targets.has(pageNumber)) {
      const copied = await output.copyPages(source, [index])
      copied.forEach((page) => output.addPage(page))
      continue
    }
    let hasText = false
    if (options.preserveText) {
      const textPage = await doc.getPage(pageNumber)
      const content = await textPage.getTextContent()
      let length = 0
      for (const item of content.items) {
        if ('str' in item) length += item.str.trim().length
      }
      textPage.cleanup()
      hasText = length >= 24
    }
    if (hasText) {
      const copied = await output.copyPages(source, [index])
      copied.forEach((page) => output.addPage(page))
      preserved += 1
      done += 1
      onProgress?.(done, targets.size)
      continue
    }
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    let canvas = await renderPageProxy(page, scale)
    if (options.grayscale) canvas = grayscaleCanvas(canvas)
    const blob = await canvasToBlob(canvas, 'jpeg', quality)
    const jpegBytes = new Uint8Array(await blob.arrayBuffer())
    const embedded = await output.embedJpg(jpegBytes)
    const outPage = output.addPage([base.width, base.height])
    outPage.drawImage(embedded, { x: 0, y: 0, width: base.width, height: base.height })
    done += 1
    onProgress?.(done, targets.size)
  }
  const out = await output.save()
  return {
    bytes: out,
    before: sourceBytes.byteLength,
    after: out.byteLength,
    pages: targets.size,
    rasterized: done - preserved,
    preserved,
  }
}

export async function pdfPagesToDocx(
  title: string,
  pages: Array<{ page: number; text: string }>,
  pageHeadings: boolean,
): Promise<Blob> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx')
  const children: DocxParagraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title, font: 'Microsoft YaHei', size: 44, color: '201E1A' })],
      spacing: { after: 240 },
    }),
  ]
  pages.forEach((page, pageIndex) => {
    if (pageHeadings) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: t('第 {page} 页', { page: page.page }), font: 'Microsoft YaHei', size: 28, color: '4D4841' })],
          spacing: { before: pageIndex === 0 ? 80 : 320, after: 140 },
        }),
      )
    }
    const lines = page.text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (!lines.length) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: t('（本页没有可提取的文字层，扫描件请先在本应用内做 OCR。）'), italics: true, color: '8D8275' })],
        }),
      )
      return
    }
    lines.forEach((line) => {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, font: 'Microsoft YaHei', size: 22, color: '2A2722' })],
          spacing: { after: 140, line: 360 },
        }),
      )
    })
  })
  const document = new Document({
    title,
    creator: t('若道办公'),
    styles: {
      default: {
        document: {
          run: { font: 'Microsoft YaHei', size: 22, color: '2A2722' },
          paragraph: { spacing: { line: 360 } },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children,
      },
    ],
  })
  return Packer.toBlob(document)
}

function loadImageSource(file: File): Promise<{ bytes: Uint8Array; width: number; height: number; kind: 'jpg' | 'png' }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const finish = (bytes: Uint8Array, kind: 'jpg' | 'png') => {
        URL.revokeObjectURL(url)
        resolve({ bytes, width: image.naturalWidth, height: image.naturalHeight, kind })
      }
      if (/^image\/(jpeg|png)$/.test(file.type)) {
        file
          .arrayBuffer()
          .then((buffer) => finish(new Uint8Array(buffer), file.type === 'image/png' ? 'png' : 'jpg'))
          .catch(reject)
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error(t('无法读取图片')))
        return
      }
      ctx.drawImage(image, 0, 0)
      canvas
        .toBlob((blob) => {
          if (!blob) {
            reject(new Error(t('图片转换失败')))
            return
          }
          blob
            .arrayBuffer()
            .then((buffer) => finish(new Uint8Array(buffer), 'png'))
            .catch(reject)
        }, 'image/png')
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t('无法读取图片')))
    }
    image.src = url
  })
}

export async function imagesToPdf(
  files: File[],
  pageSize: 'a4' | 'fit',
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  if (!files.length) throw new Error(t('请先选择图片'))
  const doc = await PDFDocument.create()
  const a4: [number, number] = [595.28, 841.89]
  for (const file of files) {
    const source = await loadImageSource(file)
    const image = source.kind === 'png' ? await doc.embedPng(source.bytes) : await doc.embedJpg(source.bytes)
    if (pageSize === 'a4') {
      const landscape = source.width > source.height
      const [w, h] = landscape ? [a4[1], a4[0]] : a4
      const page = doc.addPage([w, h])
      const margin = 28
      const scale = Math.min((w - margin * 2) / image.width, (h - margin * 2) / image.height)
      const drawWidth = image.width * scale
      const drawHeight = image.height * scale
      page.drawImage(image, {
        x: (w - drawWidth) / 2,
        y: (h - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      })
    } else {
      const scale = Math.min(1, 1600 / Math.max(source.width, source.height))
      const w = Math.max(72, source.width * scale)
      const h = Math.max(72, source.height * scale)
      const page = doc.addPage([w, h])
      page.drawImage(image, { x: 0, y: 0, width: w, height: h })
    }
  }
  return doc.save()
}

interface OcrProgress {
  status: string
  progress: number
}

const OCR_STATUS: Record<string, string> = {
  'loading tesseract core': '载入识别引擎',
  'initializing tesseract': '初始化引擎',
  'loading language traineddata': '加载中文语言包',
  'initializing api': '准备识别',
  'recognizing text': '识别文字',
}

export async function ocrPdf(
  doc: PDFDocumentProxy,
  pages: number[],
  language: 'chi_sim+eng' | 'chi_sim' | 'eng',
  onProgress: (info: { page: number; pages: number; status: string; progress: number }) => void,
  isCancelled: () => boolean,
  preferTextLayer: boolean,
): Promise<Array<{ page: number; text: string; ocr: boolean }>> {
  const { createWorker } = await import('tesseract.js')
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null
  const output: Array<{ page: number; text: string; ocr: boolean }> = []
  try {
    for (let index = 0; index < pages.length; index += 1) {
      if (isCancelled()) throw new Error(t('已取消识别'))
      const pageNumber = pages[index]
      onProgress({ page: index + 1, pages: pages.length, status: t('准备页面'), progress: 0 })
      if (preferTextLayer) {
        const text = await extractPageText(doc, pageNumber)
        if (text.length >= 24) {
          output.push({ page: pageNumber, text, ocr: false })
          continue
        }
      }
      if (!worker) {
        const workerOptions: Record<string, unknown> = {
          workerPath: '/tesseract/worker.min.js',
          corePath: '/tesseract/core',
          langPath: '/tesseract/lang',
          gzip: true,
          lstmOnly: true,
          logger: (message: OcrProgress) => {
            onProgress({
              page: index + 1,
              pages: pages.length,
              status: t(OCR_STATUS[message.status] ?? message.status),
              progress: message.progress,
            })
          },
        }
        worker = await createWorker(language, 1, workerOptions as Parameters<typeof createWorker>[2])
      }
      const canvas = await renderPdfPage(doc, pageNumber, 2)
      const result = await worker.recognize(canvas)
      output.push({ page: pageNumber, text: result.data.text.trim(), ocr: true })
    }
  } finally {
    await worker?.terminate()
  }
  return output
}

function drawCoverPage(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#fffdf9'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#c8442b'
  ctx.fillRect(64, 88, 46, 4)
  ctx.fillStyle = '#8d8275'
  ctx.font = '11px "Microsoft YaHei", sans-serif'
  ctx.fillText(t('SERVICE AGREEMENT · 本地生成'), 64, 128)
  ctx.fillStyle = '#201e1a'
  ctx.font = '600 38px "Source Han Serif SC", "SimSun", serif'
  ctx.fillText(t('服务合同'), 64, 210)
  ctx.font = '12px "Microsoft YaHei", sans-serif'
  ctx.fillStyle = '#4d4841'
  const lines = [
    t('合同编号：RD-2026-017'),
    t('甲方：若道科技有限公司'),
    t('乙方：示例客户'),
    t('生效日期：2026 年 10 月 1 日'),
  ]
  lines.forEach((line, index) => ctx.fillText(line, 64, 258 + index * 26))
  ctx.strokeStyle = '#e3ded4'
  ctx.beginPath()
  ctx.moveTo(64, 388)
  ctx.lineTo(width - 64, 388)
  ctx.stroke()
  ctx.fillStyle = '#4d4841'
  ctx.font = '12px "Microsoft YaHei", sans-serif'
  const body = [
    t('双方就本地办公软件的使用与维护达成如下约定。'),
    t('本文件由若道办公在浏览器内生成，不经过任何服务器。'),
    t('可尝试对本文件添加水印、拆分页面，或使用 OCR 识别扫描页。'),
  ]
  body.forEach((line, index) => ctx.fillText(line, 64, 430 + index * 30))
  ctx.fillStyle = '#a29a8e'
  ctx.font = '10px "Microsoft YaHei", sans-serif'
  ctx.fillText('Ruodao Office · local-first sample document', 64, height - 72)
}

function drawScanPage(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#fbfaf6'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(40, 40, width - 80, height - 80)
  ctx.strokeStyle = '#eae5da'
  ctx.strokeRect(40, 40, width - 80, height - 80)
  ctx.fillStyle = '#201e1a'
  ctx.font = '600 24px "Microsoft YaHei", sans-serif'
  ctx.fillText(t('保密条款'), 96, 150)
  ctx.font = '14px "Microsoft YaHei", sans-serif'
  ctx.fillStyle = '#35312b'
  const lines = [
    t('一、双方对在合作过程中获知的商业信息负有保密义务。'),
    t('二、未经书面许可，任何一方不得向第三方披露上述信息。'),
    t('三、保密义务在合同终止后继续有效，期限为三年。'),
    t('四、违反保密义务的一方应承担相应的赔偿责任。'),
    '',
    t('本页为扫描件样式，可用于测试本地 OCR 识别能力。'),
  ]
  lines.forEach((line, index) => ctx.fillText(line, 96, 210 + index * 40))
  ctx.strokeStyle = '#c8442b'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(width - 190, 640, 58, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#c8442b'
  ctx.font = '600 18px "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(t('若道办公'), width - 190, 636)
  ctx.font = '11px "Microsoft YaHei", sans-serif'
  ctx.fillText(t('合同专用章'), width - 190, 658)
  ctx.textAlign = 'left'
  ctx.lineWidth = 1
}

async function canvasPageData(
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  format: 'png' | 'jpeg' = 'png',
  quality = 0.9,
) {
  const width = 595.28
  const height = 841.89
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * 2)
  canvas.height = Math.round(height * 2)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('无法生成示例文件'))
  ctx.scale(2, 2)
  draw(ctx, width, height)
  return canvas.toDataURL(format === 'png' ? 'image/png' : 'image/jpeg', quality)
}

export async function createSamplePdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const cover = await doc.embedJpg(await canvasPageData(drawCoverPage, 'jpeg', 0.9))
  const scan = await doc.embedJpg(await canvasPageData(drawScanPage, 'jpeg', 0.92))
  const pageA = doc.addPage([595.28, 841.89])
  pageA.drawImage(cover, { x: 0, y: 0, width: 595.28, height: 841.89 })
  const pageB = doc.addPage([595.28, 841.89])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  pageB.drawText('Scope of Work', { x: 64, y: 760, size: 24, font: bold, color: rgb(0.13, 0.12, 0.1) })
  const rows = [
    '1. Local-first document editing with DOCX interoperability.',
    '2. Spreadsheet formulas, number formats and XLSX round-trip.',
    '3. Offline PDF merge, split, watermark, page numbers and OCR.',
    '4. Bi-directional notes with [[wikilinks]] and backlinks.',
    '5. Bring your own model: OpenAI-compatible or local Ollama.',
    '',
    'All processing stays on this device. No upload queue, no watermark fee.',
  ]
  rows.forEach((line, index) => {
    pageB.drawText(line, {
      x: 64,
      y: 710 - index * 24,
      size: 12,
      font,
      color: rgb(0.24, 0.22, 0.19),
    })
  })
  pageB.drawText('Ruodao Office · sample document', {
    x: 64,
    y: 80,
    size: 9,
    font,
    color: rgb(0.63, 0.6, 0.55),
  })
  const pageC = doc.addPage([595.28, 841.89])
  pageC.drawImage(scan, { x: 0, y: 0, width: 595.28, height: 841.89 })
  return doc.save()
}

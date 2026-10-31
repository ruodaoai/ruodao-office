export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'ico'
export type CropRatio = 'none' | '1:1' | '4:3' | '16:9' | '3:4'

export interface ImageOptions {
  maxEdge: number
  quality: number
  grayscale: boolean
  crop: CropRatio
}

export const IMAGE_MAX_EDGES = [0, 3840, 2560, 1920, 1280, 800] as const

interface LoadedSource {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

function readSource(file: Blob): Promise<LoadedSource> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      try {
        const width = Math.max(1, image.naturalWidth || image.width || 1)
        const height = Math.max(1, image.naturalHeight || image.height || 1)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('无法创建画布')
        ctx.drawImage(image, 0, 0, width, height)
        resolve({ canvas, width, height })
      } catch (error) {
        reject(error instanceof Error ? error : new Error('图片读取失败'))
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('浏览器无法读取这种图片，请先转成 PNG、JPEG 或 WebP'))
    }
    image.src = url
  })
}

function cropRect(width: number, height: number, ratio: CropRatio): { x: number; y: number; width: number; height: number } {
  if (ratio === 'none') return { x: 0, y: 0, width, height }
  const [rw, rh] = ratio.split(':').map(Number)
  const target = rw / rh
  const current = width / height
  if (current > target) {
    const nextWidth = Math.round(height * target)
    return { x: Math.round((width - nextWidth) / 2), y: 0, width: nextWidth, height }
  }
  const nextHeight = Math.round(width / target)
  return { x: 0, y: Math.round((height - nextHeight) / 2), width, height: nextHeight }
}

function drawProcessed(source: LoadedSource, options: ImageOptions, background?: string): HTMLCanvasElement {
  const crop = cropRect(source.width, source.height, options.crop)
  const cap = options.maxEdge > 0 ? options.maxEdge : 8192
  const scale = Math.min(1, cap / Math.max(crop.width, crop.height))
  const width = Math.max(1, Math.round(crop.width * scale))
  const height = Math.max(1, Math.round(crop.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }
  if (options.grayscale) ctx.filter = 'grayscale(1)'
  ctx.drawImage(source.canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))),
      type,
      quality,
    )
  })
}

function encodeBmp(canvas: HTMLCanvasElement): Blob {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法读取画布')
  const { width, height } = canvas
  const image = ctx.getImageData(0, 0, width, height)
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelSize = rowSize * height
  const buffer = new ArrayBuffer(54 + pixelSize)
  const view = new DataView(buffer)
  view.setUint8(0, 0x42)
  view.setUint8(1, 0x4d)
  view.setUint32(2, buffer.byteLength, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixelSize, true)
  view.setUint32(38, 2835, true)
  view.setUint32(42, 2835, true)
  const bytes = new Uint8Array(buffer)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((height - 1 - y) * width + x) * 4
      const target = 54 + y * rowSize + x * 3
      bytes[target] = image.data[source + 2]
      bytes[target + 1] = image.data[source + 1]
      bytes[target + 2] = image.data[source]
    }
  }
  return new Blob([buffer], { type: 'image/bmp' })
}

const ICO_SIZES = [16, 32, 48, 64, 128, 256]

function squareCanvas(source: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建图标画布')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const scale = Math.min(size / source.width, size / source.height)
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  ctx.drawImage(source, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height)
  return canvas
}

async function encodeIco(source: HTMLCanvasElement): Promise<Blob> {
  const images: Array<{ size: number; bytes: Uint8Array }> = []
  for (const size of ICO_SIZES) {
    const blob = await canvasToBlob(squareCanvas(source, size), 'image/png')
    images.push({ size, bytes: new Uint8Array(await blob.arrayBuffer()) })
  }
  const headerSize = 6 + images.length * 16
  const total = headerSize + images.reduce((sum, item) => sum + item.bytes.length, 0)
  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  view.setUint16(0, 0, true)
  view.setUint16(2, 1, true)
  view.setUint16(4, images.length, true)
  let offset = headerSize
  images.forEach((item, index) => {
    const entry = 6 + index * 16
    view.setUint8(entry, item.size >= 256 ? 0 : item.size)
    view.setUint8(entry + 1, item.size >= 256 ? 0 : item.size)
    view.setUint8(entry + 2, 0)
    view.setUint8(entry + 3, 0)
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, 32, true)
    view.setUint32(entry + 8, item.bytes.length, true)
    view.setUint32(entry + 12, offset, true)
    new Uint8Array(buffer, offset, item.bytes.length).set(item.bytes)
    offset += item.bytes.length
  })
  return new Blob([buffer], { type: 'image/x-icon' })
}

export interface ConvertedImage {
  blob: Blob
  width: number
  height: number
}

export async function convertImage(
  file: File,
  format: ImageFormat,
  options: ImageOptions,
  onProgress?: (ratio: number) => void,
): Promise<ConvertedImage> {
  onProgress?.(0.12)
  const source = await readSource(file)
  onProgress?.(0.46)
  const needsOpaque = format === 'jpeg' || format === 'bmp'
  const canvas = drawProcessed(source, options, needsOpaque ? '#ffffff' : undefined)
  onProgress?.(0.74)
  let blob: Blob
  if (format === 'png') blob = await canvasToBlob(canvas, 'image/png')
  else if (format === 'jpeg') blob = await canvasToBlob(canvas, 'image/jpeg', options.quality)
  else if (format === 'webp') blob = await canvasToBlob(canvas, 'image/webp', options.quality)
  else if (format === 'bmp') blob = encodeBmp(canvas)
  else blob = await encodeIco(canvas)
  onProgress?.(1)
  return { blob, width: canvas.width, height: canvas.height }
}

export interface PdfImageItem {
  blob: Blob
  width: number
  height: number
}

export async function imageToJpeg(
  file: File,
  options: ImageOptions,
  onProgress?: (ratio: number) => void,
): Promise<PdfImageItem> {
  onProgress?.(0.1)
  const source = await readSource(file)
  onProgress?.(0.44)
  const canvas = drawProcessed(source, options, '#ffffff')
  onProgress?.(0.72)
  const blob = await canvasToBlob(canvas, 'image/jpeg', Math.max(0.8, options.quality))
  onProgress?.(1)
  return { blob, width: canvas.width, height: canvas.height }
}

export async function imagesToPdfBlob(
  images: PdfImageItem[],
  onProgress?: (ratio: number) => void,
): Promise<Uint8Array> {
  if (!images.length) throw new Error('没有可合成的图片')
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const a4: [number, number] = [595.28, 841.89]
  let done = 0
  for (const item of images) {
    const bytes = new Uint8Array(await item.blob.arrayBuffer())
    const embedded = await doc.embedJpg(bytes)
    const landscape = item.width > item.height
    const [pageWidth, pageHeight] = landscape ? [a4[1], a4[0]] : a4
    const page = doc.addPage([pageWidth, pageHeight])
    const margin = 30
    const scale = Math.min((pageWidth - margin * 2) / embedded.width, (pageHeight - margin * 2) / embedded.height)
    const drawWidth = embedded.width * scale
    const drawHeight = embedded.height * scale
    page.drawImage(embedded, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    })
    done += 1
    onProgress?.(done / images.length)
    if (done % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return doc.save()
}

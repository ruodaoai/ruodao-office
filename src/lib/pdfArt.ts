export type SignatureInk = 'ink' | 'blue' | 'vermilion'

export type SignatureStyle = 'kai' | 'song' | 'script'

export type NoteTone = 'accent' | 'ink' | 'amber' | 'green'

export const SIGNATURE_INK_COLORS: Record<SignatureInk, string> = {
  ink: '#211f1c',
  blue: '#1f3a68',
  vermilion: '#b23a2f',
}

export const SIGNATURE_STYLE_FONTS: Record<SignatureStyle, string> = {
  kai: '"KaiTi", "STKaiti", "楷体", "Kaiti SC", serif',
  song: '"SimSun", "Songti SC", "宋体", serif',
  script: '"Segoe Script", "Brush Script MT", "KaiTi", cursive',
}

export const NOTE_TONE_COLORS: Record<NoteTone, string> = {
  accent: '#c8442b',
  ink: '#36322c',
  amber: '#a8721c',
  green: '#2f6b4f',
}

const SIGNATURE_WIDTH = 900
const SIGNATURE_HEIGHT = 300
const CAPTION_HEIGHT = 86

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建绘图画布')
  return ctx
}

function todayLabel(): string {
  const now = new Date()
  return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`
}

export function signatureCaption(signer: string): string {
  const name = signer.trim()
  return name ? `签署人：${name}   ·   ${todayLabel()}` : `本地签署   ·   ${todayLabel()}`
}

function composeSignature(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, caption: string): string {
  const canvas = createCanvas(SIGNATURE_WIDTH, SIGNATURE_HEIGHT + (caption ? CAPTION_HEIGHT : 0))
  const ctx = context2d(canvas)
  const scale = Math.min(SIGNATURE_WIDTH / Math.max(1, sourceWidth), SIGNATURE_HEIGHT / Math.max(1, sourceHeight))
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  ctx.drawImage(source, (SIGNATURE_WIDTH - drawWidth) / 2, (SIGNATURE_HEIGHT - drawHeight) / 2, drawWidth, drawHeight)
  if (caption) {
    ctx.strokeStyle = 'rgba(33, 31, 28, 0.28)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(150, SIGNATURE_HEIGHT + 10)
    ctx.lineTo(SIGNATURE_WIDTH - 150, SIGNATURE_HEIGHT + 10)
    ctx.stroke()
    ctx.fillStyle = '#4d4841'
    ctx.font = '26px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(caption, SIGNATURE_WIDTH / 2, SIGNATURE_HEIGHT + 48)
  }
  return canvas.toDataURL('image/png')
}

export function typedSignatureDataUrl(options: {
  name: string
  style: SignatureStyle
  ink: SignatureInk
  caption?: string
}): string {
  const canvas = createCanvas(SIGNATURE_WIDTH, SIGNATURE_HEIGHT)
  const ctx = context2d(canvas)
  const color = SIGNATURE_INK_COLORS[options.ink]
  const name = options.name.trim() || '签名'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = 156
  ctx.font = `600 ${size}px ${SIGNATURE_STYLE_FONTS[options.style]}`
  while (size > 64 && ctx.measureText(name).width > SIGNATURE_WIDTH - 180) {
    size -= 6
    ctx.font = `600 ${size}px ${SIGNATURE_STYLE_FONTS[options.style]}`
  }
  if (options.style === 'script') {
    ctx.font = `italic 600 ${size}px ${SIGNATURE_STYLE_FONTS[options.style]}`
  }
  ctx.fillText(name, SIGNATURE_WIDTH / 2, 154)
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.32
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(160, 236)
  ctx.lineTo(SIGNATURE_WIDTH - 160, 236)
  ctx.stroke()
  ctx.globalAlpha = 1
  return composeSignature(canvas, SIGNATURE_WIDTH, SIGNATURE_HEIGHT, options.caption ?? '')
}

export function signaturePadDataUrl(pad: HTMLCanvasElement, caption?: string): string {
  return composeSignature(pad, pad.width, pad.height, caption ?? '')
}

export function imageFileToTransparentPng(
  image: HTMLImageElement,
  stripWhite: boolean,
): { dataUrl: string; width: number; height: number } {
  const width = image.naturalWidth || 1
  const height = image.naturalHeight || 1
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  ctx.drawImage(image, 0, 0)
  if (stripWhite) {
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = frame.data
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      if (r > 228 && g > 228 && b > 228) {
        data[index + 3] = 0
      } else if (r > 200 && g > 200 && b > 200) {
        const lift = Math.min(r, g, b)
        data[index + 3] = Math.round(((255 - lift) / 55) * data[index + 3])
      }
    }
    ctx.putImageData(frame, 0, 0)
  }
  return { dataUrl: canvas.toDataURL('image/png'), width, height }
}

export function uploadedSignatureDataUrl(dataUrl: string, caption?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        resolve(composeSignature(image, image.naturalWidth, image.naturalHeight, caption ?? ''))
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = () => reject(new Error('无法读取签名图片'))
    image.src = dataUrl
  })
}

function drawArcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  start: number,
  end: number,
  size: number,
  facing: 'outward' | 'inward',
) {
  const chars = Array.from(text)
  if (!chars.length) return
  const step = chars.length > 1 ? (end - start) / (chars.length - 1) : 0
  ctx.font = `700 ${size}px "KaiTi", "STKaiti", "SimSun", serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  chars.forEach((char, index) => {
    const angle = start + step * index
    ctx.save()
    ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
    ctx.rotate(angle + (facing === 'outward' ? Math.PI / 2 : -Math.PI / 2))
    ctx.fillText(char, 0, 0)
    ctx.restore()
  })
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.beginPath()
  for (let point = 0; point < 10; point += 1) {
    const r = point % 2 === 0 ? radius : radius * 0.42
    const angle = -Math.PI / 2 + (point * Math.PI) / 5
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    if (point === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
}

export function sealDataUrl(options: { company: string; sealText: string; color: string }): string {
  const canvas = createCanvas(560, 560)
  const ctx = context2d(canvas)
  const cx = 280
  const cy = 280
  const company = options.company.trim() || '若道科技有限公司'
  const sealText = options.sealText.trim() || '合同专用章'
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.07)
  ctx.translate(-cx, -cy)
  ctx.strokeStyle = options.color
  ctx.fillStyle = options.color
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.arc(cx, cy, 232, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, 212, 0, Math.PI * 2)
  ctx.stroke()
  drawArcText(ctx, company, cx, cy, 172, Math.PI, Math.PI * 2, Math.min(46, 560 / Math.max(6, company.length) + 26), 'outward')
  drawArcText(ctx, sealText, cx, cy, 172, Math.PI, 0, 42, 'inward')
  drawStar(ctx, cx, cy, 44)
  ctx.restore()
  return canvas.toDataURL('image/png')
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  Array.from(text.replace(/\r/g, '')).forEach((char) => {
    if (char === '\n') {
      lines.push('')
      return
    }
    const last = lines.length ? lines[lines.length - 1] : ''
    if (ctx.measureText(last + char).width > maxWidth && last) {
      lines.push(char)
    } else if (lines.length) {
      lines[lines.length - 1] = last + char
    } else {
      lines.push(char)
    }
  })
  return lines.length ? lines : ['']
}

export function noteDataUrl(options: {
  text: string
  author: string
  tone: NoteTone
  date?: string
}): { dataUrl: string; width: number; height: number } {
  const width = 760
  const padding = 36
  const measure = createCanvas(10, 10)
  const measureCtx = context2d(measure)
  measureCtx.font = '28px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'
  const lines = wrapText(measureCtx, options.text.trim() || '（空白批注）', width - padding * 2 - 26).slice(0, 14)
  const bodyHeight = lines.length * 42
  const height = 116 + bodyHeight + 64
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  const color = NOTE_TONE_COLORS[options.tone]
  ctx.fillStyle = '#fffdf9'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#e6e1d6'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, width - 2, height - 2)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 8, height)
  ctx.font = '700 20px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText('批注', padding + 12, 46)
  ctx.fillStyle = '#8d8275'
  ctx.font = '16px "Segoe UI", "Microsoft YaHei", sans-serif'
  ctx.fillText('NOTE', padding + 66, 47)
  ctx.strokeStyle = '#ece7dd'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(padding + 12, 72)
  ctx.lineTo(width - padding, 72)
  ctx.stroke()
  ctx.fillStyle = '#35312b'
  ctx.font = '28px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'
  lines.forEach((line, index) => {
    ctx.fillText(line, padding + 12, 108 + index * 42)
  })
  ctx.fillStyle = '#8d8275'
  ctx.font = '18px "Microsoft YaHei", sans-serif'
  const stamp = options.date || todayLabel()
  ctx.fillText(`${options.author.trim() || '本地批注'}  ·  ${stamp}`, padding + 12, height - 32)
  return { dataUrl: canvas.toDataURL('image/png'), width, height }
}

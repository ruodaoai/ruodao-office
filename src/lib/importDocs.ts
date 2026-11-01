import type { DocSourceFile } from '../types'
import { sanitizeDocHtml } from './markdown'
import { t } from '../i18n'
import {
  bytesToBase64,
  escapeHtml,
  htmlToText,
  readFileAsArrayBuffer,
  readFileAsText,
  sha256Hex,
} from './utils'

export interface ImportedDocument {
  title: string
  html: string
  sourceDocx?: DocSourceFile
  warnings: number
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, '<br>')}</p>`)
    .filter((block) => block !== '<p></p>')
    .join('')
}

export async function importDocumentFile(file: File): Promise<ImportedDocument> {
  const lower = file.name.toLowerCase()
  const title = file.name.replace(/\.[^.]+$/, '') || t('导入的文档')
  if (lower.endsWith('.docx')) {
    const mod: unknown = await import('mammoth/mammoth.browser.js')
    const mammoth = ((mod as { default?: unknown }).default ?? mod) as {
      convertToHtml: (
        input: { arrayBuffer: ArrayBuffer },
        options?: Record<string, unknown>,
      ) => Promise<{ value: string; messages: Array<{ type: string; message: string }> }>
    }
    const buffer = await readFileAsArrayBuffer(file)
    const result = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
        ],
      },
    )
    const html = sanitizeDocHtml(result.value)
    if (!htmlToText(html) && !/<img/i.test(html)) throw new Error(t('这份 Word 文档没有可读取的内容'))
    return {
      title,
      html,
      sourceDocx: {
        name: file.name,
        type: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        dataBase64: bytesToBase64(new Uint8Array(buffer)),
        savedAt: Date.now(),
        hash: await sha256Hex(buffer),
        originHash: await sha256Hex(buffer),
        size: buffer.byteLength,
        importedHtml: html,
      },
      warnings: result.messages.filter((message) => message.type === 'warning').length,
    }
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const html = sanitizeDocHtml(await readFileAsText(file))
    return { title, html: html || '<p></p>', warnings: 0 }
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return { title, html: plainTextToHtml(await readFileAsText(file)), warnings: 0 }
  }
  if (lower.endsWith('.doc')) {
    throw new Error(t('旧版 .doc 暂不支持，请在 Word / WPS 中另存为 .docx 后打开'))
  }
  throw new Error(t('支持 .docx、.html、.txt 与 .md 文件'))
}

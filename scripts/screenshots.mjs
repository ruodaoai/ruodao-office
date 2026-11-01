import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const url = process.env.SHOT_URL || 'http://127.0.0.1:5188/'
const locale = process.env.SHOT_LOCALE === 'en' ? 'en' : 'zh-CN'
const outDir = path.resolve(process.argv[2] || (locale === 'en' ? 'screenshots/en' : 'screenshots'))
mkdirSync(outDir, { recursive: true })

const labels = {
  'zh-CN': {
    home: '工作台',
    docs: '文档',
    sheets: '表格',
    pdf: 'PDF',
    notes: '笔记',
    convert: '转换',
    ai: 'AI 助手',
    names: ['01-home', '02-docs', '03-sheets', '04-pdf', '05-notes', '06-convert', '07-ai-assistant'],
  },
  en: {
    home: 'Home',
    docs: 'Documents',
    sheets: 'Spreadsheets',
    pdf: 'PDF',
    notes: 'Notes',
    convert: 'Convert',
    ai: 'AI assistant',
    names: ['01-home', '02-docs', '03-sheets', '04-pdf', '05-notes', '06-convert', '07-ai-assistant'],
  },
}[locale]

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale,
  colorScheme: 'light',
})
await context.addInitScript(
  ([loc]) => {
    window.localStorage.setItem(
      'ruodao.locale.v1',
      JSON.stringify({ state: { locale: loc, followSystem: false }, version: 0 }),
    )
  },
  [locale],
)
const page = await context.newPage()
page.on('pageerror', (error) => console.warn('[page error]', error.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.rail-nav', { timeout: 30000 })
await page.waitForTimeout(1500)

const order = ['home', 'docs', 'sheets', 'pdf', 'notes', 'convert']

for (const [index, key] of order.entries()) {
  await page.locator(`.rail-nav button[title="${labels[key]}"]`).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(outDir, `${labels.names[index]}.png`) })
  console.log(`[shot] ${labels.names[index]}`)
}

await page.locator(`.rail-nav button[title="${labels.ai}"]`).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(outDir, '07-ai-assistant.png') })
console.log('[shot] 07-ai-assistant')

await page.keyboard.press('Escape')
await page.locator('.rail-bottom button[title]').first().click()
await page.waitForTimeout(1000)
await page.screenshot({ path: path.join(outDir, '08-settings.png') })
console.log('[shot] 08-settings')

await browser.close()
console.log(`[shot] ${locale} 输出目录 ${outDir}`)

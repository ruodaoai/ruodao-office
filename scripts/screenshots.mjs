import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const url = process.env.SHOT_URL || 'http://127.0.0.1:5175/'
const outDir = path.resolve(process.argv[2] || 'screenshots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  colorScheme: 'light',
})
const page = await context.newPage()
page.on('pageerror', (error) => console.warn('[page error]', error.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.rail-nav', { timeout: 30000 })
await page.waitForTimeout(1500)

const shots = [
  { name: '01-工作台', nav: '工作台' },
  { name: '02-文档', nav: '文档' },
  { name: '03-表格', nav: '表格' },
  { name: '04-PDF工具', nav: 'PDF' },
  { name: '05-笔记', nav: '笔记' },
  { name: '06-格式转换', nav: '转换' },
]

for (const shot of shots) {
  const button = page.locator(`.rail-nav button[title="${shot.nav}"]`)
  await button.click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(outDir, `${shot.name}.png`) })
  console.log(`[shot] ${shot.name}`)
}

// AI 助手抽屉
await page.locator('.rail-nav button[title="AI 助手"]').click()
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(outDir, '07-AI助手.png') })
console.log('[shot] 07-AI助手')

await browser.close()
console.log(`[shot] 输出目录 ${outDir}`)

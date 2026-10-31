import { chromium } from 'playwright-core'
import pngToIco from 'png-to-ico'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const svg = readFileSync('public/logo.svg', 'utf8')
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 256, height: 256 } })
const images = []

for (const size of [256, 128, 64, 48, 32, 16]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`,
  )
  images.push(await page.screenshot({ omitBackground: true }))
}

await browser.close()
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.ico', await pngToIco(images))
writeFileSync('build/icon.png', images[0])
console.log('ICON_OK')

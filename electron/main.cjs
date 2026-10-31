'use strict'

const electron = require('electron')
const { app, BrowserWindow, Menu, dialog, session, shell, screen, ipcMain } = electron
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

// 若终端注入了 ELECTRON_RUN_AS_NODE=1，electron.exe 会以纯 Node 运行，
// 这里拿不到 app 等 API。给出可读提示，避免抛 TypeError。
if (!app || !BrowserWindow) {
  console.error(
    '[ruodao] 检测到当前以纯 Node 模式运行 Electron（ELECTRON_RUN_AS_NODE 被设置）。\n' +
      '[ruodao] 请使用 npm run desktop（或 npm run dev 打开桌面端）启动，不要直接执行 electron .',
  )
  process.exit(1)
}

const DESKTOP_PORT = Number(process.env.RUODAO_DESKTOP_PORT || 47831)
const DIST_DIR = path.join(__dirname, '..', 'dist')
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico')
const DEV_URL = process.env.VITE_DEV_SERVER_URL || process.env.RUODAO_DEV_URL || ''
const STATE_FILE = 'window-state.json'

const MAX_OPEN_FILE = 200 * 1024 * 1024
const MAX_OPEN_FILES = 12
const OPEN_MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.zip': 'application/zip',
  '.cbz': 'application/vnd.comicbook+zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.epub': 'application/epub+zip',
}

let pendingOpenPaths = []
let rendererReady = false

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
}

let mainWindow = null
let server = null
let appUrl = DEV_URL
let flushInProgress = false
let flushTimer = null
let flushResolve = null

function collectOpenPaths(argv) {
  const result = []
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-')) continue
    const value = raw.replace(/^"|"$/g, '')
    try {
      if (!fs.statSync(value).isFile()) continue
    } catch {
      continue
    }
    if (!result.includes(value)) result.push(value)
  }
  return result
}

async function readOpenFile(filePath) {
  const name = path.basename(filePath)
  try {
    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) return null
    if (stat.size > MAX_OPEN_FILE) return { name, error: '超过 200MB，暂不处理' }
    const buffer = await fsp.readFile(filePath)
    return {
      name,
      type: OPEN_MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
      data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    }
  } catch {
    return { name, error: '文件无法读取' }
  }
}

async function flushOpenFiles() {
  if (!rendererReady || !mainWindow || !pendingOpenPaths.length) return
  const paths = pendingOpenPaths.splice(0, MAX_OPEN_FILES)
  const files = (await Promise.all(paths.map(readOpenFile))).filter(Boolean)
  if (!files.length || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('ruodao:open-files', files)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function queueOpenPaths(argv) {
  const paths = collectOpenPaths(argv)
  if (!paths.length) return
  pendingOpenPaths.push(...paths)
  void flushOpenFiles()
}

ipcMain.on('ruodao:renderer-ready', () => {
  rendererReady = true
  void flushOpenFiles()
})

function finishFlush() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const resolve = flushResolve
  flushResolve = null
  if (resolve) resolve()
}

function requestRendererFlush() {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      resolve()
      return
    }
    flushResolve = resolve
    flushTimer = setTimeout(finishFlush, 4000)
    try {
      mainWindow.webContents.send('ruodao:flush')
    } catch {
      finishFlush()
    }
  })
}

ipcMain.on('ruodao:flush-done', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents) finishFlush()
})

function statePath() {
  return path.join(app.getPath('userData'), STATE_FILE)
}

function readWindowState() {
  try {
    const value = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    if (typeof value?.width !== 'number' || typeof value?.height !== 'number') return null
    return value
  } catch {
    return null
  }
}

function onScreen(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      bounds.x < area.x + area.width &&
      bounds.x + 480 > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + 320 > area.y
    )
  })
}

function saveWindowState() {
  if (!mainWindow) return
  try {
    const maximized = mainWindow.isMaximized()
    const bounds = mainWindow.getNormalBounds()
    fs.writeFileSync(statePath(), JSON.stringify({ ...bounds, maximized }))
  } catch {
    /* window state is best effort */
  }
}

function staticFileFor(pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = path.resolve(DIST_DIR, relative)
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR + path.sep)) return null
  return file
}

function createStaticServer() {
  return http.createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405)
      response.end()
      return
    }
    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    let file = staticFileFor(pathname)
    if (!file) {
      response.writeHead(403)
      response.end()
      return
    }
    let body
    try {
      body = await fsp.readFile(file)
    } catch {
      if (path.extname(file)) {
        response.writeHead(404)
        response.end('Not found')
        return
      }
      file = path.join(DIST_DIR, 'index.html')
      try {
        body = await fsp.readFile(file)
      } catch {
        response.writeHead(500)
        response.end('Application files are missing. Reinstall Ruodao Office.')
        return
      }
    }
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  })
}

function listen(httpServer, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    httpServer.once('error', onError)
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.removeListener('error', onError)
      resolve()
    })
  })
}

async function startStaticServer() {
  let httpServer = createStaticServer()
  try {
    await listen(httpServer, DESKTOP_PORT)
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error
    // 默认端口被占用时退回随机空闲端口，而不是直接启动失败
    httpServer.close()
    httpServer = createStaticServer()
    await listen(httpServer, 0)
  }
  server = httpServer
  return `http://127.0.0.1:${httpServer.address().port}`
}

function openExternal(url) {
  try {
    const target = new URL(url)
    if (target.protocol === 'http:' || target.protocol === 'https:') void shell.openExternal(url)
  } catch {
    /* ignore malformed links */
  }
}

function showAbout() {
  const options = {
    type: 'info',
    title: '关于若道办公',
    message: '若道办公',
    detail: `本地优先的 Windows 办公套件\n版本 ${app.getVersion()}\n\n文档、表格、PDF 工具箱、双链笔记与若道 AI。\n所有文件默认保存在本机。`,
    buttons: ['好'],
  }
  if (mainWindow) void dialog.showMessageBox(mainWindow, options)
  else void dialog.showMessageBox(options)
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { role: 'close', label: '关闭窗口' },
        { type: 'separator' },
        { role: 'quit', label: '退出若道办公' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: '开发者工具' }]),
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于若道办公', click: showAbout },
        { label: '访问若道官网', click: () => openExternal('https://ruodao.com') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function wireDownloads() {
  session.defaultSession.on('will-download', async (event, item, contents) => {
    const owner = BrowserWindow.fromWebContents(contents) ?? mainWindow
    const defaultPath = path.join(app.getPath('downloads'), item.getFilename())
    const filters = path.extname(defaultPath)
      ? [{ name: '文件', extensions: [path.extname(defaultPath).slice(1)] }]
      : []
    try {
      item.pause()
    } catch {
      /* the download may already be complete */
    }
    const options = { title: '保存文件', defaultPath, filters }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      item.cancel()
      return
    }
    item.setSavePath(result.filePath)
    item.resume()
  })
}

async function createWindow() {
  if (!appUrl) {
    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      throw new Error('缺少前端构建产物（dist/index.html），请先执行 npm run build')
    }
    appUrl = await startStaticServer()
  }
  const saved = readWindowState()
  const useSaved = saved && typeof saved.x === 'number' && typeof saved.y === 'number' && onScreen(saved)
  mainWindow = new BrowserWindow({
    width: useSaved ? saved.width : 1440,
    height: useSaved ? saved.height : 920,
    ...(useSaved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: '若道办公',
    backgroundColor: '#f3f1ec',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  if (saved?.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  mainWindow.on('close', (event) => {
    saveWindowState()
    if (flushInProgress) {
      event.preventDefault()
      return
    }
    if (mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    flushInProgress = true
    void requestRendererFlush().then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
    })
  })
  mainWindow.on('closed', () => {
    finishFlush()
    flushInProgress = false
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== new URL(appUrl).origin) {
        event.preventDefault()
        openExternal(url)
      }
    } catch {
      event.preventDefault()
    }
  })
  await mainWindow.loadURL(appUrl)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId('com.ruodao.office.desktop')
  app.on('second-instance', (_event, argv) => {
    queueOpenPaths(argv)
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    pendingOpenPaths.push(filePath)
    void flushOpenFiles()
  })
  queueOpenPaths(process.argv)
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write')
    })
    wireDownloads()
    buildMenu()
    try {
      await createWindow()
    } catch (error) {
      dialog.showErrorBox('若道办公无法启动', String(error?.message || error))
      app.quit()
    }
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
  app.on('before-quit', () => {
    server?.close()
    server = null
  })
}

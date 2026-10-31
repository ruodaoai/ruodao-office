import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const devMode = process.argv.includes('--dev')

const electronBinary = (() => {
  try {
    // 在纯 Node 下 require('electron') 返回的是 electron.exe 的路径
    return require('electron')
  } catch {
    return ''
  }
})()

if (!electronBinary || typeof electronBinary !== 'string' || !existsSync(electronBinary)) {
  console.error('[desktop] 未找到 Electron 运行时，请先执行 npm install')
  process.exit(1)
}

/**
 * 某些终端 / 工具会注入 ELECTRON_RUN_AS_NODE=1。
 * 该变量会让 electron.exe 以纯 Node 模式启动，主进程里 require('electron')
 * 拿不到 app / BrowserWindow，启动时直接抛 TypeError，表现为「桌面端打不开」。
 * 拉起 Electron 前必须剔除。
 */
function desktopEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  return env
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const isWin = process.platform === 'win32'

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.unref()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

async function pickPort(start, attempts = 20) {
  for (let port = start; port < start + attempts; port += 1) {
    if (await isPortFree(port)) return port
  }
  return 0
}

let electron = null
let vite = null

function killTree(proc) {
  if (!proc || proc.killed || !proc.pid) return
  if (isWin) spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' })
  else proc.kill('SIGTERM')
}

function stopVite() {
  killTree(vite)
  vite = null
}

function launchElectron(extraEnv) {
  electron = spawn(electronBinary, [root], {
    cwd: root,
    stdio: 'inherit',
    env: desktopEnv(extraEnv),
  })
  electron.on('error', (error) => {
    console.error(`[desktop] 启动 Electron 失败：${error.message}`)
    stopVite()
    process.exit(1)
  })
  electron.on('exit', (code, signal) => {
    stopVite()
    process.exit(code ?? (signal ? 0 : 1))
  })
}

async function waitForServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (vite?.exitCode !== null && vite?.exitCode !== undefined) {
      throw new Error(`Vite 开发服务器已退出（code ${vite.exitCode}）`)
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return
    } catch {
      /* 还在启动 */
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('Vite 开发服务器启动超时')
}

async function runDev() {
  const preferred = Number(process.env.RUODAO_DEV_PORT || 5174)
  const port = await pickPort(Number.isFinite(preferred) && preferred > 0 ? preferred : 5174)
  const url = `http://127.0.0.1:${port}/`

  console.log(`[desktop] 启动开发服务器 ${url}`)
  vite = spawn(npmCmd, ['run', 'dev:web', '--', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
  })

  await waitForServer(url)
  console.log('[desktop] 打开桌面窗口')
  launchElectron({ VITE_DEV_SERVER_URL: url })
}

function runProd() {
  if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    console.error('[desktop] 未找到 dist/index.html，请先执行 npm run build')
    process.exit(1)
  }
  launchElectron({})
}

function shutdown() {
  killTree(electron)
  stopVite()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

try {
  if (devMode) await runDev()
  else runProd()
} catch (error) {
  console.error(`[desktop] ${error.message}`)
  stopVite()
  process.exit(1)
}

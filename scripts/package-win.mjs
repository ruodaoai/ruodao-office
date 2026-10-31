import { spawnSync } from 'node:child_process'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { createPackage } from '@electron/asar'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const builderConfig = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
const productName = pkg.productName || '若道办公'
const executableName = builderConfig.match(/^\s*executableName:\s*(\S+)/m)?.[1] || 'RuodaoOffice'
const configuredOutput = builderConfig.match(/^\s*output:\s*(\S+)/m)?.[1] || 'release-win'
const outputDir = path.join(root, configuredOutput)
const dirOnly = process.argv.includes('--dir')

const electronDist = path.dirname(require('electron'))
const icon = path.join(root, 'build', 'icon.ico')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const retry = async (label, task, attempts = 30, delay = 1000) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return task()
    } catch (error) {
      if (i === attempts - 1) throw new Error(`${label}: ${error.message}`)
      await sleep(delay)
    }
  }
}

const removeDir = async (target) => {
  await retry(`remove ${target}`, () => rmSync(target, { recursive: true, force: true }))
}

const waitUntilReadable = async (file) => {
  await retry(`wait for ${path.basename(file)}`, () => {
    const fd = openSync(file, 'r')
    closeSync(fd)
  }, 40, 1000)
  await sleep(1200)
}

const findRcedit = () => {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign')
  if (!existsSync(cache)) return null
  for (const entry of readdirSync(cache)) {
    const candidate = path.join(cache, entry, 'rcedit-x64.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

const patchExe = async (appDir) => {
  const exe = path.join(appDir, `${executableName}.exe`)
  await retry('rename executable', () => renameSync(path.join(appDir, 'electron.exe'), exe))
  const rcedit = findRcedit()
  if (!rcedit || !existsSync(icon)) return exe

  const patchPath = path.join(appDir, 'runtime-patch.exe')
  cpSync(exe, patchPath)
  const version = /^\d+\.\d+\.\d+/.test(pkg.version) ? `${pkg.version}.0` : pkg.version
  await retry('patch executable metadata', () => {
    const result = spawnSync(
      rcedit,
      [
        patchPath,
        '--set-icon',
        icon,
        '--set-file-version',
        version,
        '--set-product-version',
        pkg.version,
        '--set-version-string',
        'ProductName',
        productName,
        '--set-version-string',
        'FileDescription',
        productName,
        '--set-version-string',
        'CompanyName',
        pkg.author || 'Ruodao',
        '--set-version-string',
        'OriginalFilename',
        `${executableName}.exe`,
      ],
      { encoding: 'utf8' },
    )
    if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout)
  })
  await retry('apply patched executable', () => renameSync(patchPath, exe))
  return exe
}

const staging = mkdtempSync(path.join(os.tmpdir(), 'ruodao-office-pack-'))
const appDir = path.join(staging, 'app')
const contentDir = path.join(staging, 'content')

try {
  console.log(`[pack] staging ${appDir}`)
  cpSync(electronDist, appDir, { recursive: true })
  await removeDir(path.join(appDir, 'resources', 'default_app.asar'))
  const exe = await patchExe(appDir)

  cpSync(path.join(root, 'dist'), path.join(contentDir, 'dist'), { recursive: true })
  cpSync(path.join(root, 'electron'), path.join(contentDir, 'electron'), { recursive: true })
  mkdirSync(path.join(contentDir, 'build'), { recursive: true })
  cpSync(icon, path.join(contentDir, 'build', 'icon.ico'))
  writeFileSync(
    path.join(contentDir, 'package.json'),
    JSON.stringify(
      {
        name: pkg.name,
        productName,
        version: pkg.version,
        description: pkg.description,
        author: pkg.author,
        main: pkg.main,
      },
      null,
      2,
    ),
  )
  const asarPath = path.join(appDir, 'resources', 'app.asar')
  await createPackage(contentDir, asarPath)
  console.log(`[pack] app.asar ${(statSync(asarPath).size / 1024 / 1024).toFixed(1)} MB`)
  await waitUntilReadable(asarPath)
  await waitUntilReadable(exe)

  if (dirOnly) {
    const target = path.join(outputDir, 'win-unpacked')
    await removeDir(target)
    mkdirSync(target, { recursive: true })
    cpSync(appDir, target, { recursive: true })
    console.log(`[pack] unpacked app ${target}`)
    console.log(`[pack] executable ${path.join(target, path.basename(exe))}`)
  } else {
    try {
      await removeDir(outputDir)
    } catch (error) {
      // A running editor or indexer can keep the previous asar mapped; keep the
      // directory and let electron-builder overwrite the installer artifacts.
      console.warn(`[pack] ${error.message}`)
      for (const name of readdirSync(outputDir)) {
        if (/\.(exe|blockmap)$/.test(name)) rmSync(path.join(outputDir, name), { force: true })
      }
    }
    const { build, Platform, Arch } = require('electron-builder')
    const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget')
    const builderUtil = require('builder-util')
    const originalExec = builderUtil.exec
    builderUtil.exec = async (...params) => {
      const args = params[1]
      if (Array.isArray(args) && args.some((arg) => typeof arg === 'string' && arg.endsWith('resources/elevate.exe'))) {
        console.log('[pack] waiting for elevate.exe to settle')
        await sleep(8000)
        const cwd = params[2]?.cwd
        if (cwd) await waitUntilReadable(path.join(cwd, 'resources', 'elevate.exe')).catch(() => undefined)
      }
      return originalExec(...params)
    }
    const original = NsisTarget.prototype.computeScriptAndSignUninstaller
    NsisTarget.prototype.computeScriptAndSignUninstaller = async function (defines, ...rest) {
      const result = await original.call(this, defines, ...rest)
      const uninstaller = defines.UNINSTALLER_OUT_FILE
      if (uninstaller && existsSync(uninstaller)) {
        // Defender locks the freshly executed uninstaller while the final NSIS compile reads it.
        console.log('[pack] waiting for uninstaller to settle')
        await sleep(12000)
        await waitUntilReadable(uninstaller)
      }
      return result
    }
    await build({
      projectDir: root,
      prepackaged: appDir,
      targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64),
      publish: 'never',
    })
    const artifacts = readdirSync(outputDir).filter((name) => /\.(exe|blockmap)$/.test(name))
    for (const name of artifacts) {
      const size = statSync(path.join(outputDir, name)).size / 1024 / 1024
      console.log(`[pack] ${name} ${size.toFixed(1)} MB`)
    }
  }
} finally {
  await removeDir(staging).catch((error) => console.warn(`[pack] ${error.message}`))
}

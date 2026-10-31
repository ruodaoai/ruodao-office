import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  AlignLeft,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  Download,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileStack,
  FileText,
  Globe2,
  Image as ImageIcon,
  Loader2,
  PackageOpen,
  Play,
  RefreshCw,
  ShieldCheck,
  Table2,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import {
  convertBatch,
  DEFAULT_CONVERT_OPTIONS,
  type BatchResult,
  type ConvertOptions,
  type ConvertedOutput,
} from '../../lib/convert'
import { packArchive } from '../../lib/convert/archive'
import {
  defaultTargetFor,
  fileExtension,
  formatBytes,
  GROUP_ORDER,
  KIND_LABEL,
  kindOf,
  TARGETS,
  TARGET_MAP,
  type ConvertKind,
  type TargetGroup,
  type TargetId,
  type TargetSpec,
} from '../../lib/convert/formats'
import { cn, downloadBlob, uid } from '../../lib/utils'
import { useUI } from '../../store/ui'

interface QueueItem {
  id: string
  file: File
  kind: ConvertKind
}

type ItemState = 'idle' | 'running' | 'done' | 'error' | 'merged' | 'skipped'

interface ItemStatus {
  state: ItemState
  progress: number
  label?: string
  error?: string
  mergedInto?: string
}

interface ResultItem extends ConvertedOutput {
  id: string
  sourceName: string
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico', 'svg', 'avif'])
const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.avif,.ico,.pdf,.md,.markdown,.txt,.log,.html,.htm,.docx,.xlsx,.xls,.csv,.tsv,.json,.zip,.cbz'

const GROUP_DESC: Record<TargetGroup, string> = {
  图片: '尺寸、画质、灰度与裁剪',
  PDF: '逐页取图，或提取文字',
  文档: 'Markdown / HTML / Word / 电子书',
  表格与数据: 'Excel / CSV / JSON / 网页',
  压缩包: 'ZIP 解包或 CBZ 成册',
}

const KIND_ICON: Record<ConvertKind, typeof FileIcon> = {
  image: FileImage,
  pdf: FileStack,
  text: AlignLeft,
  docx: FileText,
  sheet: FileSpreadsheet,
  json: Braces,
  archive: Archive,
}

function stamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

function resultIcon(ext: string) {
  if (IMAGE_EXTS.has(ext)) return ImageIcon
  if (ext === 'pdf') return FileStack
  if (ext === 'zip' || ext === 'cbz') return Archive
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return FileSpreadsheet
  if (ext === 'docx') return FileText
  if (ext === 'html') return Globe2
  if (ext === 'md' || ext === 'txt') return AlignLeft
  if (ext === 'epub') return BookOpen
  return FileIcon
}

function targetLabelFor(kind: ConvertKind): string {
  return KIND_LABEL[kind]
}

export function ConvertModule() {
  const toast = useUI((s) => s.toast)
  const inputRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [targetId, setTargetId] = useState<TargetId | null>(null)
  const [options, setOptions] = useState<ConvertOptions>(DEFAULT_CONVERT_OPTIONS)
  const [status, setStatus] = useState<Record<string, ItemStatus>>({})
  const [results, setResults] = useState<ResultItem[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [packing, setPacking] = useState(false)
  const [packProgress, setPackProgress] = useState(0)
  const [downloading, setDownloading] = useState(false)

  const target: TargetSpec | null = targetId ? TARGET_MAP.get(targetId) ?? null : null
  const compatible = useMemo(
    () => (target ? queue.filter((item) => target.accepts.includes(item.kind)) : []),
    [queue, target],
  )
  const counts = useMemo(() => {
    const map = new Map<TargetId, number>()
    for (const spec of TARGETS) {
      map.set(spec.id, queue.filter((item) => spec.accepts.includes(item.kind)).length)
    }
    return map
  }, [queue])

  const groups = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      targets: TARGETS.filter(
        (spec) => spec.group === group && (queue.length === 0 || queue.some((item) => spec.accepts.includes(item.kind))),
      ),
    })).filter((group) => group.targets.length)
  }, [queue])

  useEffect(() => {
    const map: Record<string, string> = {}
    results.forEach((item) => {
      if (IMAGE_EXTS.has(item.ext)) map[item.id] = URL.createObjectURL(item.blob)
    })
    setPreviews(map)
    return () => {
      Object.values(map).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [results])

  const addFiles = (incoming: FileList | File[]) => {
    if (busy) return
    const list = Array.from(incoming)
    if (!list.length) return
    const existing = new Set(queue.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`))
    const accepted: QueueItem[] = []
    const unsupported: string[] = []
    const duplicates: string[] = []
    for (const file of list) {
      const kind = kindOf(file.name)
      if (!kind) {
        unsupported.push(file.name)
        continue
      }
      const key = `${file.name}:${file.size}:${file.lastModified}`
      if (existing.has(key)) {
        duplicates.push(file.name)
        continue
      }
      existing.add(key)
      accepted.push({ id: uid(), file, kind })
    }
    if (accepted.length) {
      const all = [...queue, ...accepted]
      setQueue(all)
      setStatus({})
      setTargetId((previous) => {
        if (previous) {
          const spec = TARGET_MAP.get(previous)
          if (spec && all.some((item) => spec.accepts.includes(item.kind))) return previous
        }
        return defaultTargetFor(Array.from(new Set(all.map((item) => item.kind))))
      })
      toast(`已加入 ${accepted.length} 个文件`, 'success')
    }
    if (unsupported.length) {
      toast(`暂不支持：${unsupported.slice(0, 2).join('、')}${unsupported.length > 2 ? ` 等 ${unsupported.length} 个文件` : ''}`, 'error')
    }
    if (duplicates.length) {
      toast(`${duplicates.length} 个文件已在队列中`, 'info')
    }
  }

  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles

  useEffect(() => {
    const onOpen = (event: Event) => {
      const incoming = (event as CustomEvent<File[]>).detail
      if (incoming?.length) addFilesRef.current(incoming)
    }
    window.addEventListener('ruodao:open-convert', onOpen)
    return () => window.removeEventListener('ruodao:open-convert', onOpen)
  }, [])

  const removeItem = (id: string) => {
    if (busy) return
    const next = queue.filter((item) => item.id !== id)
    setQueue(next)
    setStatus((previous) => {
      const copy = { ...previous }
      delete copy[id]
      return copy
    })
    if (!next.length) {
      setTargetId(null)
      return
    }
    const spec = targetId ? TARGET_MAP.get(targetId) : null
    if (!spec || !next.some((item) => spec.accepts.includes(item.kind))) {
      setTargetId(defaultTargetFor(Array.from(new Set(next.map((item) => item.kind)))))
    }
  }

  const clearQueue = () => {
    if (busy) return
    setQueue([])
    setStatus({})
    setTargetId(null)
  }

  const clearResults = () => {
    setResults([])
    setPreviews({})
  }

  const chooseTarget = (id: TargetId) => {
    if (busy) return
    setTargetId(id)
    setStatus({})
  }

  const patchOptions = (patch: Partial<ConvertOptions>) => {
    setOptions((previous) => ({ ...previous, ...patch }))
  }

  const patchImage = (patch: Partial<ConvertOptions['image']>) => {
    setOptions((previous) => ({ ...previous, image: { ...previous.image, ...patch } }))
  }

  const patchDoc = (patch: Partial<ConvertOptions['doc']>) => {
    setOptions((previous) => ({ ...previous, doc: { ...previous.doc, ...patch } }))
  }

  const run = async () => {
    if (!target || !compatible.length || busy) return
    setBusy(true)
    setResults([])
    setPreviews({})
    const initial: Record<string, ItemStatus> = {}
    compatible.forEach((item) => {
      initial[item.id] = { state: 'idle', progress: 0 }
    })
    setStatus(initial)
    try {
      const batch: BatchResult[] = await convertBatch(
        compatible.map((item) => ({ id: item.id, file: item.file })),
        target.id,
        options,
        (id, ratio, label) => {
          setStatus((previous) => {
            const current = previous[id]
            return {
              ...previous,
              [id]: {
                state: 'running',
                progress: Math.max(current?.progress ?? 0, Math.min(1, ratio)),
                label,
              },
            }
          })
        },
      )
      const flat: ResultItem[] = []
      const next: Record<string, ItemStatus> = { ...initial }
      const names = new Map(compatible.map((item) => [item.id, item.file.name]))
      for (const item of batch) {
        if (item.error) {
          next[item.id] = { state: 'error', progress: 1, error: item.error }
          continue
        }
        if (item.mergedInto) {
          next[item.id] = { state: 'merged', progress: 1, mergedInto: item.mergedInto }
          continue
        }
        if (item.skipped) {
          next[item.id] = { state: 'skipped', progress: 0, label: item.skipped }
          continue
        }
        if (item.outputs.length) next[item.id] = { state: 'done', progress: 1 }
        item.outputs.forEach((output) => {
          flat.push({ ...output, id: uid(), sourceName: names.get(item.id) ?? '' })
        })
      }
      setStatus(next)
      setResults(flat)
      if (flat.length === 1) {
        downloadBlob(flat[0].blob, flat[0].name)
        toast(`已生成 ${flat[0].name}，保存到下载目录`, 'success')
      } else if (flat.length > 1) {
        toast(`转换完成，生成 ${flat.length} 个文件`, 'success')
      } else {
        const errors = batch.filter((item) => item.error).length
        toast(errors ? '转换没有完成，请查看队列中的提示' : '没有生成任何结果', 'error')
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '转换失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const downloadResult = (item: ResultItem) => {
    downloadBlob(item.blob, item.name)
  }

  const downloadAll = async () => {
    if (!results.length || downloading) return
    if (results.length === 1) {
      downloadResult(results[0])
      return
    }
    setDownloading(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      results.forEach((item) => zip.file(item.name, item.blob))
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
      downloadBlob(blob, `若道转换结果-${stamp()}.zip`)
      toast(`已打包 ${results.length} 个结果`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '打包失败', 'error')
    } finally {
      setDownloading(false)
    }
  }

  const packQueue = async () => {
    if (!queue.length || packing || busy) return
    setPacking(true)
    setPackProgress(0)
    try {
      const blob = await packArchive(queue.map((item) => item.file), (ratio) => setPackProgress(Math.round(ratio * 100)))
      downloadBlob(blob, `若道文件包-${stamp()}.zip`)
      toast(`已打包 ${queue.length} 个文件`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '打包失败', 'error')
    } finally {
      setPacking(false)
    }
  }

  const toggleMerge = () => patchOptions({ mergeImages: !options.mergeImages })

  const totalResultSize = results.reduce((sum, item) => sum + item.blob.size, 0)
  const imageTarget = target?.group === '图片'
  const pdfImageTarget = target?.id === 'pdf-png' || target?.id === 'pdf-jpeg'
  const docPageTarget = target?.id === 'text-pdf' || target?.id === 'docx-pdf'
  const mergeable = target?.id === 'image-pdf' && queue.filter((item) => item.kind === 'image').length > 1
  const qualityVisible = target?.id === 'jpeg' || target?.id === 'webp' || target?.id === 'image-pdf'

  return (
    <div className="convert-scroll">
      <div className="convert">
        <header className="convert-hero">
          <div className="convert-eyebrow">
            <RefreshCw size={12} />
            Convert · 本地转换中心
          </div>
          <h1>
            换一种格式，
            <em>不必上传。</em>
          </h1>
          <p>
            把文件拖进队列，批量换格式。图片、PDF、Word、表格、Markdown 与压缩包都在本机处理，
            没有服务器，没有账号，也没有等待上传的进度条。
          </p>
          <div className="convert-facts">
            <span>
              <b>20</b> 种输入
            </span>
            <span>
              <b>{TARGETS.length}</b> 种输出
            </span>
            <span>
              <b>0</b> 次上传
            </span>
            <span className="convert-facts-local">
              <ShieldCheck size={13} />
              全部在本机完成
            </span>
          </div>
        </header>

        <div className="convert-grid">
          <section className="convert-panel convert-queue" aria-label="文件队列">
            <div className="convert-panel-head">
              <span className="convert-step">01</span>
              <div className="convert-panel-title">
                <h2>文件队列</h2>
                <span>{queue.length ? `${queue.length} 个文件，按顺序处理` : '支持批量，一次放入多个文件'}</span>
              </div>
              <div className="convert-panel-actions">
                {queue.length > 0 && (
                  <>
                    <button type="button" className="convert-mini" onClick={packQueue} disabled={busy || packing}>
                      {packing ? <Loader2 size={12} className="convert-spin" /> : <Archive size={12} />}
                      {packing ? `打包 ${packProgress}%` : '打包 ZIP'}
                    </button>
                    <button type="button" className="convert-mini" onClick={clearQueue} disabled={busy}>
                      清空
                    </button>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              className={cn('convert-drop', dragging && 'is-dragging', queue.length > 0 && 'is-compact')}
              data-file-drop="local"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              onDragEnter={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                addFiles(event.dataTransfer.files)
              }}
            >
              <span className="convert-drop-icon">
                <UploadCloud size={queue.length ? 18 : 24} />
              </span>
              <span className="convert-drop-copy">
                <strong>{dragging ? '松手，加入队列' : queue.length ? '继续添加文件' : '拖入文件，或点击选择'}</strong>
                {!queue.length && <span>图片 · PDF · Word · 表格 · Markdown · ZIP，全部在本地处理</span>}
              </span>
              {!queue.length && <span className="convert-drop-plus">+</span>}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              hidden
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files)
                event.target.value = ''
              }}
            />

            {queue.length === 0 ? (
              <div className="convert-inputs">
                <div className="convert-inputs-title">可以放入</div>
                <div className="convert-inputs-list">
                  {[
                    ['图片', 'PNG / JPEG / WebP / GIF / BMP / SVG / AVIF / ICO'],
                    ['PDF', '逐页取图、提取文字、转 Word'],
                    ['文档', 'Word / Markdown / HTML / TXT / EPUB'],
                    ['表格', 'Excel / XLS / CSV / TSV / JSON'],
                    ['压缩包', 'ZIP / CBZ 解包或成册'],
                  ].map(([label, text]) => (
                    <div key={label} className="convert-input-row">
                      <span>{label}</span>
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
                <p className="convert-inputs-note">旧版 .doc / .ppt、CAD、音视频暂不处理；扫描版 PDF 请先用 PDF 工具箱做 OCR。</p>
              </div>
            ) : (
              <div className="convert-list">
                {queue.map((item, index) => {
                  const Icon = KIND_ICON[item.kind]
                  const compatibleWithTarget = target ? target.accepts.includes(item.kind) : false
                  const state = status[item.id]
                  const progress = Math.round((state?.progress ?? 0) * 100)
                  return (
                    <div key={item.id} className={cn('convert-item', !compatibleWithTarget && 'is-muted', state?.state === 'error' && 'has-error')}>
                      <span className="convert-item-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className={cn('convert-item-kind', `is-${item.kind}`)}>
                        <Icon size={15} />
                      </span>
                      <div className="convert-item-main">
                        <div className="convert-item-name" title={item.file.name}>
                          {item.file.name}
                        </div>
                        <div className="convert-item-meta">
                          <span>{targetLabelFor(item.kind)}</span>
                          <span className="convert-dot" />
                          <span>{formatBytes(item.file.size)}</span>
                          {state?.state === 'running' && (
                            <>
                              <span className="convert-dot" />
                              <span className="convert-running">
                                {progress}%{state.label ? ` · ${state.label}` : ''}
                              </span>
                            </>
                          )}
                          {state?.state === 'done' && (
                            <>
                              <span className="convert-dot" />
                              <span className="convert-success">已生成</span>
                            </>
                          )}
                          {state?.state === 'merged' && (
                            <>
                              <span className="convert-dot" />
                              <span className="convert-success">已合并</span>
                            </>
                          )}
                          {state?.state === 'error' && (
                            <>
                              <span className="convert-dot" />
                              <span className="convert-failure">失败</span>
                            </>
                          )}
                          {!state && !compatibleWithTarget && (
                            <>
                              <span className="convert-dot" />
                              <span>不适用于当前输出</span>
                            </>
                          )}
                        </div>
                        {state?.state === 'running' && (
                          <div className="convert-progress" aria-hidden="true">
                            <i style={{ width: `${progress}%` }} />
                          </div>
                        )}
                        {state?.error && <div className="convert-item-error">{state.error}</div>}
                        {state?.mergedInto && <div className="convert-item-error is-merged">已合并进 {state.mergedInto}</div>}
                      </div>
                      <span className="convert-item-target">
                        {compatibleWithTarget && target ? `.${target.ext}` : '—'}
                      </span>
                      <button
                        type="button"
                        className="convert-item-remove"
                        aria-label={`移除 ${item.file.name}`}
                        onClick={() => removeItem(item.id)}
                        disabled={busy}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="convert-panel convert-target-panel" aria-label="输出格式">
            <div className="convert-panel-head">
              <span className="convert-step">02</span>
              <div className="convert-panel-title">
                <h2>输出格式</h2>
                <span>{queue.length ? '只显示与队列匹配的格式' : '放入文件后，可用格式会亮起'}</span>
              </div>
            </div>

            <div className="convert-targets">
              {groups.map(({ group, targets }) => (
                <div key={group} className="convert-group">
                  <div className="convert-group-head">
                    <span>{group}</span>
                    <span>{GROUP_DESC[group]}</span>
                  </div>
                  <div className="convert-tiles">
                    {targets.map((spec) => {
                      const count = counts.get(spec.id) ?? 0
                      const active = targetId === spec.id
                      return (
                        <button
                          key={spec.id}
                          type="button"
                          className={cn('convert-tile', active && 'is-active')}
                          onClick={() => chooseTarget(spec.id)}
                          disabled={count === 0 || busy}
                          title={spec.hint}
                          aria-pressed={active}
                        >
                          <span className="convert-tile-ext">.{spec.ext}</span>
                          <span className="convert-tile-label">{spec.label}</span>
                          <span className="convert-tile-count">{count ? `${count} 个` : '—'}</span>
                          {active && (
                            <span className="convert-tile-check">
                              <Check size={11} />
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {target && (
              <div className="convert-selected">
                <span className="convert-selected-ext">.{target.ext}</span>
                <span>{target.hint}</span>
                <span className="convert-selected-count">{compatible.length} 个文件可用</span>
              </div>
            )}

            {target && queue.length > 0 && (
              <div className="convert-options">
                <div className="convert-options-head">
                  <span>选项</span>
                  <span>仅作用于本次转换</span>
                </div>

                {imageTarget && (
                  <>
                    {target.id !== 'ico' && (
                      <>
                        <div className="convert-option">
                          <span className="convert-option-label">最长边</span>
                          <div className="convert-seg">
                            {[
                              { value: 0, label: '原图' },
                              { value: 3840, label: '3840' },
                              { value: 2560, label: '2560' },
                              { value: 1920, label: '1920' },
                              { value: 1280, label: '1280' },
                              { value: 800, label: '800' },
                            ].map((item) => (
                              <button
                                key={item.value}
                                type="button"
                                className={cn(options.image.maxEdge === item.value && 'is-active')}
                                onClick={() => patchImage({ maxEdge: item.value })}
                                disabled={busy}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="convert-option">
                          <span className="convert-option-label">裁剪</span>
                          <select
                            value={options.image.crop}
                            onChange={(event) => patchImage({ crop: event.target.value as ConvertOptions['image']['crop'] })}
                            disabled={busy}
                          >
                            <option value="none">保持原比例</option>
                            <option value="1:1">居中 1:1</option>
                            <option value="4:3">居中 4:3</option>
                            <option value="16:9">居中 16:9</option>
                            <option value="3:4">居中 3:4</option>
                          </select>
                        </div>
                      </>
                    )}
                    {qualityVisible && (
                      <label className="convert-slider">
                        <span className="convert-option-label">画质</span>
                        <input
                          type="range"
                          min={55}
                          max={100}
                          value={Math.round(options.image.quality * 100)}
                          onChange={(event) => patchImage({ quality: Number(event.target.value) / 100 })}
                          disabled={busy}
                        />
                        <span className="convert-slider-value">{Math.round(options.image.quality * 100)}%</span>
                      </label>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={options.image.grayscale}
                      className={cn('convert-switch', options.image.grayscale && 'is-on')}
                      onClick={() => patchImage({ grayscale: !options.image.grayscale })}
                      disabled={busy}
                    >
                      <span>
                        转为灰度
                        <small>适合扫描件与打印稿</small>
                      </span>
                      <i />
                    </button>
                    {mergeable && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={options.mergeImages}
                        className={cn('convert-switch', options.mergeImages && 'is-on')}
                        onClick={toggleMerge}
                        disabled={busy}
                      >
                        <span>
                          合并为一份 PDF
                          <small>关闭则每张图片单独成册</small>
                        </span>
                        <i />
                      </button>
                    )}
                  </>
                )}

                {pdfImageTarget && (
                  <div className="convert-option">
                    <span className="convert-option-label">渲染倍率</span>
                    <div className="convert-seg">
                      {[1, 2, 3].map((scale) => (
                        <button
                          key={scale}
                          type="button"
                          className={cn(options.pdfScale === scale && 'is-active')}
                          onClick={() => patchOptions({ pdfScale: scale })}
                          disabled={busy}
                        >
                          {scale}×
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {docPageTarget && (
                  <>
                    <div className="convert-option">
                      <span className="convert-option-label">页面</span>
                      <div className="convert-seg">
                        <button
                          type="button"
                          className={cn(options.doc.pageSize === 'a4' && 'is-active')}
                          onClick={() => patchDoc({ pageSize: 'a4' })}
                          disabled={busy}
                        >
                          A4
                        </button>
                        <button
                          type="button"
                          className={cn(options.doc.pageSize === 'letter' && 'is-active')}
                          onClick={() => patchDoc({ pageSize: 'letter' })}
                          disabled={busy}
                        >
                          Letter
                        </button>
                      </div>
                    </div>
                    <div className="convert-option">
                      <span className="convert-option-label">正文字号</span>
                      <div className="convert-seg">
                        {[
                          { value: 14, label: '紧凑' },
                          { value: 15.5, label: '标准' },
                          { value: 17, label: '宽松' },
                        ].map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            className={cn(options.doc.fontSize === item.value && 'is-active')}
                            onClick={() => patchDoc({ fontSize: item.value })}
                            disabled={busy}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {!imageTarget && !pdfImageTarget && !docPageTarget && (
                  <p className="convert-options-note">
                    {target.group === '表格与数据'
                      ? '多工作表会自动分表；CSV 多于一张表时打包成 ZIP。'
                      : target.group === '压缩包'
                        ? '解包结果会逐项列在结果区；CBZ 按文件名顺序合成 PDF。'
                        : '这个格式不需要额外参数。'}
                  </p>
                )}
              </div>
            )}

            <div className="convert-run-area">
              <button
                type="button"
                className="convert-run"
                onClick={run}
                disabled={!target || !compatible.length || busy}
              >
                {busy ? <Loader2 size={15} className="convert-spin" /> : <Play size={15} />}
                {busy ? '正在本地转换…' : compatible.length ? `转换 ${compatible.length} 个文件` : target ? '当前格式不适用' : '选择输出格式'}
                {!busy && compatible.length > 0 && <ArrowRight size={14} />}
              </button>
              <span className="convert-run-hint">
                <ShieldCheck size={11} />
                单文件自动保存；多个结果可在下方一并下载
              </span>
            </div>
          </section>
        </div>

        {results.length > 0 && (
          <section className="convert-results" aria-label="转换结果">
            <div className="convert-results-head">
              <span className="convert-step">03</span>
              <div className="convert-panel-title">
                <h2>取回结果</h2>
                <span>
                  {results.length} 个文件 · {formatBytes(totalResultSize)}
                </span>
              </div>
              <div className="convert-results-actions">
                <button type="button" className="convert-mini is-strong" onClick={downloadAll} disabled={downloading}>
                  {downloading ? <Loader2 size={12} className="convert-spin" /> : <Download size={12} />}
                  {results.length > 1 ? '全部打包下载' : '下载'}
                </button>
                <button type="button" className="convert-mini" onClick={clearResults}>
                  <Trash2 size={12} />
                  清空结果
                </button>
              </div>
            </div>
            <div className="convert-results-grid">
              {results.map((item) => {
                const Icon = resultIcon(item.ext)
                return (
                  <article key={item.id} className="convert-result">
                    <div className={cn('convert-result-preview', IMAGE_EXTS.has(item.ext) && 'has-image')}>
                      {previews[item.id] ? (
                        <img src={previews[item.id]} alt={item.name} />
                      ) : (
                        <Icon size={22} />
                      )}
                    </div>
                    <div className="convert-result-main">
                      <div className="convert-result-name" title={item.name}>
                        {item.name}
                      </div>
                      <div className="convert-result-meta">
                        <span className="convert-result-ext">.{item.ext}</span>
                        <span>{formatBytes(item.blob.size)}</span>
                        {item.note && <span>{item.note}</span>}
                      </div>
                      {item.sourceName && <div className="convert-result-source">来自 {item.sourceName}</div>}
                    </div>
                    <button
                      type="button"
                      className="convert-result-download"
                      onClick={() => downloadResult(item)}
                      aria-label={`下载 ${item.name}`}
                      title="下载"
                    >
                      <Download size={15} />
                    </button>
                  </article>
                )
              })}
            </div>
          </section>
        )}

        <footer className="convert-foot">
          <div>
            <span className="convert-foot-mark">LOCAL ONLY</span>
            <p>
              浏览器与桌面端都在本机处理文件。转换结果直接写入下载目录，不上传、不留副本。
              需要合并、压缩、签章或 OCR 时，前往 PDF 工具箱。
            </p>
          </div>
          <div className="convert-foot-badges">
            <span>
              <FileImage size={12} /> 图片
            </span>
            <span>
              <FileSpreadsheet size={12} /> 表格
            </span>
            <span>
              <BookOpen size={12} /> 电子书
            </span>
            <span>
              <PackageOpen size={12} /> 压缩包
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}

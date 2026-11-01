import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Eraser, ImageUp, PenLine, ShieldCheck, Stamp, Type } from 'lucide-react'
import { Modal } from '../../components/ui'
import type { PdfImagePlacement } from '../../lib/pdf'
import {
  SIGNATURE_INK_COLORS,
  imageFileToTransparentPng,
  sealDataUrl,
  signatureCaption,
  signaturePadDataUrl,
  typedSignatureDataUrl,
  uploadedSignatureDataUrl,
  type SignatureInk,
  type SignatureStyle,
} from '../../lib/pdfArt'
import { cn } from '../../lib/utils'
import { useT } from '../../i18n'

export type SignatureScope = 'selection' | 'all' | 'last' | 'first'

interface SignatureStudioProps {
  open: boolean
  busy: boolean
  pageCount: number
  selectedCount: number
  onClose: () => void
  onApply: (payload: {
    dataUrl: string
    place: PdfImagePlacement
    widthRatio: number
    opacity: number
    scope: SignatureScope
  }) => void
}

type SourceMode = 'draw' | 'type' | 'upload' | 'seal'

const MODES: Array<{ id: SourceMode; label: string; icon: typeof PenLine }> = [
  { id: 'draw', label: '手写', icon: PenLine },
  { id: 'type', label: '键入', icon: Type },
  { id: 'upload', label: '上传', icon: ImageUp },
  { id: 'seal', label: '印章', icon: Stamp },
]

const PLACES: Array<{ id: PdfImagePlacement; label: string }> = [
  { id: 'bottom-right', label: '右下角' },
  { id: 'bottom-left', label: '左下角' },
  { id: 'bottom-center', label: '底部居中' },
  { id: 'top-right', label: '右上角' },
  { id: 'top-left', label: '左上角' },
  { id: 'center', label: '页面居中' },
]

export function SignatureStudio({ open, busy, pageCount, selectedCount, onClose, onApply }: SignatureStudioProps) {
  const t = useT()
  const [mode, setMode] = useState<SourceMode>('draw')
  const [ink, setInk] = useState<SignatureInk>('ink')
  const [hasInk, setHasInk] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [typedStyle, setTypedStyle] = useState<SignatureStyle>('kai')
  const [uploaded, setUploaded] = useState<{ name: string; dataUrl: string } | null>(null)
  const [uploadedPng, setUploadedPng] = useState<string | null>(null)
  const [stripWhite, setStripWhite] = useState(true)
  const [sealCompany, setSealCompany] = useState(t('若道科技有限公司'))
  const [sealText, setSealText] = useState(t('合同专用章'))
  const [sealColor, setSealColor] = useState('#c0392b')
  const [showCaption, setShowCaption] = useState(true)
  const [signer, setSigner] = useState('')
  const [place, setPlace] = useState<PdfImagePlacement>('bottom-right')
  const [widthRatio, setWidthRatio] = useState(0.28)
  const [opacity, setOpacity] = useState(0.95)
  const [scope, setScope] = useState<SignatureScope>('last')

  const padRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const caption = showCaption && mode !== 'seal' ? signatureCaption(signer) : ''

  const typedPreview = useMemo(
    () => typedSignatureDataUrl({ name: typedName || t('签名'), style: typedStyle, ink, caption }),
    [typedName, typedStyle, ink, caption, t],
  )
  const sealPreview = useMemo(
    () => sealDataUrl({ company: sealCompany, sealText, color: sealColor }),
    [sealCompany, sealText, sealColor],
  )
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!uploaded) {
      setUploadedPng(null)
      return
    }
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      try {
        setUploadedPng(imageFileToTransparentPng(image, stripWhite).dataUrl)
      } catch {
        setUploadedPng(null)
      }
    }
    image.src = uploaded.dataUrl
    return () => {
      cancelled = true
    }
  }, [uploaded, stripWhite])

  useEffect(() => {
    if (!uploadedPng) {
      setUploadPreview(null)
      return
    }
    let cancelled = false
    uploadedSignatureDataUrl(uploadedPng, caption)
      .then((url) => {
        if (!cancelled) setUploadPreview(url)
      })
      .catch(() => {
        if (!cancelled) setUploadPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [uploadedPng, caption])

  useEffect(() => {
    if (!open) return
    setHasInk(false)
    setScope(selectedCount ? 'selection' : 'last')
    const canvas = padRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [open, selectedCount])

  useEffect(() => {
    if (mode === 'draw') return
    setHasInk(false)
    lastPointRef.current = null
  }, [mode])

  const padPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = padRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    }
  }

  const strokeTo = (point: { x: number; y: number }) => {
    const canvas = padRef.current
    const last = lastPointRef.current
    if (!canvas || !last) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = SIGNATURE_INK_COLORS[ink]
    ctx.lineWidth = 4.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
  }

  const clearPad = () => {
    const canvas = padRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
    setHasInk(false)
    lastPointRef.current = null
  }

  const pickUpload = (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setUploaded({ name: file.name, dataUrl: reader.result })
    }
    reader.readAsDataURL(file)
  }

  const resolveDataUrl = async (): Promise<string | null> => {
    if (mode === 'draw') {
      if (!hasInk || !padRef.current) return null
      return signaturePadDataUrl(padRef.current, caption)
    }
    if (mode === 'type') return typedPreview
    if (mode === 'seal') return sealPreview
    return uploadPreview
  }

  const apply = async () => {
    const dataUrl = await resolveDataUrl()
    if (!dataUrl) return
    onApply({ dataUrl, place, widthRatio, opacity, scope })
    onClose()
  }

  const canApply = !busy && (mode !== 'draw' || hasInk) && (mode !== 'upload' || Boolean(uploadPreview))
  const scopeLabel =
    scope === 'all'
      ? t('全部 {count} 页', { count: pageCount })
      : scope === 'last'
        ? t('仅最后一页')
        : scope === 'first'
          ? t('仅第一页')
          : t('所选 {count} 页', { count: selectedCount })

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={920}
      className="signature-studio-modal"
      title={t('电子签名台')}
      description={t('签名会作为矢量页面的图片图层写入本地 PDF · 当前文件 {count} 页', { count: pageCount })}
      footer={
        <div className="signature-foot">
          <span className="signature-foot-note">
            <ShieldCheck size={13} />
            {t('不上传、不留存，关闭后即从内存清除')}
          </span>
          <div className="signature-foot-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              {t('取消')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void apply()} disabled={!canApply}>
              <PenLine size={13} />
              {t('写入 PDF')}
            </button>
          </div>
        </div>
      }
    >
      <div className="signature-studio">
        <section className="signature-stage">
          <div className="signature-modes" role="tablist" aria-label={t('签名来源')}>
            {MODES.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === item.id}
                  className={cn('signature-mode', mode === item.id && 'active')}
                  onClick={() => setMode(item.id)}
                >
                  <Icon size={14} />
                  {t(item.label)}
                </button>
              )
            })}
          </div>

          <div className="signature-canvas-area">
            {mode === 'draw' ? (
              <div className={cn('signature-pad-shell', hasInk && 'is-signed')}>
                <canvas
                  ref={padRef}
                  width={900}
                  height={300}
                  className="signature-pad"
                  aria-label={t('手写签名画板')}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    drawingRef.current = true
                    const point = padPoint(event)
                    lastPointRef.current = point
                    const ctx = padRef.current?.getContext('2d')
                    if (ctx) {
                      ctx.fillStyle = SIGNATURE_INK_COLORS[ink]
                      ctx.beginPath()
                      ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2)
                      ctx.fill()
                    }
                    setHasInk(true)
                  }}
                  onPointerMove={(event) => {
                    if (!drawingRef.current) return
                    strokeTo(padPoint(event))
                  }}
                  onPointerUp={() => {
                    drawingRef.current = false
                    lastPointRef.current = null
                  }}
                  onPointerLeave={() => {
                    drawingRef.current = false
                    lastPointRef.current = null
                  }}
                />
                {!hasInk ? <span className="signature-pad-hint">{t('用鼠标或触控笔在此签名')}</span> : null}
                <span className="signature-pad-line" aria-hidden />
              </div>
            ) : null}

            {mode === 'type' ? (
              <div className="signature-preview signature-preview-type">
                <img src={typedPreview} alt={t('键入签名预览')} />
              </div>
            ) : null}

            {mode === 'upload' ? (
              <div className="signature-upload-area">
                {uploadPreview ? (
                  <div className="signature-preview">
                    <img src={uploadPreview} alt={t('上传签名预览')} />
                  </div>
                ) : (
                  <button type="button" className="signature-upload-empty" onClick={() => uploadInputRef.current?.click()}>
                    <ImageUp size={22} />
                    <strong>{t('上传签名图片')}</strong>
                    <span>{t('PNG 透明底最佳，JPG 白底会自动提透')}</span>
                  </button>
                )}
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => {
                    pickUpload(event.currentTarget.files?.[0] ?? null)
                    event.currentTarget.value = ''
                  }}
                />
                <button type="button" className="btn btn-secondary btn-sm btn-block" onClick={() => uploadInputRef.current?.click()}>
                  <ImageUp size={12} />
                  {uploaded ? t('更换图片') : t('选择图片')}
                </button>
                {uploaded ? (
                  <label className="pdf-check">
                    <input type="checkbox" checked={stripWhite} onChange={(event) => setStripWhite(event.target.checked)} />
                    {t('自动去除白色背景')}
                  </label>
                ) : null}
              </div>
            ) : null}

            {mode === 'seal' ? (
              <div className="signature-preview signature-preview-seal">
                <img src={sealPreview} alt={t('电子印章预览')} />
              </div>
            ) : null}
          </div>

          {mode === 'draw' ? (
            <div className="signature-stage-bar">
              <div className="signature-inks" aria-label={t('墨色')}>
                {(Object.keys(SIGNATURE_INK_COLORS) as SignatureInk[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cn('signature-ink', ink === item && 'active')}
                    style={{ background: SIGNATURE_INK_COLORS[item] }}
                    title={item === 'ink' ? t('墨黑') : item === 'blue' ? t('钢蓝') : t('朱红')}
                    aria-label={t('墨色 {color}', { color: item })}
                    onClick={() => setInk(item)}
                  />
                ))}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearPad} disabled={!hasInk}>
                <Eraser size={12} />
                {t('清除重写')}
              </button>
            </div>
          ) : null}

          {mode === 'type' ? (
            <div className="signature-type-fields">
              <input
                className="input"
                value={typedName}
                maxLength={12}
                placeholder={t('输入姓名或签名文字')}
                onChange={(event) => setTypedName(event.target.value)}
              />
              <select
                className="select"
                value={typedStyle}
                onChange={(event) => setTypedStyle(event.target.value as SignatureStyle)}
                aria-label={t('签名笔体')}
              >
                <option value="kai">{t('楷体手写')}</option>
                <option value="song">{t('宋体')}</option>
                <option value="script">{t('英文花体')}</option>
              </select>
            </div>
          ) : null}

          {mode === 'seal' ? (
            <div className="signature-type-fields signature-seal-fields">
              <input
                className="input"
                value={sealCompany}
                maxLength={22}
                placeholder={t('单位名称')}
                onChange={(event) => setSealCompany(event.target.value)}
              />
              <div className="signature-seal-row">
                <input
                  className="input"
                  value={sealText}
                  maxLength={8}
                  placeholder={t('印章文字')}
                  onChange={(event) => setSealText(event.target.value)}
                />
                {['#c0392b', '#b23a2f', '#1f3a68'].map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn('pdf-swatch', sealColor === color && 'active')}
                    style={{ background: color }}
                    title={color}
                    aria-label={t('印章颜色 {color}', { color })}
                    onClick={() => setSealColor(color)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="signature-stage-preview">
            <div className="signature-mini-page">
              <span className="signature-mini-head" />
              <span className="signature-mini-line" />
              <span className="signature-mini-line short" />
              <span className="signature-mini-line" />
              <span className="signature-mini-line short" />
              <span
                className={cn('signature-mini-stamp', `at-${place}`)}
                style={{
                  width: `${Math.round(widthRatio * 100)}%`,
                  height: `${Math.round(widthRatio * 100 * (mode === 'seal' ? 0.72 : 0.36))}%`,
                  opacity,
                  backgroundImage: `url(${mode === 'type' ? typedPreview : mode === 'seal' ? sealPreview : uploadPreview ?? ''})`,
                }}
              >
                {mode === 'draw' ? <span className="signature-mini-scribble" aria-hidden /> : null}
              </span>
            </div>
            <div className="signature-stage-preview-body">
              <div className="signature-control-title">{t('落点预览')}</div>
              <p>
                {t('{place} · 宽 {width}% · 浓度 {opacity}%', {
                  place: t(PLACES.find((item) => item.id === place)?.label ?? '右下角'),
                  width: Math.round(widthRatio * 100),
                  opacity: Math.round(opacity * 100),
                })}
              </p>
              <p>{t('写入范围：{scope}', { scope: scopeLabel })}</p>
              <small>{t('示意图按 A4 比例换算，实际落点以页边距 42pt 计算。')}</small>
            </div>
          </div>
        </section>

        <aside className="signature-controls">
          <div className="signature-control-group">
            <div className="signature-control-title">{t('落地位置')}</div>
            <div className="signature-place-grid">
              {PLACES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn('signature-place', place === item.id && 'active')}
                  onClick={() => setPlace(item.id)}
                >
                  <span className={`signature-place-dot place-${item.id}`} aria-hidden />
                  {t(item.label)}
                </button>
              ))}
            </div>
            <label className="pdf-range">
              <span>{t('宽度')}</span>
              <input
                type="range"
                min={14}
                max={52}
                value={Math.round(widthRatio * 100)}
                onChange={(event) => setWidthRatio(Number(event.target.value) / 100)}
              />
              <em>{Math.round(widthRatio * 100)}%</em>
            </label>
            <label className="pdf-range">
              <span>{t('浓度')}</span>
              <input
                type="range"
                min={45}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(event) => setOpacity(Number(event.target.value) / 100)}
              />
              <em>{Math.round(opacity * 100)}%</em>
            </label>
          </div>

          <div className="signature-control-group">
            <div className="signature-control-title">{t('写入范围')}</div>
            <select
              className="select"
              value={scope}
              aria-label={t('签名写入范围')}
              onChange={(event) => setScope(event.target.value as SignatureScope)}
            >
              <option value="last">{t('仅最后一页')}</option>
              <option value="first">{t('仅第一页')}</option>
              <option value="selection" disabled={!selectedCount}>
                {t('所选页面（{count} 页）', { count: selectedCount })}
              </option>
              <option value="all">{t('全部 {count} 页', { count: pageCount })}</option>
            </select>
            <p className="hint">
              {scope === 'selection' && !selectedCount
                ? t('尚未在图库中选择页面，将回退到最后一页。')
                : t('批量盖章可选择全部页面；签署合同通常落在最后一页。')}
            </p>
          </div>

          {mode !== 'seal' ? (
            <div className="signature-control-group">
              <div className="signature-control-title">{t('签署信息')}</div>
              <label className="pdf-check">
                <input type="checkbox" checked={showCaption} onChange={(event) => setShowCaption(event.target.checked)} />
                {t('在签名下方注明签署人与日期')}
              </label>
              {showCaption ? (
                <input
                  className="input"
                  value={signer}
                  maxLength={16}
                  placeholder={t('签署人姓名（可留空）')}
                  onChange={(event) => setSigner(event.target.value)}
                />
              ) : null}
              <p className="hint">{t('日期取本机时间，只写入 PDF 图层，不生成任何在线证书。')}</p>
            </div>
          ) : null}

          <div className="signature-target">
            <Stamp size={13} />
            <span>{t('将写入：{scope}', { scope: scopeLabel })}</span>
          </div>
        </aside>
      </div>
    </Modal>
  )
}

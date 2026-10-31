import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Cloud,
  Database,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Info,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
} from 'lucide-react'
import type { AiConfig, LibrarySnapshot } from '../types'
import { AI_PRESETS, presetOf, testConnection } from '../lib/ai'
import { useSettings } from '../lib/settings'
import { clearLibrary, exportBackup } from '../lib/db'
import { cn, downloadText, formatDateTime, readFileAsText } from '../lib/utils'
import { useAuth, displayNameOf } from '../store/auth'
import { useLibrary } from '../store/library'
import { useUI, type SettingsTab } from '../store/ui'
import { ConfirmDialog, Logo, Modal } from './ui'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'ai', label: 'AI 助手' },
  { id: 'data', label: '数据与隐私' },
  { id: 'about', label: '关于与开源' },
]

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen)
  const tab = useUI((s) => s.settingsTab)
  const setTab = useUI((s) => s.setSettingsTab)
  const close = useUI((s) => s.closeSettings)
  const toast = useUI((s) => s.toast)
  const setAccountOpen = useUI((s) => s.setAccountOpen)
  const savedAi = useSettings((s) => s.ai)
  const updateAi = useSettings((s) => s.updateAi)
  const session = useAuth((s) => s.session)
  const cloudModels = useAuth((s) => s.models)
  const cloudModelsLoading = useAuth((s) => s.modelsLoading)
  const cloudModelsError = useAuth((s) => s.modelsError)
  const loadCloudModels = useAuth((s) => s.loadModels)

  const docs = useLibrary((s) => s.docs)
  const sheets = useLibrary((s) => s.sheets)
  const notes = useLibrary((s) => s.notes)
  const replaceAll = useLibrary((s) => s.replaceAll)
  const clearAll = useLibrary((s) => s.clearAll)

  const [draft, setDraft] = useState<AiConfig>(savedAi)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pendingImport, setPendingImport] = useState<LibrarySnapshot | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setDraft(savedAi)
      setTestResult(null)
    }
  }, [open, savedAi])

  const cloud = draft.provider === 'ruodao'

  useEffect(() => {
    if (open && cloud && session && !cloudModels.length && !cloudModelsLoading) {
      void loadCloudModels().catch(() => undefined)
    }
  }, [open, cloud, session, cloudModels.length, cloudModelsLoading, loadCloudModels])

  useEffect(() => {
    if (!cloud || !cloudModels.length) return
    if (!draft.model || !cloudModels.some((model) => model.modelName === draft.model)) {
      setDraft((current) => ({ ...current, model: cloudModels[0].modelName }))
    }
  }, [cloud, cloudModels, draft.model])

  const stats = { docs: docs.length, sheets: sheets.length, notes: notes.length }
  const sizeBytes = new Blob([JSON.stringify(useLibrary.getState().snapshot())]).size
  const sizeLabel = sizeBytes > 1024 * 1024 ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`

  const selectProvider = (id: AiConfig['provider']) => {
    const preset = presetOf(id)
    if (!preset) return
    if (id === 'ruodao') {
      setDraft({
        provider: id,
        baseUrl: '',
        model: cloudModels[0]?.modelName ?? '',
        apiKey: '',
      })
      if (session && !cloudModels.length) void loadCloudModels().catch(() => undefined)
    } else {
      setDraft({
        provider: id,
        baseUrl: preset.baseUrl,
        model: preset.model,
        apiKey: id === 'ollama' ? '' : draft.provider === id ? draft.apiKey : '',
      })
    }
    setTestResult(null)
  }

  const saveAi = () => {
    if (draft.provider === 'ruodao') {
      if (!session) {
        toast('请先登录若道账户', 'error')
        return
      }
      if (!draft.model.trim()) {
        toast('请选择一个云端模型', 'error')
        return
      }
      updateAi({ ...draft, baseUrl: '', apiKey: '' })
      toast('已切换到若道云端模型', 'success')
      return
    }
    if (!draft.baseUrl.trim() || !draft.model.trim()) {
      toast('请填写 API 地址与模型名称', 'error')
      return
    }
    updateAi(draft)
    toast('AI 配置已保存', 'success')
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      await testConnection(draft)
      setTestResult({ ok: true, message: '连接成功，可以开始对话' })
    } catch (error) {
      setTestResult({ ok: false, message: (error as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const doExport = async () => {
    const backup = await exportBackup(useLibrary.getState().snapshot())
    downloadText(JSON.stringify(backup, null, 2), `若道办公-备份-${new Date().toISOString().slice(0, 10)}.json`, 'application/json')
    toast('备份已导出到下载目录', 'success')
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await readFileAsText(file)
      const raw = JSON.parse(text)
      if (raw?.app !== 'ruodao-office' || !Array.isArray(raw.docs) || !Array.isArray(raw.sheets) || !Array.isArray(raw.notes)) {
        throw new Error('不是有效的若道办公备份')
      }
      const snapshot: LibrarySnapshot = {
        docs: raw.docs,
        sheets: raw.sheets,
        notes: raw.notes,
        activeDocId: raw.activeDocId ?? raw.docs[0]?.id ?? null,
        activeSheetId: raw.activeSheetId ?? raw.sheets[0]?.id ?? null,
        activeNoteId: raw.activeNoteId ?? raw.notes[0]?.id ?? null,
      }
      setPendingImport(snapshot)
    } catch (error) {
      toast((error as Error).message || '备份文件解析失败', 'error')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const doClear = async () => {
    await clearLibrary()
    clearAll()
    toast('本地数据已清空')
  }

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="设置"
        description="所有配置与数据只保存在当前设备。"
        width={760}
        className="settings-modal"
      >
        <div className="settings-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={cn('settings-tab', tab === item.id && 'active')}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'ai' && (
          <div className="settings-panel">
            <section className="settings-section">
              <div className="settings-section-title">
                <Sparkles size={14} />
                模型服务
              </div>
              <p className="hint" style={{ margin: 0 }}>
                选择预设，或填写任意 OpenAI 兼容端点。也可以把 Ollama 跑在本机，完全离线。
              </p>
              <div className="provider-row">
                {AI_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn('provider-chip', draft.provider === preset.id && 'active')}
                    onClick={() => selectProvider(preset.id)}
                    title={preset.hint}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              {cloud ? (
                <>
                  <div className="cloud-account-strip">
                    <span className="cloud-account-icon">
                      <Cloud size={15} />
                    </span>
                    <div className="cloud-account-text">
                      {session ? (
                        <>
                          <strong>{displayNameOf(session.user)}</strong>
                          <span>{session.user.email}</span>
                        </>
                      ) : (
                        <>
                          <strong>尚未登录若道</strong>
                          <span>登录后自动读取账户可用的云端模型，无需填写 API Key。</span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setAccountOpen(true)}
                    >
                      {session ? '账户' : <><LogIn size={13} />登录</>}
                    </button>
                  </div>
                  <div className="settings-grid">
                    <div className="field">
                      <label className="field-label" htmlFor="ai-cloud-model">
                        云端模型
                      </label>
                      <div className="input-affix">
                        <select
                          id="ai-cloud-model"
                          className="input"
                          value={draft.model}
                          disabled={!session || cloudModelsLoading}
                          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                        >
                          {!draft.model && <option value="">{session ? '请选择模型' : '登录后选择'}</option>}
                          {draft.model && !cloudModels.some((model) => model.modelName === draft.model) && (
                            <option value={draft.model}>{draft.model}（当前不可用）</option>
                          )}
                          {cloudModels.map((model) => (
                            <option key={model.id} value={model.modelName}>
                              {model.label && model.label !== model.modelName
                                ? `${model.label}（${model.modelName}）`
                                : model.modelName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm affix-btn"
                          onClick={() => void loadCloudModels().catch(() => undefined)}
                          disabled={!session || cloudModelsLoading}
                          aria-label="刷新云端模型"
                          title="刷新云端模型"
                        >
                          <RefreshCw size={14} className={cn(cloudModelsLoading && 'spin')} />
                        </button>
                      </div>
                      <span className={cn('hint', cloudModelsError && 'hint-danger')}>
                        {cloudModelsError || '模型的可用性与计费由若道账户控制。'}
                      </span>
                    </div>
                    <div className="field">
                      <span className="field-label">鉴权与计费</span>
                      <div className="cloud-billing">
                        <Cloud size={13} />
                        登录令牌鉴权 · 按若道账户额度计费
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="settings-grid">
                    <div className="field">
                      <label className="field-label" htmlFor="ai-base">
                        API 地址
                      </label>
                      <input
                        id="ai-base"
                        className="input"
                        value={draft.baseUrl}
                        placeholder="https://api.example.com/v1"
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="ai-model">
                        模型
                      </label>
                      <input
                        id="ai-model"
                        className="input"
                        value={draft.model}
                        placeholder="deepseek-chat"
                        onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="ai-key">
                      API Key
                    </label>
                    <div className="input-affix">
                      <input
                        id="ai-key"
                        className="input"
                        type={showKey ? 'text' : 'password'}
                        value={draft.apiKey}
                        autoComplete="off"
                        placeholder={draft.provider === 'ollama' ? '本地 Ollama 通常无需 Key' : 'sk-…'}
                        onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                      />
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm affix-btn"
                        onClick={() => setShowKey((v) => !v)}
                        aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                      >
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <span className="hint">密钥保存在本机浏览器存储中。若更在意安全，可只把 Ollama 暴露在本机。</span>
                  </div>
                </>
              )}
              <div className="settings-actions">
                <button type="button" className="btn btn-primary" onClick={saveAi}>
                  保存配置
                </button>
                <button type="button" className="btn btn-secondary" onClick={runTest} disabled={testing}>
                  {testing && <span className="spinner" />}
                  测试连接
                </button>
                {testResult && (
                  <span
                    className="status-line"
                    style={{ color: testResult.ok ? 'var(--green)' : 'var(--danger)' }}
                  >
                    {testResult.ok ? <Wifi size={13} /> : <WifiOff size={13} />}
                    {testResult.message}
                  </span>
                )}
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <Database size={14} />
                本地离线能力
              </div>
              <div className="setup-note">
                <Info size={14} />
                <span>
                  即使没有配置任何模型，你仍然可以对当前文档、选区或笔记使用「离线摘要」和「关键词提取」：全部在本机计算，不发送任何内容。配置模型后，才启用对话、润色与续写。
                </span>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <ShieldCheck size={14} />
                隐私边界
              </div>
              <p className="hint" style={{ margin: 0 }}>
                对话内容只会发送到你填写的 API 地址；若使用 Ollama，数据留在本机。若服务商不允许浏览器直连（CORS），可改用本机 Ollama，或在桌面壳中通过本地代理访问。
              </p>
            </section>
          </div>
        )}

        {tab === 'data' && (
          <div className="settings-panel">
            <section className="settings-section">
              <div className="settings-section-title">
                <HardDrive size={14} />
                本地存储概览
              </div>
              <div className="data-stat-grid">
                <div className="data-stat">
                  <b>{stats.docs}</b>
                  <span>文档</span>
                </div>
                <div className="data-stat">
                  <b>{stats.sheets}</b>
                  <span>表格</span>
                </div>
                <div className="data-stat">
                  <b>{stats.notes}</b>
                  <span>笔记</span>
                </div>
              </div>
              <div className="status-line">
                <span className="dot dot-green" />
                IndexedDB 已连接 · 约 {sizeLabel} · 最后更新 {formatDateTime(Date.now())}
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <Download size={14} />
                备份与迁移
              </div>
              <p className="hint" style={{ margin: 0 }}>
                导出的 JSON 包含全部文档、表格与笔记，不包含 AI 密钥。换设备时导入即可恢复。
              </p>
              <div className="settings-actions">
                <button type="button" className="btn btn-secondary" onClick={doExport}>
                  <Download size={14} />
                  导出完整备份
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} />
                  导入备份
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(event) => handleImport(event.target.files?.[0])}
                />
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <Trash2 size={14} />
                危险操作
              </div>
              <div className="danger-zone">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>清空本地数据</div>
                    <div className="hint" style={{ marginTop: 3 }}>
                      删除此设备上的全部文档、表格与笔记。该操作不可撤销，建议先导出备份。
                    </div>
                  </div>
                  <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setConfirmClear(true)}>
                    清空
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === 'about' && (
          <div className="settings-panel">
            <div className="about-brand">
              <span className="about-logo">
                <Logo size={46} />
              </span>
              <div>
                <div className="about-name">若道办公</div>
                <div className="about-tag">RUODAO OFFICE · v0.1 · 本地优先版</div>
              </div>
            </div>

            <section className="settings-section">
              <div className="opensource-panel">
                <div className="opensource-panel-row">
                  <div>
                    <h3>开源免费 · 全部功能开放</h3>
                    <p>
                      若道办公以开源方式发布，不收取任何费用。没有订阅、授权码或按次导出收费，全部本地功能默认可用。
                    </p>
                  </div>
                  <span className="badge badge-accent">FREE</span>
                </div>
                <div className="opensource-panel-features">
                  <span>永久免费</span>
                  <span>无订阅</span>
                  <span>无广告 / 无水印</span>
                  <span>离线 PDF / OCR</span>
                  <span>自带 AI 模型</span>
                  <span>整包备份</span>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <Check size={14} />
                这一版包含
              </div>
              <p className="hint" style={{ margin: 0, lineHeight: 1.9 }}>
                富文本文档与 DOCX 导入导出 · 带图表与 BI 看板的表格和 XLSX 互操作 · 离线 PDF 合并 / 拆分 /
                水印 / 页码 / 签章 / 批注 / 压缩 / 转 Word / OCR · 图片 / PDF / 文档 / 表格 / ZIP 的本地批量转换 ·
                支持反向链接的 Markdown 笔记 · 可接入 OpenAI 兼容服务或本地 Ollama 的 AI 助手。
              </p>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <Info size={14} />
                技术说明
              </div>
              <p className="hint" style={{ margin: 0, lineHeight: 1.8 }}>
                前端使用 React + TypeScript 构建；数据保存在 IndexedDB；PDF 处理使用 pdf-lib 与 PDF.js；OCR
                使用 Tesseract.js。桌面安装壳使用 Electron，多设备实时协作通过自建服务完成。
              </p>
            </section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="导入并覆盖当前数据？"
        description="当前设备上的文档、表格与笔记会被备份文件中的内容替换。建议先导出当前数据。"
        confirmText="覆盖并导入"
        danger={false}
        onClose={() => setPendingImport(null)}
        onConfirm={() => {
          if (!pendingImport) return
          replaceAll(pendingImport)
          toast('备份已导入', 'success')
          setPendingImport(null)
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        title="清空全部本地数据？"
        description="此操作会永久删除当前设备上的所有文档、表格与笔记，且无法恢复。"
        confirmText="确认清空"
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          void doClear()
        }}
      />
    </>
  )
}

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
  Languages,
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
import { LOCALES, useLocale, useT } from '../i18n'
import { ConfirmDialog, Logo, Modal } from './ui'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '通用' },
  { id: 'ai', label: 'AI 助手' },
  { id: 'data', label: '数据与隐私' },
  { id: 'about', label: '关于与开源' },
]

export function SettingsDialog() {
  const t = useT()
  const locale = useLocale((s) => s.locale)
  const setLocale = useLocale((s) => s.setLocale)
  const followSystem = useLocale((s) => s.followSystem)
  const setFollowSystem = useLocale((s) => s.setFollowSystem)
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
        toast(t('请先登录若道账户'), 'error')
        return
      }
      if (!draft.model.trim()) {
        toast(t('请选择一个云端模型'), 'error')
        return
      }
      updateAi({ ...draft, baseUrl: '', apiKey: '' })
      toast(t('已切换到若道云端模型'), 'success')
      return
    }
    if (!draft.baseUrl.trim() || !draft.model.trim()) {
      toast(t('请填写 API 地址与模型名称'), 'error')
      return
    }
    updateAi(draft)
    toast(t('AI 配置已保存'), 'success')
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      await testConnection(draft)
      setTestResult({ ok: true, message: t('连接成功，可以开始对话') })
    } catch (error) {
      setTestResult({ ok: false, message: (error as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const doExport = async () => {
    const backup = await exportBackup(useLibrary.getState().snapshot())
    downloadText(JSON.stringify(backup, null, 2), t('若道办公-备份-{date}.json', { date: new Date().toISOString().slice(0, 10) }), 'application/json')
    toast(t('备份已导出到下载目录'), 'success')
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await readFileAsText(file)
      const raw = JSON.parse(text)
      if (raw?.app !== 'ruodao-office' || !Array.isArray(raw.docs) || !Array.isArray(raw.sheets) || !Array.isArray(raw.notes)) {
        throw new Error(t('不是有效的若道办公备份'))
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
      toast((error as Error).message || t('备份文件解析失败'), 'error')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const doClear = async () => {
    await clearLibrary()
    clearAll()
    toast(t('本地数据已清空'))
  }

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title={t('设置')}
        description={t('所有配置与数据只保存在当前设备。')}
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
              {t(item.label)}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <div className="settings-panel">
            <section className="settings-section">
              <div className="settings-section-title">
                <Languages size={14} />
                {t('界面语言')}
              </div>
              <p className="hint" style={{ margin: 0 }}>
                {t('切换语言后立即生效，已保存的内容不受影响。')}
              </p>
              <div className="lang-options">
                {LOCALES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn('lang-option', locale === item.id && 'active')}
                    onClick={() => setLocale(item.id)}
                  >
                    <span className="lang-name">{item.id === 'zh-CN' ? '简体中文' : 'English'}</span>
                    <span className="lang-native">{item.id === 'zh-CN' ? 'Chinese (Simplified)' : 'English'}</span>
                    {locale === item.id && <Check size={15} />}
                  </button>
                ))}
              </div>
              <label className="settings-check">
                <input type="checkbox" checked={followSystem} onChange={(e) => setFollowSystem(e.target.checked)} />
                <span>{t('跟随系统语言')}</span>
              </label>
            </section>
          </div>
        )}

        {tab === 'ai' && (
          <div className="settings-panel">
            <section className="settings-section">
              <div className="settings-section-title">
                <Sparkles size={14} />
                {t('模型服务')}
              </div>
              <p className="hint" style={{ margin: 0 }}>
                {t('选择预设，或填写任意 OpenAI 兼容端点。也可以把 Ollama 跑在本机，完全离线。')}
              </p>
              <div className="provider-row">
                {AI_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn('provider-chip', draft.provider === preset.id && 'active')}
                    onClick={() => selectProvider(preset.id)}
                    title={t(preset.hint)}
                  >
                    {t(preset.name)}
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
                          <strong>{t('尚未登录若道')}</strong>
                          <span>{t('登录后自动读取账户可用的云端模型，无需填写 API Key。')}</span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setAccountOpen(true)}
                    >
                      {session ? t('账户') : <><LogIn size={13} />{t('登录')}</>}
                    </button>
                  </div>
                  <div className="settings-grid">
                    <div className="field">
                      <label className="field-label" htmlFor="ai-cloud-model">
                        {t('云端模型')}
                      </label>
                      <div className="input-affix">
                        <select
                          id="ai-cloud-model"
                          className="input"
                          value={draft.model}
                          disabled={!session || cloudModelsLoading}
                          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                        >
                          {!draft.model && <option value="">{session ? t('请选择模型') : t('登录后选择')}</option>}
                          {draft.model && !cloudModels.some((model) => model.modelName === draft.model) && (
                            <option value={draft.model}>{t('{model}（当前不可用）', { model: draft.model })}</option>
                          )}
                          {cloudModels.map((model) => (
                            <option key={model.id} value={model.modelName}>
                              {model.label && model.label !== model.modelName
                                ? t('{label}（{name}）', { label: model.label, name: model.modelName })
                                : model.modelName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm affix-btn"
                          onClick={() => void loadCloudModels().catch(() => undefined)}
                          disabled={!session || cloudModelsLoading}
                          aria-label={t('刷新云端模型')}
                          title={t('刷新云端模型')}
                        >
                          <RefreshCw size={14} className={cn(cloudModelsLoading && 'spin')} />
                        </button>
                      </div>
                      <span className={cn('hint', cloudModelsError && 'hint-danger')}>
                        {cloudModelsError || t('模型的可用性与计费由若道账户控制。')}
                      </span>
                    </div>
                    <div className="field">
                      <span className="field-label">{t('鉴权与计费')}</span>
                      <div className="cloud-billing">
                        <Cloud size={13} />
                        {t('登录令牌鉴权 · 按若道账户额度计费')}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="settings-grid">
                    <div className="field">
                      <label className="field-label" htmlFor="ai-base">
                        {t('API 地址')}
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
                        {t('模型')}
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
                        placeholder={draft.provider === 'ollama' ? t('本地 Ollama 通常无需 Key') : 'sk-…'}
                        onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                      />
                      <button
                        type="button"
                        className="icon-btn icon-btn-sm affix-btn"
                        onClick={() => setShowKey((v) => !v)}
                        aria-label={showKey ? t('隐藏密钥') : t('显示密钥')}
                      >
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <span className="hint">{t('密钥保存在本机浏览器存储中。若更在意安全，可只把 Ollama 暴露在本机。')}</span>
                  </div>
                </>
              )}
              <div className="settings-actions">
                <button type="button" className="btn btn-primary" onClick={saveAi}>
                  {t('保存配置')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={runTest} disabled={testing}>
                  {testing && <span className="spinner" />}
                  {t('测试连接')}
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
                {t('本地离线能力')}
              </div>
              <div className="setup-note">
                <Info size={14} />
                <span>
                  {t('即使没有配置任何模型，你仍然可以对当前文档、选区或笔记使用「离线摘要」和「关键词提取」：全部在本机计算，不发送任何内容。配置模型后，才启用对话、润色与续写。')}
                </span>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <ShieldCheck size={14} />
                {t('隐私边界')}
              </div>
              <p className="hint" style={{ margin: 0 }}>
                {t('对话内容只会发送到你填写的 API 地址；若使用 Ollama，数据留在本机。若服务商不允许浏览器直连（CORS），可改用本机 Ollama，或在桌面壳中通过本地代理访问。')}
              </p>
            </section>
          </div>
        )}

        {tab === 'data' && (
          <div className="settings-panel">
            <section className="settings-section">
              <div className="settings-section-title">
                <HardDrive size={14} />
                {t('本地存储概览')}
              </div>
              <div className="data-stat-grid">
                <div className="data-stat">
                  <b>{stats.docs}</b>
                  <span>{t('文档')}</span>
                </div>
                <div className="data-stat">
                  <b>{stats.sheets}</b>
                  <span>{t('表格')}</span>
                </div>
                <div className="data-stat">
                  <b>{stats.notes}</b>
                  <span>{t('笔记')}</span>
                </div>
              </div>
              <div className="status-line">
                <span className="dot dot-green" />
                {t('IndexedDB 已连接 · 约 {size} · 最后更新 {time}', {
                  size: sizeLabel,
                  time: formatDateTime(Date.now()),
                })}
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <Download size={14} />
                {t('备份与迁移')}
              </div>
              <p className="hint" style={{ margin: 0 }}>
                {t('导出的 JSON 包含全部文档、表格与笔记，不包含 AI 密钥。换设备时导入即可恢复。')}
              </p>
              <div className="settings-actions">
                <button type="button" className="btn btn-secondary" onClick={doExport}>
                  <Download size={14} />
                  {t('导出完整备份')}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} />
                  {t('导入备份')}
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
                {t('危险操作')}
              </div>
              <div className="danger-zone">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t('清空本地数据')}</div>
                    <div className="hint" style={{ marginTop: 3 }}>
                      {t('删除此设备上的全部文档、表格与笔记。该操作不可撤销，建议先导出备份。')}
                    </div>
                  </div>
                  <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setConfirmClear(true)}>
                    {t('清空')}
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
                <div className="about-name">{t('若道办公')}</div>
                <div className="about-tag">{t('RUODAO OFFICE · v0.1 · 本地优先版')}</div>
              </div>
            </div>

            <section className="settings-section">
              <div className="opensource-panel">
                <div className="opensource-panel-row">
                  <div>
                    <h3>{t('开源免费 · 全部功能开放')}</h3>
                    <p>
                      {t('若道办公以开源方式发布，不收取任何费用。没有订阅、授权码或按次导出收费，全部本地功能默认可用。')}
                    </p>
                  </div>
                  <span className="badge badge-accent">FREE</span>
                </div>
                <div className="opensource-panel-features">
                  <span>{t('永久免费')}</span>
                  <span>{t('无订阅')}</span>
                  <span>{t('无广告 / 无水印')}</span>
                  <span>{t('离线 PDF / OCR')}</span>
                  <span>{t('自带 AI 模型')}</span>
                  <span>{t('整包备份')}</span>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <Check size={14} />
                {t('这一版包含')}
              </div>
              <p className="hint" style={{ margin: 0, lineHeight: 1.9 }}>
                {t('富文本文档与 DOCX 导入导出 · 带图表与 BI 看板的表格和 XLSX 互操作 · 离线 PDF 合并 / 拆分 / 水印 / 页码 / 签章 / 批注 / 压缩 / 转 Word / OCR · 图片 / PDF / 文档 / 表格 / ZIP 的本地批量转换 · 支持反向链接的 Markdown 笔记 · 可接入 OpenAI 兼容服务或本地 Ollama 的 AI 助手。')}
              </p>
            </section>

            <section className="settings-section">
              <div className="settings-section-title">
                <Info size={14} />
                {t('技术说明')}
              </div>
              <p className="hint" style={{ margin: 0, lineHeight: 1.8 }}>
                {t('前端使用 React + TypeScript 构建；数据保存在 IndexedDB；PDF 处理使用 pdf-lib 与 PDF.js；OCR 使用 Tesseract.js。桌面安装壳使用 Electron，多设备实时协作通过自建服务完成。')}
              </p>
            </section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title={t('导入并覆盖当前数据？')}
        description={t('当前设备上的文档、表格与笔记会被备份文件中的内容替换。建议先导出当前数据。')}
        confirmText={t('覆盖并导入')}
        danger={false}
        onClose={() => setPendingImport(null)}
        onConfirm={() => {
          if (!pendingImport) return
          replaceAll(pendingImport)
          toast(t('备份已导入'), 'success')
          setPendingImport(null)
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        title={t('清空全部本地数据？')}
        description={t('此操作会永久删除当前设备上的所有文档、表格与笔记，且无法恢复。')}
        confirmText={t('确认清空')}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          void doClear()
        }}
      />
    </>
  )
}

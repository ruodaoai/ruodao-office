import { useEffect, useState, type FormEvent } from 'react'
import { Cloud, LogIn, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth, displayNameOf, initialsOf } from '../store/auth'
import { useSettings } from '../lib/settings'
import { useUI } from '../store/ui'
import { cn } from '../lib/utils'
import { Modal } from './ui'

export function AccountDialog() {
  const open = useUI((s) => s.accountOpen)
  const setOpen = useUI((s) => s.setAccountOpen)
  const toast = useUI((s) => s.toast)

  const status = useAuth((s) => s.status)
  const session = useAuth((s) => s.session)
  const baseUrl = useAuth((s) => s.baseUrl)
  const authError = useAuth((s) => s.error)
  const models = useAuth((s) => s.models)
  const modelsLoading = useAuth((s) => s.modelsLoading)
  const modelsError = useAuth((s) => s.modelsError)
  const login = useAuth((s) => s.login)
  const logout = useAuth((s) => s.logout)
  const loadModels = useAuth((s) => s.loadModels)

  const ai = useSettings((s) => s.ai)
  const updateAi = useSettings((s) => s.updateAi)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [serviceUrl, setServiceUrl] = useState(baseUrl)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setServiceUrl(baseUrl)
      setError(null)
    }
  }, [open, baseUrl])

  useEffect(() => {
    if (!session || !models.length) return
    if (ai.provider === 'ruodao' && !ai.model) {
      updateAi({ model: models[0].modelName })
    } else if (ai.provider !== 'ollama' && ai.provider !== 'ruodao' && !ai.apiKey.trim()) {
      updateAi({ provider: 'ruodao', baseUrl: '', model: models[0].modelName, apiKey: '' })
    }
  }, [session, models, ai.provider, ai.model, ai.apiKey, updateAi])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await login({ email, password, baseUrl: serviceUrl })
      const list = await useAuth.getState().loadModels().catch(() => [])
      setPassword('')
      toast(
        list.length
          ? `已登录若道 · 云端 AI 可用（${list.length} 个模型）`
          : '已登录若道账户',
        'success',
      )
    } catch (reason) {
      setError((reason as Error).message || '登录失败')
    } finally {
      setBusy(false)
    }
  }

  const doLogout = async () => {
    await logout()
    toast('已退出若道账户', 'info')
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={session ? '若道账户' : '登录若道'}
      description={session ? '云端模型使用此账户的若道额度。' : '使用若道账户登录后，可直接调用云端模型。'}
      width={480}
      className="account-modal"
    >
      {status === 'loading' && <div className="account-loading"><span className="spinner" />正在读取账户…</div>}

      {status !== 'loading' && session && (
        <div className="account-panel">
          <div className="account-identity">
            {session.user.avatarUrl ? (
              <img className="account-avatar-lg" src={session.user.avatarUrl} alt="" />
            ) : (
              <span className="account-avatar-lg letter">{initialsOf(session.user)}</span>
            )}
            <div className="account-identity-text">
              <strong>{displayNameOf(session.user)}</strong>
              <span>{session.user.email}</span>
            </div>
            <span className="account-badge">已登录</span>
          </div>

          <div className="account-cloud-row">
            <div className="account-cloud-head">
              <Cloud size={14} />
              <span>云端模型</span>
              <button
                type="button"
                className="account-refresh"
                title="刷新模型列表"
                aria-label="刷新模型列表"
                onClick={() => void loadModels().catch(() => undefined)}
                disabled={modelsLoading}
              >
                <RefreshCw size={13} className={cn(modelsLoading && 'spin')} />
              </button>
            </div>
            <p>
              {modelsError
                ? modelsError
                : modelsLoading
                  ? '正在读取可用模型…'
                  : models.length
                    ? `${models.length} 个模型可用${ai.provider === 'ruodao' ? ` · 当前 ${ai.model || '未选择'}` : ' · 可在 AI 设置中切换'}`
                    : '账户暂未开通云端模型'}
            </p>
          </div>

          <dl className="account-meta">
            <div>
              <dt>服务地址</dt>
              <dd>{session.baseUrl}</dd>
            </div>
            <div>
              <dt>账户 ID</dt>
              <dd>{session.user.id}</dd>
            </div>
          </dl>

          <div className="account-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void doLogout()}>
              <LogOut size={14} />
              退出登录
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
              完成
            </button>
          </div>

          <p className="account-note">
            <ShieldCheck size={12} />
            登录令牌仅保存在此设备的浏览器存储中，不会写入本地备份或上传到其他服务。
          </p>
        </div>
      )}

      {status !== 'loading' && !session && (
        <form className="account-panel" onSubmit={submit}>
          <label className="field">
            <span className="field-label">邮箱</span>
            <input
              className="input"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="field">
            <span className="field-label">密码</span>
            <input
              className="input"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="若道账户密码"
            />
          </label>

          <button type="button" className="account-advanced-toggle" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? '收起服务地址' : '服务地址（本地开发 / 私有部署）'}
          </button>
          {advanced && (
            <label className="field">
              <span className="field-label">地址</span>
              <input
                className="input"
                value={serviceUrl}
                onChange={(event) => setServiceUrl(event.target.value)}
                placeholder="https://ruodao.com"
              />
            </label>
          )}

          {(error || authError) && <div className="account-error">{error || authError}</div>}

          <div className="account-actions">
            <a
              className="account-register-link"
              href={serviceUrl.replace(/\/+$/, '')}
              target="_blank"
              rel="noreferrer"
            >
              在若道注册
            </a>
            <button type="submit" className="btn btn-primary" disabled={busy || !email.trim() || !password}>
              {busy ? <span className="spinner" /> : <LogIn size={14} />}
              {busy ? '正在登录…' : '登录'}
            </button>
          </div>
          <p className="account-note">
            <ShieldCheck size={12} />
            令牌只保存在此设备。若道不会收到你本地文档的内容，除非你主动让 AI 读取。
          </p>
        </form>
      )}
    </Modal>
  )
}

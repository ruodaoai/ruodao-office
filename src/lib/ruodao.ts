import { del, get, set } from 'idb-keyval'

export interface RuodaoUser {
  id: string
  email: string
  role: string
  displayName: string
  bio?: string
  avatarUrl?: string
  websiteUrl?: string
  createdAt?: string
}

export interface RuodaoSession {
  baseUrl: string
  token: string
  user: RuodaoUser
  signedInAt: number
}

export interface RuodaoModel {
  id: string
  modelName: string
  label: string
  provider: string
  modelConfigId?: string
  capabilities?: string[]
}

const SESSION_KEY = 'ruodao.session.v1'
const BASE_KEY = 'ruodao.base.v1'

export class RuodaoRequestError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'RuodaoRequestError'
    this.status = status
  }
}

export class RuodaoNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuodaoNetworkError'
  }
}

export function isAuthExpiredError(error: unknown): boolean {
  return error instanceof RuodaoRequestError && (error.status === 401 || error.status === 403)
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof RuodaoNetworkError
}

export function defaultRuodaoBaseUrl(): string {
  if (!import.meta.env.DEV && navigator.userAgent.includes('Electron/')) {
    return 'https://ruodao.com'
  }
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return 'http://127.0.0.1:8080'
  }
  return 'https://ruodao.com'
}

export function normalizeBaseUrl(input: string): string {
  let value = input.trim().replace(/\/+$/, '')
  if (!value) throw new Error('请填写若道服务地址')
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('服务地址格式不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('服务地址必须是 http 或 https')
  return value
}

export function rememberBaseUrl(baseUrl: string): void {
  try {
    window.localStorage.setItem(BASE_KEY, baseUrl)
  } catch {
    /* storage can be unavailable in private mode */
  }
}

export function rememberedBaseUrl(): string {
  try {
    return window.localStorage.getItem(BASE_KEY) || defaultRuodaoBaseUrl()
  } catch {
    return defaultRuodaoBaseUrl()
  }
}

export async function loadRuodaoSession(): Promise<RuodaoSession | null> {
  try {
    const saved = await get<RuodaoSession>(SESSION_KEY)
    if (!saved?.token || !saved.baseUrl) return null
    return { ...saved, baseUrl: normalizeBaseUrl(saved.baseUrl) }
  } catch {
    return null
  }
}

export async function saveRuodaoSession(session: RuodaoSession): Promise<void> {
  await set(SESSION_KEY, session)
}

export async function clearRuodaoSession(): Promise<void> {
  await del(SESSION_KEY)
}

export function jwtExpiresAt(token: string): number | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    const json = JSON.parse(atob(padded)) as { exp?: number }
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}

export function isTokenExpired(token: string, skewMs = 0): boolean {
  const expiresAt = jwtExpiresAt(token)
  if (!expiresAt) return false
  return expiresAt - skewMs <= Date.now()
}

export function sessionRemainingMs(session: RuodaoSession | null): number {
  if (!session) return 0
  const expiresAt = jwtExpiresAt(session.token)
  return expiresAt ? Math.max(0, expiresAt - Date.now()) : 0
}

function messageOf(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback
  const record = body as Record<string, unknown>
  const error = record.error
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  return fallback
}

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }
  try {
    return await response.text()
  } catch {
    return null
  }
}

export function authErrorMessage(status: number, body: unknown): string {
  if (status === 401 || status === 403) return '邮箱或密码不正确，或账户已被限制登录'
  if (status === 429) return '尝试过于频繁，请稍后再试'
  if (status >= 500) return '若道服务暂不可用，请稍后再试'
  return messageOf(body, `登录失败（${status}）`)
}

export async function loginToRuodao(input: {
  baseUrl: string
  email: string
  password: string
}): Promise<RuodaoSession> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.email.trim().toLowerCase(), password: input.password }),
    })
  } catch {
    throw new RuodaoNetworkError('无法连接若道服务，请检查服务地址与网络')
  }
  const body = await readBody(response)
  if (!response.ok) throw new RuodaoRequestError(authErrorMessage(response.status, body), response.status)
  const payload = body as { success?: boolean; data?: { token?: string; user?: RuodaoUser }; message?: string } | null
  if (payload?.success === false) throw new Error(payload.message || '登录失败')
  const token = payload?.data?.token?.trim()
  const user = payload?.data?.user
  if (!token || !user) throw new Error('若道登录响应缺少账户信息')
  rememberBaseUrl(baseUrl)
  return { baseUrl, token, user, signedInAt: Date.now() }
}

export async function refreshRuodaoSession(session: RuodaoSession): Promise<RuodaoSession> {
  let response: Response
  try {
    response = await fetch(`${session.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
    })
  } catch {
    throw new RuodaoNetworkError('无法连接若道服务，请检查网络')
  }
  const body = await readBody(response)
  if (!response.ok) {
    throw new RuodaoRequestError(
      response.status === 401 || response.status === 403 ? '登录已过期，请重新登录' : authErrorMessage(response.status, body),
      response.status,
    )
  }
  const payload = body as { success?: boolean; data?: { token?: string; user?: RuodaoUser }; message?: string } | null
  if (payload?.success === false) throw new Error(payload.message || '续期失败')
  const token = payload?.data?.token?.trim()
  const user = payload?.data?.user ?? session.user
  if (!token) throw new Error('续期响应缺少令牌')
  return { ...session, token, user, signedInAt: Date.now() }
}

export async function fetchRuodaoModels(session: RuodaoSession): Promise<RuodaoModel[]> {
  const headers = { Authorization: `Bearer ${session.token}` }
  let catalogUnauthorized = false
  try {
    const response = await fetch(`${session.baseUrl}/api/model-catalog?generationMode=other`, { headers })
    if (response.status === 401 || response.status === 403) {
      catalogUnauthorized = true
    } else if (response.ok) {
      const body = (await response.json()) as {
        success?: boolean
        data?: Array<{
          routeKey?: string
          label?: string
          modelName?: string
          displayName?: string
          provider?: string
          modelConfigId?: string
          capabilities?: string[]
          generationModes?: string[]
        }>
      }
      const rows = Array.isArray(body?.data) ? body.data : []
      const models: RuodaoModel[] = []
      const seen = new Set<string>()
      for (const row of rows) {
        const modelName = String(row.modelName ?? '').trim()
        if (!modelName || seen.has(modelName)) continue
        seen.add(modelName)
        models.push({
          id: row.routeKey || modelName,
          modelName,
          label: String(row.label || row.displayName || modelName).trim(),
          provider: String(row.provider || ''),
          modelConfigId: row.modelConfigId,
          capabilities: row.capabilities ?? row.generationModes,
        })
      }
      if (models.length) return models
    }
  } catch {
    /* fall back to the OpenAI-compatible model list */
  }
  if (catalogUnauthorized) throw new RuodaoRequestError('登录已过期，请重新登录', 401)
  let response: Response
  try {
    response = await fetch(`${session.baseUrl}/api/v1/models`, { headers })
  } catch {
    throw new RuodaoNetworkError('无法连接若道服务，请检查网络')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RuodaoRequestError('登录已过期，请重新登录', response.status)
    }
    throw new RuodaoRequestError(`读取云端模型失败（${response.status}）`, response.status)
  }
  const body = (await response.json()) as { data?: Array<{ id?: string; owned_by?: string }> }
  return (body?.data ?? [])
    .map((row) => String(row.id ?? '').trim())
    .filter(Boolean)
    .map((modelName) => ({
      id: modelName,
      modelName,
      label: modelName,
      provider: 'ruodao',
    }))
}

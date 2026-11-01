import { create } from 'zustand'
import { t } from '../i18n'
import {
  clearRuodaoSession,
  fetchRuodaoModels,
  isAuthExpiredError,
  isNetworkError,
  isTokenExpired,
  jwtExpiresAt,
  loadRuodaoSession,
  loginToRuodao,
  normalizeBaseUrl,
  refreshRuodaoSession,
  rememberedBaseUrl,
  saveRuodaoSession,
  type RuodaoModel,
  type RuodaoSession,
  type RuodaoUser,
} from '../lib/ruodao'

type AuthStatus = 'idle' | 'loading' | 'ready'

interface AuthState {
  status: AuthStatus
  session: RuodaoSession | null
  models: RuodaoModel[]
  modelsLoading: boolean
  modelsError: string | null
  error: string | null
  baseUrl: string
  hydrate: () => Promise<void>
  login: (input: { email: string; password: string; baseUrl?: string }) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<boolean>
  loadModels: () => Promise<RuodaoModel[]>
  authorizedFetch: (path: string, init?: RequestInit) => Promise<Response>
}

let refreshTimer: number | undefined
let refreshJob: Promise<boolean> | null = null

function scheduleRefresh(session: RuodaoSession | null) {
  if (refreshTimer) window.clearTimeout(refreshTimer)
  refreshTimer = undefined
  if (!session) return
  const expiresAt = jwtExpiresAt(session.token)
  if (!expiresAt) return
  const wait = Math.max(30_000, Math.min(expiresAt - Date.now() - 5 * 60_000, 2_147_000_000))
  refreshTimer = window.setTimeout(() => {
    void useAuth.getState().refresh()
  }, wait)
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'idle',
  session: null,
  models: [],
  modelsLoading: false,
  modelsError: null,
  error: null,
  baseUrl: rememberedBaseUrl(),

  hydrate: async () => {
    if (get().status === 'loading' || get().status === 'ready') return
    set({ status: 'loading' })
    const saved = await loadRuodaoSession()
    if (!saved) {
      set({ status: 'ready', session: null })
      return
    }
    let session = saved
    if (isTokenExpired(saved.token)) {
      try {
        session = await refreshRuodaoSession(saved)
        await saveRuodaoSession(session)
      } catch (error) {
        if (!isAuthExpiredError(error)) {
          set({
            status: 'ready',
            session: saved,
            baseUrl: saved.baseUrl,
            error: isNetworkError(error)
              ? t('暂时无法连接若道服务，已保留登录状态，恢复网络后自动重试')
              : t('暂时无法续期登录，正在自动重试'),
          })
          scheduleRefresh(saved)
          return
        }
        await clearRuodaoSession()
        set({
          status: 'ready',
          session: null,
          baseUrl: saved.baseUrl,
          error: t('若道登录已过期，请重新登录'),
        })
        return
      }
    }
    set({ status: 'ready', session, baseUrl: session.baseUrl })
    scheduleRefresh(session)
    if (Date.now() + 5 * 60_000 > (jwtExpiresAt(session.token) ?? Number.MAX_SAFE_INTEGER)) {
      void get().refresh()
    }
    void get().loadModels().catch(() => undefined)
  },

  login: async ({ email, password, baseUrl }) => {
    set({ status: 'loading', error: null })
    try {
      const session = await loginToRuodao({
        baseUrl: normalizeBaseUrl(baseUrl || get().baseUrl),
        email,
        password,
      })
      await saveRuodaoSession(session)
      set({ status: 'ready', session, baseUrl: session.baseUrl, error: null, models: [], modelsError: null })
      scheduleRefresh(session)
      void get().loadModels().catch(() => undefined)
    } catch (error) {
      set({ status: 'ready', error: (error as Error).message || t('登录失败') })
      throw error
    }
  },

  logout: async () => {
    await clearRuodaoSession()
    if (refreshTimer) window.clearTimeout(refreshTimer)
    refreshTimer = undefined
    set({ session: null, models: [], modelsError: null, error: null, status: 'ready' })
  },

  refresh: async () => {
    if (refreshJob) return refreshJob
    const session = get().session
    if (!session) return false
    const stillCurrent = () => get().session?.token === session.token
    refreshJob = (async () => {
      try {
        const next = await refreshRuodaoSession(session)
        if (!stillCurrent()) return false
        await saveRuodaoSession(next)
        if (!stillCurrent()) return false
        set({ session: next, baseUrl: next.baseUrl, error: null })
        scheduleRefresh(next)
        if (!get().models.length) void get().loadModels().catch(() => undefined)
        return true
      } catch (error) {
        if (!stillCurrent()) return false
        if (isAuthExpiredError(error)) {
          await clearRuodaoSession()
          set({ session: null, models: [], error: t('登录已过期，请重新登录') })
          return false
        }
        set({
          error: isNetworkError(error)
            ? t('暂时无法连接若道服务，恢复后会自动重试')
            : (error as Error).message || t('续期失败，正在自动重试'),
        })
        scheduleRefresh(session)
        return false
      } finally {
        refreshJob = null
      }
    })()
    return refreshJob
  },

  loadModels: async () => {
    const session = get().session
    if (!session) {
      set({ models: [], modelsError: null })
      return []
    }
    set({ modelsLoading: true, modelsError: null })
    try {
      let models: RuodaoModel[]
      try {
        models = await fetchRuodaoModels(session)
      } catch (error) {
        if (!isAuthExpiredError(error)) throw error
        const refreshed = await get().refresh()
        const next = get().session
        if (!refreshed || !next) throw new Error(get().error || t('若道登录已过期，请重新登录'))
        models = await fetchRuodaoModels(next)
      }
      set({ models, modelsLoading: false })
      return models
    } catch (error) {
      set({ modelsLoading: false, modelsError: (error as Error).message || t('读取云端模型失败') })
      throw error
    }
  },

  authorizedFetch: async (path, init = {}) => {
    const build = (session: RuodaoSession) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${session.token}`)
      return fetch(`${session.baseUrl}${path}`, { ...init, headers })
    }
    const session = get().session
    if (!session) throw new Error(t('请先登录若道账户'))
    let response = await build(session)
    if (response.status === 401) {
      const refreshed = await get().refresh()
      const next = get().session
      if (!refreshed || !next) throw new Error(get().error || t('若道登录已过期，请重新登录'))
      response = await build(next)
    }
    return response
  },
}))

export function displayNameOf(user: RuodaoUser | null | undefined): string {
  if (!user) return ''
  return user.displayName?.trim() || user.email?.split('@')[0] || t('若道用户')
}

export function initialsOf(user: RuodaoUser | null | undefined): string {
  const name = displayNameOf(user)
  return name.trim().charAt(0).toUpperCase() || t('若')
}

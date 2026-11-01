import { useCallback } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { en } from './en'

export type Locale = 'zh-CN' | 'en'

export interface LocaleOption {
  id: Locale
  label: string
  native: string
}

export const LOCALES: LocaleOption[] = [
  { id: 'zh-CN', label: '简体中文', native: '简体中文' },
  { id: 'en', label: 'English', native: 'English' },
]

export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN'
  const list = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean)
  for (const lang of list) {
    if (lang.toLowerCase().startsWith('zh')) return 'zh-CN'
    if (lang.toLowerCase().startsWith('en')) return 'en'
  }
  return 'zh-CN'
}

interface LocaleState {
  locale: Locale
  followSystem: boolean
  setLocale: (locale: Locale) => void
  setFollowSystem: (follow: boolean) => void
}

export const useLocale = create<LocaleState>()(
  persist(
    (set) => ({
      locale: detectLocale(),
      followSystem: true,
      setLocale: (locale) => set({ locale, followSystem: false }),
      setFollowSystem: (followSystem) =>
        set(followSystem ? { followSystem, locale: detectLocale() } : { followSystem }),
    }),
    { name: 'ruodao.locale.v1' },
  ),
)

export function currentLocale(): Locale {
  return useLocale.getState().locale
}

export function isEnglish(): boolean {
  return currentLocale() === 'en'
}

export type TParams = Record<string, string | number>

/**
 * 中文原文即词典 key：查不到英文译文时原样返回中文，
 * 因此新增文案永远不会出现空字符串或 key 泄漏。
 */
export function translate(locale: Locale, text: string, params?: TParams): string {
  if (!text) return text
  let out = locale === 'en' ? en[text] ?? text : text
  if (params) {
    for (const key of Object.keys(params)) {
      out = out.split(`{${key}}`).join(String(params[key]))
    }
  }
  return out
}

export function t(text: string, params?: TParams): string {
  return translate(currentLocale(), text, params)
}

export function useT(): (text: string, params?: TParams) => string {
  const locale = useLocale((s) => s.locale)
  return useCallback((text: string, params?: TParams) => translate(locale, text, params), [locale])
}

/** 用于需要跟随语言切换的属性（<html lang>、document.title） */
export function useLocaleEffect(): Locale {
  const locale = useLocale((s) => s.locale)
  return locale
}

/** 数字/日期的本地化格式化（表格数字、时间戳） */
export function localeTag(locale: Locale = currentLocale()): string {
  return locale === 'en' ? 'en-US' : 'zh-CN'
}

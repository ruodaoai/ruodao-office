import { create } from 'zustand'
import type { ModuleId } from '../types'
import { uid } from '../lib/utils'

export type ToastKind = 'success' | 'error' | 'info'
export type SettingsTab = 'ai' | 'data' | 'about'

export interface ToastItem {
  id: string
  message: string
  kind: ToastKind
}

interface UIState {
  module: ModuleId
  aiOpen: boolean
  settingsOpen: boolean
  accountOpen: boolean
  collabOpen: boolean
  settingsTab: SettingsTab
  paletteOpen: boolean
  aiSeed: { id: string; text: string } | null
  aiTaskOpen: boolean
  aiTaskSeed: { id: string; text: string } | null
  toasts: ToastItem[]
  setModule: (module: ModuleId) => void
  setAiOpen: (open: boolean) => void
  askAi: (text: string) => void
  consumeAiSeed: (id: string) => void
  openAiTask: (text?: string) => void
  closeAiTask: () => void
  consumeAiTaskSeed: (id: string) => void
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void
  setAccountOpen: (open: boolean) => void
  setCollabOpen: (open: boolean) => void
  setSettingsTab: (tab: SettingsTab) => void
  setPaletteOpen: (open: boolean) => void
  toast: (message: string, kind?: ToastKind) => void
  dismissToast: (id: string) => void
}

export const useUI = create<UIState>((set) => ({
  module: 'home',
  aiOpen: false,
  settingsOpen: false,
  accountOpen: false,
  collabOpen: false,
  settingsTab: 'ai',
  paletteOpen: false,
  aiSeed: null,
  aiTaskOpen: false,
  aiTaskSeed: null,
  toasts: [],

  setModule: (module) => set({ module }),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  askAi: (text) => set({ aiOpen: true, aiSeed: { id: uid(), text } }),
  consumeAiSeed: (id) => {
    if (useUI.getState().aiSeed?.id === id) set({ aiSeed: null })
  },
  openAiTask: (text) =>
    set({ aiTaskOpen: true, aiTaskSeed: text ? { id: uid(), text } : null }),
  closeAiTask: () => set({ aiTaskOpen: false }),
  consumeAiTaskSeed: (id) => {
    if (useUI.getState().aiTaskSeed?.id === id) set({ aiTaskSeed: null })
  },
  openSettings: (settingsTab = 'ai') => set({ settingsOpen: true, settingsTab }),
  closeSettings: () => set({ settingsOpen: false }),
  setAccountOpen: (accountOpen) => set({ accountOpen }),
  setCollabOpen: (collabOpen) => set({ collabOpen }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  toast: (message, kind = 'info') => {
    const id = uid()
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, kind }] }))
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3600)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AiConfig } from '../types'

interface SettingsState {
  ai: AiConfig
  updateAi: (patch: Partial<AiConfig>) => void
}

export const DEFAULT_AI: AiConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: '',
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ai: DEFAULT_AI,
      updateAi: (patch) => set((s) => ({ ai: { ...s.ai, ...patch } })),
    }),
    { name: 'ruodao.settings.v1' },
  ),
)

export function hasAiKey(ai: AiConfig): boolean {
  return ai.provider === 'ollama' || ai.apiKey.trim().length > 0
}

export function isAiReady(ai: AiConfig, signedInToRuodao: boolean): boolean {
  if (ai.provider === 'ruodao') return signedInToRuodao && Boolean(ai.model.trim())
  return hasAiKey(ai)
}

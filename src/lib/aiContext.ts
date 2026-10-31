import type { AiContext, ModuleId } from '../types'

type ContextKey = Exclude<ModuleId, 'home'>
type ContextProvider = () => AiContext | null
type InsertHandler = (text: string) => boolean

const providers = new Map<ContextKey, ContextProvider>()
const inserters = new Map<ContextKey, InsertHandler>()

export function registerAiContext(key: ContextKey, provider: ContextProvider): () => void {
  providers.set(key, provider)
  return () => {
    if (providers.get(key) === provider) providers.delete(key)
  }
}

export function getAiContext(module: ModuleId): AiContext | null {
  if (module === 'home') return null
  try {
    return providers.get(module)?.() ?? null
  } catch {
    return null
  }
}

export function registerAiInsert(key: ContextKey, handler: InsertHandler): () => void {
  inserters.set(key, handler)
  return () => {
    if (inserters.get(key) === handler) inserters.delete(key)
  }
}

export function insertAiText(module: ModuleId, text: string): boolean {
  if (module === 'home') return false
  return inserters.get(module)?.(text) ?? false
}

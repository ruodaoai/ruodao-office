import type { DesktopFilePayload } from './lib/openFiles'

declare global {
  interface Window {
    ruodaoDesktop?: {
      onOpenFiles: (callback: (files: DesktopFilePayload[]) => void) => () => void
      ready: () => void
      onFlush?: (callback: () => void) => () => void
      flushDone?: () => void
    }
  }
}

export {}

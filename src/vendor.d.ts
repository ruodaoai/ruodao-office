declare module 'mammoth/mammoth.browser.js' {
  export interface MammothMessage {
    type: string
    message: string
  }

  export interface MammothResult {
    value: string
    messages: MammothMessage[]
  }

  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer } | { path: string },
    options?: Record<string, unknown>,
  ): Promise<MammothResult>

  const mammoth: {
    convertToHtml: typeof convertToHtml
  }

  export default mammoth
}

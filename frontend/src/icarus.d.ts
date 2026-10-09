export type ModeId =
  | 'logic_coach'
  | 'explain_mistake'
  | 'fix_code'
  | 'hint'
  | 'explain_code'
  | 'refactor'
  | 'ask_icarus'
  | 'full_solve'
  | 'analyze'

export type ProviderName = 'none' | 'huggingface' | 'openai' | 'ollama' | 'lm_studio' | 'groq' | 'openrouter' | 'gemini' | 'custom'
export type ConnectionSettings = { provider: ProviderName; model: string; base_url?: string }
export type ConnectionReply = { model: string; reply: string }
export type ProjectMemory = { project: string; goal: string; notes: string }
export type Mood = 'friendly' | 'full_tutor' | 'fun' | 'gen_z'
export type ConversationTurn = { role: 'user' | 'assistant'; content: string }
export type GenerationOptions = { building?: string; includeMemory?: boolean; mood?: Mood; conversation?: ConversationTurn[] }
export type Invocation = { selectedText: string | null; mode?: ModeId; capturing?: boolean; permissionRequired?: boolean; sourceApp?: string; captureStatus?: 'selected' | 'empty' | 'permission_needed' | 'unavailable' }

export type ModeResult =
  | { status: 'started'; requestId: string }
  | { status: 'model_unavailable'; message: string }
  | { status: 'error'; message: string }

export type GenerationEvent = {
  requestId: string
  type: 'delta' | 'done' | 'error'
  text?: string
  message?: string
}

declare global {
  interface Window {
    icarus?: {
      health: () => Promise<{ status: 'ok' | 'error'; message?: string }>
      shortcutStatus: () => Promise<{ status: 'ready' | 'collision' } | { status: 'error'; message: string }>
      openPopup: (mode?: ModeId) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>
      saveProviderKey: (key: string) => Promise<{ status: 'saved' } | { status: 'error'; message: string }>
      providerKeyStatus: () => Promise<{ status: 'configured' | 'missing' } | { status: 'error'; message: string }>
      deleteProviderKey: () => Promise<{ status: 'deleted' } | { status: 'error'; message: string }>
      dismissPopup: (returnHome?: boolean) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>
      setPopupThinking: (thinking: boolean) => Promise<{ status: 'ok' | 'error' }>
      getInvocation: () => Promise<Invocation>
      allowSelection: () => Promise<Invocation>
      denySelection: () => Promise<Invocation>
      openAccessibilitySettings: () => Promise<{ status: 'ok' | 'error'; message?: string }>
      connectionStatus: () => Promise<{ status: 'ok'; connection: ConnectionSettings; keyStatus: 'configured' | 'missing' | 'not_needed' | 'unconfigured' } | { status: 'error'; message: string }>
      discoverModels: (settings: ConnectionSettings, key?: string) => Promise<{ status: 'ok'; provider: ProviderName; models: string[] } | { status: 'error'; message: string }>
      saveConnection: (settings: ConnectionSettings, key?: string) => Promise<({ status: 'saved' } & ConnectionReply) | { status: 'error'; message: string }>
      testConnection: (settings: ConnectionSettings) => Promise<({ status: 'connected' } & ConnectionReply) | { status: 'error'; message: string }>
      readMemory: () => Promise<ProjectMemory>
      saveMemory: (memory: ProjectMemory) => Promise<ProjectMemory>
      historyStatus: () => Promise<{ count: number }>
      clearHistory: () => Promise<{ status: 'ok' | 'error'; message?: string }>
      onInvocation: (callback: () => void) => () => void
      selectMode: (mode: ModeId, prompt?: string, text?: string, options?: GenerationOptions) => Promise<ModeResult>
      onGeneration: (callback: (event: GenerationEvent) => void) => () => void
      stopGeneration: (requestId: string) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>
      copyText: (text: string) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>
    }
  }
}

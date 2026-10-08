import { contextBridge, ipcRenderer } from 'electron'
import type { GenerationEvent, HealthResult, Invocation, ModeId, ModeResult } from './main'
import type { ConnectionSettings, GenerationOptions, ProjectMemory } from '../src/icarus'

contextBridge.exposeInMainWorld('icarus', {
  health: (): Promise<HealthResult> => ipcRenderer.invoke('icarus:health'),
  shortcutStatus: (): Promise<{ status: 'ready' | 'collision' } | { status: 'error'; message: string }> =>
    ipcRenderer.invoke('icarus:shortcut-status'),
  openPopup: (mode?: ModeId): Promise<{ status: 'ok' } | { status: 'error'; message: string }> =>
    ipcRenderer.invoke('icarus:open-popup', mode),
  saveProviderKey: (key: string): Promise<{ status: 'saved' } | { status: 'error'; message: string }> =>
    ipcRenderer.invoke('icarus:save-provider-key', key),
  providerKeyStatus: (): Promise<{ status: 'configured' | 'missing' } | { status: 'error'; message: string }> =>
    ipcRenderer.invoke('icarus:provider-key-status'),
  deleteProviderKey: (): Promise<{ status: 'deleted' } | { status: 'error'; message: string }> =>
    ipcRenderer.invoke('icarus:delete-provider-key'),
  getInvocation: (): Promise<Invocation> => ipcRenderer.invoke('icarus:get-invocation'),
  setPopupThinking: (thinking: boolean) => ipcRenderer.invoke('icarus:popup-thinking', thinking),
  allowSelection: (): Promise<Invocation> => ipcRenderer.invoke('icarus:allow-selection'),
  denySelection: (): Promise<Invocation> => ipcRenderer.invoke('icarus:deny-selection'),
  openAccessibilitySettings: () => ipcRenderer.invoke('icarus:accessibility-settings'),
  connectionStatus: () => ipcRenderer.invoke('icarus:connection-status'),
  saveConnection: (settings: ConnectionSettings, key?: string) => ipcRenderer.invoke('icarus:save-connection', settings, key),
  testConnection: (settings: ConnectionSettings) => ipcRenderer.invoke('icarus:test-connection', settings),
  readMemory: (): Promise<ProjectMemory> => ipcRenderer.invoke('icarus:read-memory'),
  saveMemory: (memory: ProjectMemory): Promise<ProjectMemory> => ipcRenderer.invoke('icarus:save-memory', memory),
  historyStatus: () => ipcRenderer.invoke('icarus:history-status'),
  clearHistory: () => ipcRenderer.invoke('icarus:clear-history'),
  dismissPopup: (returnHome?: boolean): Promise<{ status: 'ok' } | { status: 'error'; message: string }> =>
    ipcRenderer.invoke('icarus:dismiss-popup', returnHome),
  selectMode: (mode: string, prompt?: string, text?: string, options?: GenerationOptions): Promise<ModeResult> =>
    ipcRenderer.invoke('icarus:select-mode', mode, prompt, text, options),
  stopGeneration: (requestId: string): Promise<{ status: 'ok' } | { status: 'error'; message: string }> =>
    ipcRenderer.invoke('icarus:stop-generation', requestId),
  copyText: (value: string): Promise<{ status: 'ok' } | { status: 'error'; message: string }> =>
    ipcRenderer.invoke('icarus:copy-text', value),
  onGeneration: (callback: (event: GenerationEvent) => void): (() => void) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event: Electron.IpcRendererEvent, value: GenerationEvent) => callback(value)
    ipcRenderer.on('icarus:generation', listener)
    return () => ipcRenderer.removeListener('icarus:generation', listener)
  },
  onInvocation: (callback: () => void): (() => void) => {
    if (typeof callback !== 'function') return () => {}
    const listener = () => callback()
    ipcRenderer.on('icarus:invoked', listener)
    return () => ipcRenderer.removeListener('icarus:invoked', listener)
  },
})

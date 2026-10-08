import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { KeychainStore } from './keychain.ts'
import { SelectionHelper, SelectionSession } from './selection.ts'
import type { ConnectionSettings, GenerationOptions, ProjectMemory } from '../src/icarus'
import { parseMemory } from '../src/home-data.ts'
import { modelErrorMessages } from '../src/generation-errors.ts'

export type HealthResult = { status: 'ok' } | { status: 'error'; message: string }
export type ModeResult = { status: 'started'; requestId: string }
  | { status: 'model_unavailable' | 'error'; message: string }
export type GenerationEvent = {
  requestId: string
  type: 'delta' | 'done' | 'error'
  text?: string
  message?: string
}
type StreamEvent = Omit<GenerationEvent, 'requestId'>
export type ModeId = 'logic_coach' | 'explain_mistake' | 'fix_code' | 'hint'
  | 'explain_code' | 'refactor' | 'ask_icarus' | 'full_solve' | 'analyze'
export type Invocation = import('../src/icarus').Invocation
type ModeRequest = { mode: ModeId; text: string; prompt: string }
type StreamRequest = ModeRequest & {
  provider: ConnectionSettings['provider']
  model: string
  api_key?: string
  building?: string
  memory?: ProjectMemory
  mood?: GenerationOptions['mood']
  conversation?: GenerationOptions['conversation']
}

const modes = new Set<string>([
  'logic_coach', 'explain_mistake', 'fix_code', 'hint',
  'explain_code', 'refactor', 'ask_icarus', 'full_solve', 'analyze',
])

export function validateConnectionSettings(value: unknown): ConnectionSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !['provider', 'model'].includes(key))
    || !['huggingface', 'openai', 'ollama', 'lm_studio'].includes(String(record.provider))
    || typeof record.model !== 'string' || !record.model || record.model.length > 128
    || /\s/.test(record.model) || Array.from(record.model).some(char => char.charCodeAt(0) < 32)) return null
  return { provider: record.provider as ConnectionSettings['provider'], model: record.model }
}

export function validatePopupMode(mode: unknown): ModeId | undefined | { status: 'error'; message: string } {
  if (mode === undefined) return undefined
  return typeof mode === 'string' && modes.has(mode)
    ? mode as ModeId : { status: 'error', message: 'Invalid mode' }
}

export function validateGenerationOptions(value: unknown): GenerationOptions | null {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !['building', 'includeMemory', 'mood', 'conversation'].includes(key))
    || (record.building !== undefined && (typeof record.building !== 'string' || record.building.length > 500))
    || (record.includeMemory !== undefined && typeof record.includeMemory !== 'boolean')
    || (record.mood !== undefined && (typeof record.mood !== 'string'
      || !['friendly', 'full_tutor', 'fun', 'gen_z'].includes(record.mood)))) return null
  if (record.conversation !== undefined) {
    if (!Array.isArray(record.conversation) || record.conversation.length > 6 || record.conversation.length % 2) return null
    if (record.conversation.some((turn: unknown, index: number) => {
      if (!turn || typeof turn !== 'object' || Array.isArray(turn)) return true
      const item = turn as Record<string, unknown>
      return Object.keys(item).some(key => !['role', 'content'].includes(key))
        || item.role !== (index % 2 ? 'assistant' : 'user')
        || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 8192
    })) return null
  }
  return value as GenerationOptions
}

export function validateModeRequest(mode: unknown, prompt: unknown,
  selectedText: string | null, suppliedText?: unknown): ModeRequest | { status: 'error'; message: string } {
  if (typeof mode !== 'string' || !modes.has(mode)
    || (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 4096))
    || (suppliedText !== undefined && (typeof suppliedText !== 'string' || suppliedText.length > 65536))) {
    return { status: 'error', message: 'Invalid mode, prompt, or code' }
  }
  const text = typeof suppliedText === 'string' ? suppliedText : selectedText || ''
  const question = typeof prompt === 'string' ? prompt.trim() : ''
  if (mode === 'ask_icarus' ? !question : mode === 'full_solve' ? !question && !text.trim() : !text.trim()) {
    return { status: 'error', message: mode === 'ask_icarus'
      ? 'Enter a question first.' : mode === 'full_solve'
        ? 'Enter a problem or code first.' : 'Select code before using this mode.' }
  }
  return { mode: mode as ModeId, text, prompt: question }
}

export async function consumeSSE(stream: ReadableStream<Uint8Array>,
  emit: (event: StreamEvent) => void): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = ''
  let answerBytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, boundary.index)
        pending = pending.slice(boundary.index + boundary[0].length)
        if (frame.length > 65536) throw new Error('Invalid model stream')
        const lines = frame.split(/\r?\n/)
        const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!['delta', 'done', 'error'].includes(type || '')) continue
        let payload: unknown
        try { payload = JSON.parse(data) } catch { throw new Error('Invalid model stream') }
        if (typeof payload !== 'object' || payload === null) throw new Error('Invalid model stream')
        const record = payload as Record<string, unknown>
        if (type === 'delta') {
          if (typeof record.text !== 'string' || record.text.length > 16384) throw new Error('Invalid model stream')
          answerBytes += Buffer.byteLength(record.text, 'utf8')
          if (answerBytes > 256 * 1024) throw new Error('Invalid model stream')
          emit({ type: 'delta', text: record.text })
        } else if (type === 'error') {
          emit({ type: 'error', message: typeof record.message === 'string' && modelErrorMessages.includes(record.message)
            ? record.message : 'Model request failed' })
          return
        } else {
          emit({ type: 'done' })
          return
        }
      }
      if (pending.length > 65536 || done) throw new Error('Invalid model stream')
    }
  } finally {
    await reader.cancel().catch(() => console.error('Could not close the model stream'))
    reader.releaseLock()
  }
}

export function getInvocation(mode?: ModeId): Invocation {
  return { selectedText: null, ...(mode ? { mode } : {}) }
}

type Point = { x: number; y: number }
type Rectangle = Point & { width: number; height: number }
type Size = { width: number; height: number }

export function rendererAssetPath(value: string, root: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'icarus:' || url.hostname !== 'app' || url.port || url.username || url.password) return null
    const pathname = decodeURIComponent(url.pathname)
    if (pathname.includes('\0')) return null
    const file = path.resolve(root, `.${pathname}`)
    const relative = path.relative(root, file)
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? null : file
  } catch {
    return null
  }
}

export function placePopup(point: Point, workArea: Rectangle, size: Size): Rectangle {
  const gap = 16
  const width = Math.min(size.width, workArea.width)
  const height = Math.min(size.height, workArea.height)
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height
  const beside = point.x + gap
  const below = point.y + gap
  const x = beside + width <= workArea.x + workArea.width
    ? beside : point.x - width - gap
  const y = below + height <= workArea.y + workArea.height
    ? below : point.y - height - gap
  return {
    x: Math.round(Math.max(workArea.x, Math.min(x, maxX))),
    y: Math.round(Math.max(workArea.y, Math.min(y, maxY))),
    width,
    height,
  }
}

async function freeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address) resolve(address.port)
        else reject(new Error('Could not reserve a local port'))
      })
    })
  })
}

export class BackendSupervisor {
  private child: ChildProcess | undefined
  private readonly command: string
  private readonly scriptPath: string
  private port = 0
  private token = ''
  private restarts = 0
  private stopping = false
  private starting: Promise<void> | undefined
  private dataDirectory: string | undefined

  constructor(command: string, scriptPath: string, dataDirectory?: string) {
    this.command = command
    this.scriptPath = scriptPath
    this.dataDirectory = dataDirectory
  }

  start(): Promise<void> {
    if (this.stopping || this.child) return Promise.resolve()
    if (!this.starting) {
      this.starting = this.launch().finally(() => { this.starting = undefined })
    }
    return this.starting
  }

  private async launch(): Promise<void> {
    const port = await freeLocalPort()
    if (this.stopping) return
    const token = randomBytes(32).toString('hex')
    const child = spawn(this.command, [this.scriptPath, '--port', String(port),
      ...(this.dataDirectory ? ['--data-dir', this.dataDirectory] : [])], {
      stdio: ['pipe', 'ignore', 'inherit'],
    })
    child.on('error', () => console.error('ICARUS backend launch failed')) // close handles the single restart.
    child.stdin?.on('error', () => console.error('ICARUS backend startup input failed'))
    child.once('close', () => {
      if (this.child !== child) return
      this.child = undefined
      this.port = 0
      this.token = ''
      if (!this.stopping && this.restarts++ < 1) void this.start().catch(() => {
        this.restarts = 2
        console.error('ICARUS backend restart failed')
      })
    })
    this.child = child
    this.port = port
    this.token = token
    child.stdin?.end(JSON.stringify({ token }) + '\n')
  }

  async health(): Promise<HealthResult> {
    const deadline = Date.now() + 3000
    while (!this.stopping && Date.now() < deadline) {
      await this.starting?.catch(() => {})
      if (this.child && this.port) {
        try {
          const response = await fetch(`http://127.0.0.1:${this.port}/health`, {
            headers: { Authorization: `Bearer ${this.token}` },
            signal: AbortSignal.timeout(700),
          })
          if (response.ok && (await response.json()).status === 'ok') return { status: 'ok' }
        } catch {
          // The backend may still be starting or completing its one restart.
        }
      }
      if (this.restarts > 1) break
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    return {
      status: 'error',
      message: this.restarts > 1 && !this.stopping
        ? 'Backend failed to restart. Restart Icarus.'
        : 'Backend unavailable',
    }
  }

  async stream(request: StreamRequest, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    if (!this.child || !this.port || this.stopping) throw new Error('Backend unavailable')
    const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal,
    })
    if (!response.ok || !response.body) throw new Error('Backend unavailable')
    return response.body
  }

  async request<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
    if ((await this.health()).status !== 'ok') throw new Error('Local engine unavailable')
    const response = await fetch(`http://127.0.0.1:${this.port}${route}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error('Local service request failed')
    return await response.json() as T
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.starting?.catch(() => {})
    const child = this.child
    this.child = undefined
    this.port = 0
    this.token = ''
    if (!child || child.exitCode !== null) return
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => child.kill('SIGKILL'), 1000)
      child.once('close', () => { clearTimeout(timeout); resolve() })
      child.kill('SIGTERM')
    })
  }
}

export function loadRenderer(window: Pick<import('electron').BrowserWindow, 'loadURL'>,
  page: 'index.html' | 'popup.html', devURL?: string): Promise<void> {
  return window.loadURL(devURL ? new URL(page, devURL).toString() : `icarus://app/${page}`)
}

async function runElectron(): Promise<void> {
  const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, protocol, net, shell, dialog } = await import('electron')
  protocol.registerSchemesAsPrivileged([{ scheme: 'icarus', privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
  } }])
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'main.py')
    : path.resolve(__dirname, '../../backend/main.py')
  const backend = new BackendSupervisor(process.env.ICARUS_PYTHON || 'python3', scriptPath,
    process.env.ICARUS_DATA_DIR || app.getPath('userData'))
  const keychainPath = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'icarus-keychain')
    : path.join(__dirname, '../dist-native/icarus-keychain')
  const keychain = new KeychainStore(keychainPath)
  const keychains = { huggingface: keychain, openai: new KeychainStore(keychainPath, 'openai') }
  const selectionPath = app.isPackaged ? path.join(process.resourcesPath, 'native', 'icarus-selection')
    : path.join(__dirname, '../dist-native/icarus-selection')
  const selectionHelper = new SelectionHelper(process.env.ICARUS_SELECTION_EXECUTABLE || selectionPath)
  const selection = new SelectionSession(target => selectionHelper.capture(target))
  let capturePending = false
  let connectionBusy = false
  const generations = new Map<string, AbortController>()
  let mainWindow: import('electron').BrowserWindow | undefined
  let popup: import('electron').BrowserWindow | undefined
  let popupLoad: Promise<void> | undefined
  let popupMode: ModeId | undefined
  let automaticInvocation = false
  let capturingSelection = false
  let popupThinking = false
  let invocationVersion = 0
  let popupAnchor: Point = { x: 0, y: 0 }
  let shortcutState: 'ready' | 'collision' = 'collision'
  const popupSize = { width: 370, height: 510 }
  const thinkingSize = { width: 112, height: 112 }
  const devURL = process.env.ICARUS_DEV_URL
  if (devURL) {
    const url = new URL(devURL)
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password) throw new Error('ICARUS_DEV_URL must use localhost HTTP')
  }
  const preload = path.join(__dirname, 'preload.cjs')

  function createPopup(): import('electron').BrowserWindow {
    if (!popup || popup.isDestroyed()) {
      const window = new BrowserWindow({
        ...popupSize,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
          preload,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      })
      popup = window
      window.on('blur', () => { if (!capturePending && !popupThinking) window.hide() })
      window.on('hide', () => {
        invocationVersion++
        selection.deny()
        for (const controller of generations.values()) controller.abort()
      })
      window.on('closed', () => {
        if (popup === window) {
          popup = undefined
          popupLoad = undefined
        }
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          event.preventDefault()
          window.hide()
        }
      })
      if (process.platform === 'darwin') {
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      }
      popupLoad = loadRenderer(window, 'popup.html', devURL)
      void popupLoad.catch(() => console.error('ICARUS command menu failed to load'))
    }
    return popup
  }

  async function showPopup(mode?: ModeId, external = false): Promise<void> {
    const version = ++invocationVersion
    const target = external ? await selectionHelper.target().catch(() => null) : null
    if (version !== invocationVersion) return
    for (const controller of generations.values()) controller.abort()
    popupMode = mode || (external ? 'analyze' : undefined)
    automaticInvocation = external
    const source = target?.pid === process.pid ? null : target
    selection.prepare(source, popupMode)
    capturingSelection = external && Boolean(source)
    capturePending = capturingSelection
    popupThinking = external
    popupAnchor = screen.getCursorScreenPoint()
    const window = createPopup()
    await popupLoad
    if (window.isDestroyed() || version !== invocationVersion) return
    window.setBounds(placePopup(popupAnchor, screen.getDisplayNearestPoint(popupAnchor).workArea,
      external ? thinkingSize : popupSize))
    if (process.platform === 'darwin') window.setVibrancy(external ? null : 'popover')
    window.webContents.send('icarus:invoked')
    if (external) window.showInactive()
    else { window.show(); window.focus() }
    if (capturingSelection) {
      const invocation = await selection.capture(source, popupMode)
      if (version !== invocationVersion || window.isDestroyed()) return
      if (invocation.bounds) {
        popupAnchor = { x: invocation.bounds.x + invocation.bounds.width, y: invocation.bounds.y + invocation.bounds.height }
        window.setBounds(placePopup(popupAnchor, screen.getDisplayNearestPoint(popupAnchor).workArea, thinkingSize))
      }
      capturingSelection = false
      capturePending = false
      window.webContents.send('icarus:invoked')
    }
  }

  function fromWindow(event: import('electron').IpcMainInvokeEvent,
    window: import('electron').BrowserWindow | undefined): boolean {
    return !!window && event.senderFrame === window.webContents.mainFrame
  }

  function publishGeneration(event: GenerationEvent): void {
    if (popup && !popup.isDestroyed()) popup.webContents.send('icarus:generation', event)
  }

  async function saveConnection(value: unknown, suppliedKey: unknown) {
    const settings = validateConnectionSettings(value)
    if (!settings || (suppliedKey !== undefined && (typeof suppliedKey !== 'string'
      || !suppliedKey.trim() || suppliedKey.length > 4096 || /[\r\n\0]/.test(suppliedKey)))) {
      return { status: 'error', message: 'Enter a supported provider, model ID, and valid token.' }
    }
    if (connectionBusy) return { status: 'error', message: 'A connection update is already running.' }
    connectionBusy = true
    const vault = settings.provider === 'huggingface' || settings.provider === 'openai' ? keychains[settings.provider] : null
    let previousConnection: ConnectionSettings | undefined
    let settingsWritten = false
    try {
      previousConnection = await backend.request<ConnectionSettings>('/v1/settings')
      const key = typeof suppliedKey === 'string' ? suppliedKey.trim() : vault ? await vault.get() : null
      if (vault && !key) return { status: 'error', message: 'Enter an API token for this provider.' }
      const test = await backend.request<{ status: string; message?: string }>('/v1/provider/test', 'POST',
        { ...settings, ...(vault && key ? { api_key: key } : {}) })
      if (test.status !== 'connected') return { status: 'error', message: test.message || 'Connection test failed.' }
      await backend.request('/v1/settings', 'PUT', settings)
      settingsWritten = true
      // Save the key last so a failed settings write cannot replace the old token.
      if (vault && typeof suppliedKey === 'string') await vault.set(suppliedKey.trim())
      for (const controller of generations.values()) controller.abort()
      return { status: 'saved' }
    } catch {
      if (settingsWritten && previousConnection) {
        try { await backend.request('/v1/settings', 'PUT', previousConnection) } catch { /* Report the failed save below. */ }
      }
      return { status: 'error', message: 'Could not save the connection. Check the local engine and macOS Keychain.' }
    } finally { connectionBusy = false }
  }

  async function runGeneration(requestId: string, request: StreamRequest,
    controller: AbortController): Promise<void> {
    try {
      const stream = await backend.stream(request, controller.signal)
      await consumeSSE(stream, event => publishGeneration({ requestId, ...event }))
    } catch {
      publishGeneration({ requestId, type: 'error', message: controller.signal.aborted
        ? 'Generation stopped' : 'Model request failed' })
    } finally {
      generations.delete(requestId)
    }
  }

  function createWindow(): void {
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 680,
      minHeight: 480,
      webPreferences: {
        preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    mainWindow = window
    window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())

    void loadRenderer(window, 'index.html', devURL).catch(() => {
      if (!window.isDestroyed()) dialog.showErrorBox('ICARUS could not load', 'Restart ICARUS and try again.')
    })
  }

  await app.whenReady()
  protocol.handle('icarus', async request => {
    const file = rendererAssetPath(request.url, path.join(__dirname, '../dist'))
    if (!file) return new Response('Not found', { status: 404 })
    try {
      const response = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(response.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('X-Content-Type-Options', 'nosniff')
      if (file.endsWith('.js')) headers.set('Content-Type', 'text/javascript')
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  ipcMain.handle('icarus:health', event => {
    if (!fromWindow(event, mainWindow)) {
      return { status: 'error', message: 'Unavailable' } satisfies HealthResult
    }
    return backend.health()
  })
  ipcMain.handle('icarus:shortcut-status', event => fromWindow(event, mainWindow)
    ? { status: shortcutState } : { status: 'error', message: 'Unavailable' })
  ipcMain.handle('icarus:open-popup', async (event, mode: unknown) => {
    if (!fromWindow(event, mainWindow)) return { status: 'error', message: 'Unavailable' }
    const validated = validatePopupMode(mode)
    if (validated && typeof validated === 'object') return validated
    try {
      await showPopup(validated)
      return { status: 'ok' }
    } catch {
      return { status: 'error', message: 'Command menu unavailable' }
    }
  })
  ipcMain.handle('icarus:connection-status', async event => {
    if (!fromWindow(event, mainWindow)) return { status: 'error', message: 'Unavailable' }
    try {
      const connection = await backend.request<ConnectionSettings>('/v1/settings')
      const keyStatus = connection.provider === 'huggingface' || connection.provider === 'openai'
        ? await keychains[connection.provider].status() : 'not_needed'
      return { status: 'ok', connection, keyStatus }
    } catch { return { status: 'error', message: 'Could not read the connection. Check the local engine.' } }
  })
  ipcMain.handle('icarus:save-connection', (event, settings: unknown, key: unknown) =>
    fromWindow(event, mainWindow) ? saveConnection(settings, key) : { status: 'error', message: 'Unavailable' })
  ipcMain.handle('icarus:test-connection', async (event, value: unknown) => {
    if (!fromWindow(event, mainWindow)) return { status: 'error', message: 'Unavailable' }
    const settings = validateConnectionSettings(value)
    if (!settings) return { status: 'error', message: 'Invalid connection' }
    try {
      const key = settings.provider === 'huggingface' || settings.provider === 'openai' ? await keychains[settings.provider].get() : null
      return await backend.request('/v1/provider/test', 'POST', { ...settings, ...(key ? { api_key: key } : {}) })
    } catch { return { status: 'error', message: 'Could not test the saved connection.' } }
  })
  ipcMain.handle('icarus:read-memory', event => {
    if (!fromWindow(event, mainWindow)) throw new Error('Unavailable')
    return backend.request('/v1/memory')
  })
  ipcMain.handle('icarus:save-memory', (event, value: unknown) => {
    if (!fromWindow(event, mainWindow)) throw new Error('Unavailable')
    const memory = parseMemory(JSON.stringify(value))
    if (!memory) throw new Error('Invalid project memory')
    return backend.request('/v1/memory', 'PUT', memory)
  })
  ipcMain.handle('icarus:history-status', async event => {
    if (!fromWindow(event, mainWindow)) throw new Error('Unavailable')
    const history = await backend.request<unknown[]>('/v1/history')
    return { count: history.length }
  })
  ipcMain.handle('icarus:clear-history', async event => {
    if (!fromWindow(event, mainWindow)) return { status: 'error' }
    try { await backend.request('/v1/history', 'DELETE'); return { status: 'ok' } }
    catch { return { status: 'error', message: 'Could not clear the response cache.' } }
  })
  ipcMain.handle('icarus:save-provider-key', async (event, value: unknown) => {
    if (!fromWindow(event, mainWindow)) return { status: 'error', message: 'Unavailable' }
    if (typeof value !== 'string' || !value.trim() || value.length > 4096
      || /[\r\n\0]/.test(value)) return { status: 'error', message: 'Invalid API key' }
    try {
      const settings = await backend.request<ConnectionSettings>('/v1/settings')
      return await saveConnection(settings, value)
    } catch {
      return { status: 'error', message: 'Could not save key to macOS Keychain' }
    }
  })
  ipcMain.handle('icarus:provider-key-status', async event => {
    if (!fromWindow(event, mainWindow)) return { status: 'error', message: 'Unavailable' }
    try {
      const settings = await backend.request<ConnectionSettings>('/v1/settings')
      return { status: settings.provider === 'huggingface' || settings.provider === 'openai'
        ? await keychains[settings.provider].status() : 'missing' }
    } catch {
      return { status: 'error', message: 'Could not read macOS Keychain' }
    }
  })
  ipcMain.handle('icarus:delete-provider-key', async event => {
    if (!fromWindow(event, mainWindow)) return { status: 'error', message: 'Unavailable' }
    try {
      if (connectionBusy) return { status: 'error', message: 'Wait for the connection update to finish.' }
      const settings = await backend.request<ConnectionSettings>('/v1/settings')
      if (settings.provider !== 'huggingface' && settings.provider !== 'openai') return { status: 'error', message: 'This local connection has no token.' }
      await keychains[settings.provider].delete()
      for (const controller of generations.values()) controller.abort()
      return { status: 'deleted' }
    } catch {
      return { status: 'error', message: 'Could not update macOS Keychain' }
    }
  })
  ipcMain.handle('icarus:get-invocation', event => fromWindow(event, popup)
    ? { ...selection.invocation, autoRun: automaticInvocation, capturing: capturingSelection,
      ...(popupMode ? { mode: popupMode } : {}) } : { selectedText: null })
  ipcMain.handle('icarus:popup-thinking', (event, thinking: unknown) => {
    if (!fromWindow(event, popup) || typeof thinking !== 'boolean' || !popup || popup.isDestroyed()) return { status: 'error' }
    const wasThinking = popupThinking
    popupThinking = thinking
    popup.setBounds(placePopup(popupAnchor, screen.getDisplayNearestPoint(popupAnchor).workArea,
      thinking ? thinkingSize : popupSize))
    if (process.platform === 'darwin') popup.setVibrancy(thinking ? null : 'popover')
    if (wasThinking && !thinking && popup.isVisible()) { popup.show(); popup.focus() }
    return { status: 'ok' }
  })
  ipcMain.handle('icarus:allow-selection', async event => {
    if (!fromWindow(event, popup)) return { selectedText: null }
    capturePending = true
    try {
      const invocation = await selection.allow()
      if (invocation.bounds && popup?.isVisible()) {
        const point = { x: invocation.bounds.x + invocation.bounds.width, y: invocation.bounds.y + invocation.bounds.height }
        popup.setBounds(placePopup(point, screen.getDisplayNearestPoint(point).workArea, popupSize))
      }
      return invocation
    } finally { capturePending = false }
  })
  ipcMain.handle('icarus:deny-selection', event => fromWindow(event, popup)
    ? selection.deny() : { selectedText: null })
  ipcMain.handle('icarus:accessibility-settings', async event => {
    if (!fromWindow(event, popup)) return { status: 'error' }
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    return { status: 'ok' }
  })
  ipcMain.handle('icarus:dismiss-popup', (event, returnHome: unknown) => {
    if (!fromWindow(event, popup)) return { status: 'error', message: 'Unavailable' }
    if (returnHome !== undefined && typeof returnHome !== 'boolean') return { status: 'error', message: 'Invalid request' }
    popup?.hide()
    if (returnHome) {
      mainWindow?.show()
      mainWindow?.focus()
    }
    return { status: 'ok' }
  })
  ipcMain.handle('icarus:copy-text', (event, value: unknown) => {
    if (!fromWindow(event, popup)) return { status: 'error', message: 'Unavailable' }
    if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 256 * 1024) {
      return { status: 'error', message: 'Invalid text' }
    }
    try {
      clipboard.writeText(value)
      return { status: 'ok' }
    } catch {
      return { status: 'error', message: 'Could not copy text' }
    }
  })
  ipcMain.handle('icarus:select-mode', async (event, mode: unknown, prompt: unknown, text: unknown, options: unknown) => {
    if (!fromWindow(event, popup)) return { status: 'error', message: 'Unavailable' } satisfies ModeResult
    if (connectionBusy) return { status: 'error', message: 'Wait for the model connection to finish, then retry.' } satisfies ModeResult
    const request = validateModeRequest(mode, prompt, selection.invocation.selectedText, text)
    if ('status' in request) return request
    const context = validateGenerationOptions(options)
    if (!context) {
      return { status: 'error', message: 'Invalid project context' }
    }
    let connection: ConnectionSettings
    let key: string | null = null
    let memory: ProjectMemory | undefined
    try { connection = await backend.request<ConnectionSettings>('/v1/settings') }
    catch { return { status: 'error', message: 'The local engine is unavailable. Restart ICARUS and retry.' } satisfies ModeResult }
    try {
      if (connection.provider === 'huggingface' || connection.provider === 'openai') key = await keychains[connection.provider].get()
      if (context?.includeMemory) memory = await backend.request<ProjectMemory>('/v1/memory')
    } catch {
      return { status: 'model_unavailable', message: 'macOS Keychain is unavailable.' } satisfies ModeResult
    }
    if ((connection.provider === 'huggingface' || connection.provider === 'openai') && !key) return { status: 'model_unavailable',
      message: 'Add and test an API token in Model connection.' } satisfies ModeResult
    const health = await backend.health()
    if (health.status !== 'ok') return { status: 'error', message: health.message } satisfies ModeResult
    for (const controller of generations.values()) controller.abort()
    const requestId = randomBytes(12).toString('hex')
    const controller = new AbortController()
    generations.set(requestId, controller)
    setImmediate(() => { void runGeneration(requestId, { ...request, ...connection,
      ...(key ? { api_key: key } : {}), ...(context?.building ? { building: context.building } : {}),
      ...(context.mood ? { mood: context.mood } : {}),
      ...(context.conversation ? { conversation: context.conversation } : {}),
      ...(memory ? { memory } : {}) }, controller) })
    return { status: 'started', requestId } satisfies ModeResult
  })
  ipcMain.handle('icarus:stop-generation', (event, requestId: unknown) => {
    if (!fromWindow(event, popup)) return { status: 'error', message: 'Unavailable' }
    if (typeof requestId !== 'string' || !/^[0-9a-f]{24}$/.test(requestId)) {
      return { status: 'error', message: 'Invalid request' }
    }
    const controller = generations.get(requestId)
    if (!controller) return { status: 'error', message: 'Request not active' }
    controller.abort()
    return { status: 'ok' }
  })
  void backend.start().catch(() => console.error('ICARUS local engine failed to start'))
  createWindow()
  createPopup()
  shortcutState = globalShortcut.register('CommandOrControl+Shift+Q', () => {
    void showPopup(undefined, true).catch(() => dialog.showErrorBox('ICARUS command menu unavailable', 'Restart ICARUS and try again.'))
  })
    ? 'ready' : 'collision'
  app.on('activate', () => { if (!mainWindow) createWindow() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  let quitting = false
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    globalShortcut.unregisterAll()
    for (const controller of generations.values()) controller.abort()
    void backend.stop().catch(() => console.error('ICARUS local engine could not stop')).finally(() => app.quit())
  })
}

if (process.versions.electron) void runElectron().catch(async () => {
  console.error('ICARUS startup failed')
  const { app, dialog } = await import('electron')
  dialog.showErrorBox('ICARUS could not start', 'Restart ICARUS and try again.')
  app.quit()
})

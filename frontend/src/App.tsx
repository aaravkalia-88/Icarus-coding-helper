import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import './App.css'
import { GlassAiButton } from './GlassAiButton'
import type { ConnectionSettings, ProviderName } from './icarus'

type HealthState =
  | { phase: 'checking' }
  | { phase: 'connected' }
  | { phase: 'unavailable'; message: string }

function IcarusMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M5.5 11.5c5.3 1.3 10 5.5 14.6 12.9L27.8 8.8c2.7 6 3.1 12.6 1.6 18.6" />
      <path d="M9.2 20.4c4.2 1.5 7.3 3.9 9.3 7.2M31.4 23.7l3.2-5.1" />
      <path className="brand-mark-arc" d="M7 31.5c7.2 3.4 16.8 2.6 24-2.2" />
    </svg>
  )
}

export function ProviderConnection() {
  const keyInput = useRef<HTMLInputElement>(null)
  const [connection, setConnection] = useState<ConnectionSettings>({ provider: 'huggingface', model: 'Qwen/Qwen3.8-27B' })
  const [savedProvider, setSavedProvider] = useState<ProviderName>('huggingface')
  const [status, setStatus] = useState<'checking' | 'configured' | 'missing' | 'error' | 'not_needed'>('checking')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackError, setFeedbackError] = useState(false)
  const [editing, setEditing] = useState(false)
  const remote = connection.provider === 'huggingface' || connection.provider === 'openai'
  const names = { huggingface: 'Hugging Face', openai: 'OpenAI', ollama: 'Ollama', lm_studio: 'LM Studio' }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const result = await window.icarus?.connectionStatus()
        if (!active) return
        if (result?.status !== 'ok') throw new Error(result?.message || 'Open ICARUS desktop to configure your model.')
        setConnection(result.connection)
        setSavedProvider(result.connection.provider)
        setStatus(result.keyStatus)
      } catch {
        if (active) { setStatus('error'); setFeedback('Could not read the saved connection. Check the local engine.'); setFeedbackError(true) }
      }
    }
    void load()
    return () => { active = false }
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = keyInput.current?.value.trim() || undefined
    if (keyInput.current) keyInput.current.value = ''
    setBusy(true); setFeedback('Testing the model server…'); setFeedbackError(false)
    try {
      const result = await window.icarus?.saveConnection(connection, token)
      if (result?.status !== 'saved') throw new Error(result?.message || 'The desktop connection is unavailable.')
      setStatus(remote ? 'configured' : 'not_needed'); setSavedProvider(connection.provider); setEditing(false)
      setFeedback(remote ? 'Connection tested. Token saved in macOS Keychain for future sessions.' : 'Local model tested and saved.')
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not save the connection.'); setFeedbackError(true) }
    finally { setBusy(false) }
  }

  async function testSaved() {
    setBusy(true); setFeedback('Testing the saved connection…'); setFeedbackError(false)
    try {
      const result = await window.icarus?.testConnection(connection)
      if (result?.status !== 'connected') throw new Error(result?.message || 'Could not test the connection.')
      setFeedback('The selected model is responding.')
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Connection test failed.'); setFeedbackError(true) }
    finally { setBusy(false) }
  }

  async function removeKey() {
    setBusy(true); setFeedback(''); setFeedbackError(false)
    try {
      const result = await window.icarus?.deleteProviderKey()
      if (result?.status !== 'deleted') throw new Error(result?.message || 'Could not remove the token.')
      setStatus('missing'); setFeedback('Token removed from macOS Keychain.')
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not remove the token.'); setFeedbackError(true) }
    finally { setBusy(false) }
  }

  return (
    <section className="provider-panel" aria-labelledby="provider-title">
      <div className="engine-panel-top"><span className="panel-kicker">MODEL CONNECTION</span><span className="panel-local">{remote ? 'CLOUD API' : 'LOCAL SERVER'}</span></div>
      <div className="provider-content">
        <h2 id="provider-title">{names[connection.provider]}</h2>
        <p className="provider-description">{remote ? 'Your token stays in macOS Keychain. Submitted code and context go to your selected provider.' : 'Requests stay on this Mac. Start the local server before testing.'}</p>
        <div className={`provider-status provider-status--${status}`} role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" />{status === 'checking' ? 'Reading connection…' : status === 'configured' ? 'Token saved' : status === 'not_needed' ? 'Local connection saved' : status === 'missing' ? 'Token needed' : 'Connection status unavailable'}</div>
        <form className="provider-form" onSubmit={event => void save(event)}>
          <label htmlFor="provider-name">Provider</label>
          <select id="provider-name" disabled={busy} value={connection.provider} onChange={event => {
            const provider = event.target.value as ProviderName
            setConnection({ provider, model: '' }); setEditing(true); setFeedback('')
            if (keyInput.current) keyInput.current.value = ''
            setStatus('missing')
          }}>
            <option value="huggingface">Hugging Face</option><option value="openai">OpenAI</option><option value="ollama">Ollama — localhost:11434</option><option value="lm_studio">LM Studio — localhost:1234</option>
          </select>
          <label htmlFor="provider-model">Model ID</label>
          <input id="provider-model" required maxLength={128} value={connection.model} disabled={busy} onChange={event => setConnection({ ...connection, model: event.target.value })} placeholder="Enter the model ID from your provider" autoComplete="off" spellCheck={false} />
          {remote && status === 'configured' && !editing && <button className="provider-manage" type="button" onClick={() => setEditing(true)} disabled={busy}>Replace token</button>}
          {remote && (editing || status !== 'configured') && <>
            <label htmlFor="provider-key">{names[connection.provider]} API token</label>
            <input ref={keyInput} id="provider-key" type="password" autoComplete="off" spellCheck={false} maxLength={4096} disabled={busy} placeholder="Paste a new token; leave blank to keep a saved token" />
            {editing && status === 'configured' && <button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel token replacement</button>}
          </>}
          <p className="provider-description">Testing sends a short “Reply OK” check. It does not send your code. Failed tests keep your previous connection.</p>
          <button type="submit" disabled={busy || !connection.model.trim()}>{busy ? 'Connecting…' : 'Test & save connection'}</button>
        </form>
        {feedback && <p className="provider-feedback" role={feedbackError ? 'alert' : 'status'}>{feedback}</p>}
      </div>
      <div className="engine-panel-bottom provider-bottom">
        <button type="button" disabled={busy || !connection.model.trim()} onClick={() => void testSaved()}>Test saved connection</button>
        {remote && status === 'configured' && connection.provider === savedProvider && <button type="button" onClick={() => void removeKey()} disabled={busy}>Remove token</button>}
      </div>
    </section>
  )
}

function LocalCache() {
  const [count, setCount] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const result = await window.icarus?.historyStatus()
        if (!result) throw new Error('Desktop unavailable')
        if (active) setCount(result.count)
      } catch {
        if (active) { setFeedback('Could not read the response cache.'); setFailed(true) }
      }
    }
    void load()
    return () => { active = false }
  }, [])
  return <section className="cache-panel" aria-label="Local response cache">
    <h2>Saved on this Mac</h2><p>Project notes and up to 50 recent answers are kept in the local ICARUS cache. API tokens stay in Keychain.</p>
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true)
      try { const result = await window.icarus?.clearHistory(); if (result?.status !== 'ok') throw new Error(); setCount(0); setFailed(false); setFeedback('Recent answers cleared. Your project notes and connection are kept.') }
      catch { setFeedback('Could not clear the response cache.'); setFailed(true) }
      finally { setBusy(false) }
    }}>{busy ? 'Clearing…' : `Clear recent answers${count === null ? '' : ` (${count})`}`}</button>
    {feedback && <p role={failed ? 'alert' : 'status'}>{feedback}</p>}
  </section>
}

function App() {
  const [health, setHealth] = useState<HealthState>({ phase: 'checking' })
  const requestId = useRef(0)
  const reduceMotion = useReducedMotion()
  const [shortcut, setShortcut] = useState<'checking' | 'ready' | 'collision' | 'error'>('checking')
  const [menuError, setMenuError] = useState('')

  const checkHealth = useCallback(async (initial = false) => {
    const currentRequest = ++requestId.current
    if (!initial) setHealth({ phase: 'checking' })

    if (!window.icarus?.health) {
      setHealth({
        phase: 'unavailable',
        message: 'The desktop connection is unavailable. Open ICARUS from the macOS app and try again.',
      })
      return
    }

    try {
      const response = await window.icarus.health()
      if (requestId.current !== currentRequest) return

      setHealth(
        response.status === 'ok'
          ? { phase: 'connected' }
          : {
              phase: 'unavailable',
              message: response.message || 'The local engine did not respond. Try the connection again.',
            },
      )
    } catch {
      if (requestId.current !== currentRequest) return
      setHealth({
        phase: 'unavailable',
        message: 'The local engine did not respond. Try the connection again.',
      })
    }
  }, [])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void checkHealth(true)
    })
    return () => {
      active = false
      requestId.current += 1
    }
  }, [checkHealth])

  useEffect(() => {
    let active = true
    void window.icarus?.shortcutStatus()
      .then(result => {
        if (active) setShortcut(result.status)
      })
      .catch(() => { if (active) setShortcut('error') })
    if (!window.icarus?.shortcutStatus) queueMicrotask(() => { if (active) setShortcut('error') })
    return () => { active = false }
  }, [])

  async function openMenu() {
    setMenuError('')
    try {
      const result = await window.icarus?.openPopup()
      if (result?.status !== 'ok') setMenuError(result?.message || 'Could not open the command menu.')
    } catch {
      setMenuError('Could not open the command menu.')
    }
  }

  const checking = health.phase === 'checking'
  const connected = health.phase === 'connected'
  const statusLabel = checking ? 'Connecting' : connected ? 'Connected' : 'Unavailable'

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand" aria-label="ICARUS">
          <span className="brand-mark"><IcarusMark /></span>
          <span className="brand-name">ICARUS</span>
        </div>
        <div className="header-meta" aria-label="Current model">
          <span className="header-model-dot" aria-hidden="true" />
          <span>YOUR MODEL</span>
          <span className="header-meta-divider" aria-hidden="true" />
          <span className="header-meta-muted">CONNECTION SETTINGS</span>
        </div>
        <div className={`header-status header-status--${health.phase}`} aria-label={`Local engine ${statusLabel.toLowerCase()}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>
      </header>

      <main className="app-main">
        <motion.div
          className="intro"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <p className="eyebrow">YOUR PROGRAMMING COMPANION</p>
          <h1>Think clearly.<br /><span>Keep your flow.</span></h1>
          <p className="intro-copy">Help for the code in front of you, right when you need it.</p>
          <div className="intro-emblem" aria-hidden="true">
            <div className="intro-emblem-glow" />
            <div className="intro-emblem-core"><IcarusMark /></div>
            <span>READY WHEN YOU ARE</span>
          </div>
        </motion.div>

        <div className="connection-grid">
        <section className={`engine-panel engine-panel--${health.phase}`} aria-labelledby="engine-title">
          <div className="engine-panel-top">
            <span className="panel-kicker">SYSTEM CONNECTION</span>
            <span className="panel-local">ON THIS MAC</span>
          </div>

          <div className="engine-content">
            <span className="engine-icon" aria-hidden="true">
              <span className="engine-icon-core" />
            </span>
            <div className="engine-copy" role="status" aria-live="polite">
              <h2 id="engine-title">Local engine</h2>
              {checking ? (
                <>
                  <p>Connecting to the service that runs ICARUS on your Mac…</p>
                  <span className="loading-bar" aria-hidden="true" />
                </>
              ) : connected ? (
                <p>Connected. Your on-device service is ready.</p>
              ) : (
                <p>{health.message}</p>
              )}
            </div>
          </div>

          <div className="engine-panel-bottom">
            <span className="connection-caption">Runs on this Mac</span>
            <button type="button" onClick={() => void checkHealth()} disabled={checking}>
              {checking ? 'Checking…' : connected ? 'Check again' : 'Retry connection'}
              {!checking && <span aria-hidden="true">↗</span>}
            </button>
          </div>
        </section>
        <ProviderConnection />
        </div>

        <div className="workflow-hint">
          <span className="shortcut-keys" aria-label="Command Shift Q"><kbd>⌘</kbd><kbd>⇧</kbd><kbd>Q</kbd></span>
          <p>{shortcut === 'collision' ? 'Shortcut unavailable in another app. Use the button to open ICARUS.' : shortcut === 'error' ? 'Shortcut status unavailable. The button can still open ICARUS.' : 'Select text in any app and press ⌘⇧Q to analyze it. The orb thinks, then your answer opens. Use the button to choose a mode.'}</p>
          <GlassAiButton className="workflow-glass" onActivate={() => void openMenu()} />
        </div>
        {menuError && <p className="menu-error" role="alert">{menuError}</p>}
        <LocalCache />
      </main>

      <footer className="app-footer">
        <span>LOCAL FIRST</span>
        <span>DESIGNED FOR MACOS</span>
      </footer>
    </div>
  )
}

export default App

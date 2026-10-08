import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ThinkingOrb } from 'thinking-orbs'
import type { ConversationTurn, GenerationEvent, GenerationOptions, ModeId, ModeResult, Mood } from './icarus'
import { generationError } from './generation-errors'
import './Popup.css'
import './Glass.css'

const commands: { id: ModeId; label: string; symbol: string }[] = [
  { id: 'logic_coach', label: 'Improve Logic', symbol: '◇' },
  { id: 'explain_mistake', label: 'Explain My Mistake', symbol: '!' },
  { id: 'fix_code', label: 'Fix Code', symbol: '↗' },
  { id: 'hint', label: 'Hint Mode', symbol: '✧' },
  { id: 'explain_code', label: 'Explain Code', symbol: '≡' },
  { id: 'refactor', label: 'Refactor', symbol: '⌁' },
  { id: 'ask_icarus', label: 'Ask ICARUS', symbol: '✦' },
  { id: 'full_solve', label: 'Full Solve', symbol: '↳' },
]

const moods: Record<Mood, { label: string; description: string }> = {
  friendly: { label: 'Friendly Guide', description: 'Clear explanations and a little encouragement.' },
  full_tutor: { label: 'Full Tutor', description: 'Build understanding, one step at a time.' },
  fun: { label: 'Fun', description: 'Playful analogies. Serious about helping you learn.' },
  gen_z: { label: 'Gen Z', description: 'Your coding buddy, with a more casual vibe.' },
}

type View = 'menu' | 'permission' | 'setup' | 'code' | 'ask' | 'loading' | 'response' | 'outcome'
type Context = 'checking' | 'selected' | 'none' | 'unavailable'
type Failure = Extract<ModeResult, { status: 'model_unavailable' | 'error' }>

export default function Popup() {
  const [view, setView] = useState<View>('loading')
  const [context, setContext] = useState<Context>('checking')
  const [activeIndex, setActiveIndex] = useState(6)
  const [draft, setDraft] = useState('')
  const [code, setCode] = useState('')
  const [workspaceMode, setWorkspaceMode] = useState<ModeId | null>(null)
  const [outcome, setOutcome] = useState<Failure | null>(null)
  const [lastRequest, setLastRequest] = useState<{ mode: ModeId; prompt?: string; text: string; options: GenerationOptions } | null>(null)
  const [sourceApp, setSourceApp] = useState('your app')
  const [building, setBuilding] = useState('')
  const [includeMemory, setIncludeMemory] = useState(false)
  const [mood, setMood] = useState<Mood>(() => {
    try {
      const saved = localStorage.getItem('icarus-mood')
      if (saved && Object.hasOwn(moods, saved)) return saved as Mood
    } catch { /* A blocked preference store must not prevent asking for help. */ }
    return 'friendly'
  })
  const [captureBusy, setCaptureBusy] = useState(false)
  const [permissionMessage, setPermissionMessage] = useState('')
  const [answer, setAnswer] = useState('')
  const [streamState, setStreamState] = useState<'streaming' | 'complete' | 'stopped' | 'error'>('streaming')
  const [streamMessage, setStreamMessage] = useState('')
  const [generationId, setGenerationId] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [capturing, setCapturing] = useState(false)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const input = useRef<HTMLTextAreaElement>(null)
  const requestId = useRef(0)
  const activeStreamId = useRef<string | null>(null)
  const pendingStart = useRef(false)
  const earlyEvents = useRef<GenerationEvent[]>([])
  const thinkingStarted = useRef(0)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submitModeRef = useRef(submitMode)
  const reduceMotion = useReducedMotion()
  const hasSelection = Boolean(code.trim())

  useLayoutEffect(() => { submitModeRef.current = submitMode })

  useEffect(() => {
    try { localStorage.setItem('icarus-mood', mood) } catch { /* Mood still applies to this session. */ }
  }, [mood])

  function cancelReveal() {
    if (revealTimer.current !== null) clearTimeout(revealTimer.current)
    revealTimer.current = null
  }

  const revealAfterThinking = useCallback((next: View) => {
    if (revealTimer.current !== null) clearTimeout(revealTimer.current)
    const currentRequest = requestId.current
    revealTimer.current = setTimeout(() => {
      revealTimer.current = null
      if (currentRequest === requestId.current) setView(next)
    }, Math.max(0, 5000 - (performance.now() - thinkingStarted.current)))
  }, [])

  useLayoutEffect(() => {
    void window.icarus?.setPopupThinking?.(view === 'loading').catch(() => console.error('Could not resize the ICARUS panel'))
  }, [view])

  useEffect(() => () => {
    cancelReveal()
    requestId.current++
    if (activeStreamId.current) void window.icarus?.stopGeneration(activeStreamId.current).catch(() => console.error('Could not stop the previous generation'))
  }, [])

  const applyGeneration = useCallback((event: GenerationEvent) => {
    if (event.type === 'delta') {
      if (!event.text) return
      setAnswer(previous => previous + event.text)
    } else {
      activeStreamId.current = null
      setGenerationId(null)
      if (event.type === 'done') {
        setStreamState('complete')
      } else {
        setStreamState(event.message === 'Generation stopped' ? 'stopped' : 'error')
        setStreamMessage(generationError(event.message))
      }
      revealAfterThinking('response')
    }
  }, [revealAfterThinking])

  useEffect(() => {
    return window.icarus?.onGeneration?.(event => {
      if (event.requestId === activeStreamId.current) applyGeneration(event)
      else if (pendingStart.current) earlyEvents.current.push(event)
    })
  }, [applyGeneration])

  useEffect(() => {
    let active = true
    let contextRequest = 0

    async function readInvocation(reset = false) {
      const currentRequest = ++contextRequest
      if (reset) {
        cancelReveal()
        if (activeStreamId.current) void window.icarus?.stopGeneration(activeStreamId.current).catch(() => console.error('Could not stop the previous generation'))
        activeStreamId.current = null
        pendingStart.current = false
        earlyEvents.current = []
        requestId.current += 1
        setView('loading')
        setContext('checking')
        setActiveIndex(6)
        setWorkspaceMode(null)
        setOutcome(null)
        setLastRequest(null)
        setAnswer('')
        setStreamMessage('')
        setGenerationId(null)
        setCopyState('idle')
        setCode('')
        setDraft('')
        setBuilding('')
        setIncludeMemory(false)
        setPermissionMessage('')
      }
      try {
        const invocation = await window.icarus?.getInvocation()
        if (!active || currentRequest !== contextRequest) return
        const selected = Boolean(invocation?.selectedText?.trim())
        setContext(invocation ? selected ? 'selected' : 'none' : 'unavailable')
        setCode(invocation?.selectedText || '')
        setSourceApp(invocation?.sourceApp || 'your app')
        setCapturing(Boolean(invocation?.capturing))
        if (invocation?.capturing) {
          setView('loading')
        } else if (invocation?.permissionRequired) {
          setView('permission')
        } else if (invocation?.autoRun && selected) {
          const mode = invocation.mode || 'analyze'
          void submitModeRef.current(mode, undefined, { mode, text: invocation.selectedText!, options: { mood } })
        } else if (invocation?.autoRun) {
          setPermissionMessage('No selected text was available. Select text in your app and use ⌘⇧Q again, or paste it here.')
          setView('setup')
        } else if (invocation?.mode) {
          setWorkspaceMode(invocation.mode)
          setActiveIndex(commands.findIndex(command => command.id === invocation.mode))
          setView(invocation.mode === 'ask_icarus' ? 'ask' : 'code')
        } else if (selected) {
          setActiveIndex(0)
          setView('menu')
        } else {
          setView('menu')
        }
      } catch {
        if (active && currentRequest === contextRequest) { setContext('unavailable'); setView('setup') }
      }
    }

    void readInvocation()
    const unsubscribe = window.icarus?.onInvocation?.(() => { void readInvocation(true) })
    return () => {
      active = false
      contextRequest += 1
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (view === 'menu') rows.current[hasSelection || commands[activeIndex]?.id === 'full_solve' ? activeIndex : 6]?.focus()
    if (view === 'ask' || view === 'code' || view === 'setup') input.current?.focus()
  }, [view, context, activeIndex, hasSelection])

  function focusRow(index: number) {
    setActiveIndex(index)
    rows.current[index]?.focus()
  }

  async function dismiss(returnHome = false) {
    cancelReveal()
    if (activeStreamId.current) void window.icarus?.stopGeneration(activeStreamId.current).catch(() => console.error('Could not stop the previous generation'))
    activeStreamId.current = null
    pendingStart.current = false
    earlyEvents.current = []
    requestId.current += 1
    try {
      if (!window.icarus?.dismissPopup) throw new Error('Bridge unavailable')
      const result = await window.icarus.dismissPopup(returnHome)
      if (result.status === 'error') throw new Error(result.message)
    } catch {
      setLastRequest(null)
      setOutcome({ status: 'error', message: 'The desktop connection is unavailable. Close this window from macOS.' })
      setView('outcome')
    }
  }

  async function submitMode(mode: ModeId, prompt?: string, replay?: typeof lastRequest) {
    if (pendingStart.current || activeStreamId.current) return
    const text = replay ? replay.text : code
    if (mode !== 'ask_icarus' && !text.trim()) return
    const question = prompt?.trim()
    if (mode === 'ask_icarus' && !question) return

    const currentRequest = ++requestId.current
    cancelReveal()
    thinkingStarted.current = performance.now()
    setCapturing(false)
    activeStreamId.current = null
    pendingStart.current = true
    earlyEvents.current = []
    const options = replay ? replay.options : { building, includeMemory, mood }
    setLastRequest({ mode, prompt: question, text, options })
    setOutcome(null)
    setAnswer('')
    setStreamState('streaming')
    setStreamMessage('')
    setGenerationId(null)
    setCopyState('idle')
    setView('loading')

    try {
      if (!window.icarus?.selectMode) throw new Error('Bridge unavailable')
      const result = await window.icarus.selectMode(mode, question, text || undefined, options)
      if (requestId.current !== currentRequest) {
        if (result.status === 'started') void window.icarus.stopGeneration(result.requestId).catch(() => console.error('Could not stop the previous generation'))
        return
      }
      pendingStart.current = false
      if (result.status === 'started') {
        setDraft('')
        activeStreamId.current = result.requestId
        setGenerationId(result.requestId)
        const buffered = earlyEvents.current.filter(event => event.requestId === result.requestId)
        earlyEvents.current = []
        buffered.forEach(applyGeneration)
        return
      }
      earlyEvents.current = []
      setOutcome(result)
    } catch {
      if (requestId.current !== currentRequest) return
      pendingStart.current = false
      earlyEvents.current = []
      setOutcome({ status: 'error', message: 'ICARUS could not reach the desktop service. Try again.' })
    }
    if (requestId.current === currentRequest) revealAfterThinking('outcome')
  }

  function chooseMode(mode: ModeId) {
    if (mode === 'ask_icarus') {
      setView('ask')
    } else if (mode === 'full_solve' && !hasSelection) {
      setWorkspaceMode(mode)
      setView('code')
    } else {
      void submitMode(mode)
    }
  }

  function returnToMenu() {
    cancelReveal()
    if (activeStreamId.current) void window.icarus?.stopGeneration(activeStreamId.current).catch(() => console.error('Could not stop the previous generation'))
    activeStreamId.current = null
    pendingStart.current = false
    requestId.current += 1
    setWorkspaceMode(null)
    setLastRequest(null)
    setDraft('')
    setView('menu')
  }

  function followUp() {
    if (!lastRequest || !answer.trim() || !draft.trim()) return
    // ponytail: keep three exchanges; use model-aware budgeting if long lessons need more context.
    const conversation: ConversationTurn[] = [...(lastRequest.options.conversation || []),
      { role: 'user', content: lastRequest.prompt || `Help me with the selected code using ${lastRequest.mode}.` },
      { role: 'assistant', content: answer.length > 8192 ? answer.slice(0, 8150) + '\n[Earlier answer truncated.]' : answer },
    ].slice(-6) as ConversationTurn[]
    void submitMode(lastRequest.mode, draft, { ...lastRequest, options: { ...lastRequest.options, mood, conversation } })
  }

  async function stopGeneration() {
    cancelReveal()
    const id = activeStreamId.current
    if (!id) return
    activeStreamId.current = null
    setGenerationId(null)
    try {
      const result = await window.icarus?.stopGeneration(id)
      if (result?.status === 'error') throw new Error(result.message)
      setStreamState('stopped')
      setStreamMessage('Generation stopped. Your partial answer is kept.')
    } catch {
      setStreamState('error')
      setStreamMessage('Could not stop generation. Close the panel to leave this request.')
    }
    setView('response')
  }

  async function copyAnswer() {
    if (!answer) return
    try {
      const result = await window.icarus?.copyText(answer)
      setCopyState(result?.status === 'ok' ? 'copied' : 'error')
    } catch {
      setCopyState('error')
    }
  }

  async function allowSelection() {
    setCaptureBusy(true)
    setPermissionMessage('')
    try {
      const invocation = await window.icarus?.allowSelection()
      if (!invocation) throw new Error('Desktop unavailable')
      if (invocation.permissionRequired) {
        setPermissionMessage('Enable ICARUS or icarus-selection in macOS Privacy & Security → Accessibility, then try again.')
        return
      }
      setCode(invocation.selectedText || '')
      setContext(invocation.selectedText ? 'selected' : 'none')
      if (!invocation.selectedText) setPermissionMessage('This app did not expose selected text. Copy your selection and paste it below.')
      setView('setup')
    } catch { setPermissionMessage('Could not read the selection. You can paste code instead.') }
    finally { setCaptureBusy(false) }
  }

  async function pasteInstead() {
    await window.icarus?.denySelection().catch(() => console.error('Could not cancel selection capture'))
    setContext('none'); setCode(''); setView('setup')
  }

  async function openAccessibilitySettings() {
    try {
      const result = await window.icarus?.openAccessibilitySettings()
      if (result?.status !== 'ok') throw new Error('Settings unavailable')
    } catch {
      setPermissionMessage('Could not open Accessibility settings. Open System Settings → Privacy & Security → Accessibility.')
    }
  }

  const contextFields = <div className="popup-project-context">
    <label htmlFor="icarus-building">What are you building? <span>(optional)</span></label>
    <input id="icarus-building" maxLength={500} value={building} onChange={event => setBuilding(event.target.value)} placeholder="A small API, a game, a coding exercise…" />
    <label className="popup-memory-choice"><input type="checkbox" checked={includeMemory} onChange={event => setIncludeMemory(event.target.checked)} />Use project notes in this request</label>
  </div>

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      void dismiss()
      return
    }
    if (view !== 'menu' || (event.target as HTMLElement).closest('select, input, textarea, .popup-mood')) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const enabled = hasSelection ? commands.map((_, index) => index) : [6, 7]
      const current = enabled.indexOf(activeIndex)
      const step = event.key === 'ArrowDown' ? 1 : -1
      focusRow(enabled[(current + step + enabled.length) % enabled.length])
    } else if (event.key === 'Enter') {
      if (!(event.target as HTMLElement).closest('.popup-command')) return
      event.preventDefault()
      chooseMode(commands[activeIndex].id)
    } else if (event.key.length === 1 && event.key.trim() && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      setDraft(event.key)
      chooseMode('ask_icarus')
    }
  }

  const title = lastRequest?.mode === 'analyze' ? 'Analyze selection' : lastRequest && commands.find(command => command.id === lastRequest.mode)?.label
  const workspaceLabel = commands.find(command => command.id === workspaceMode)?.label

  if (view === 'loading') return (
    <main className="popup-thinking" onKeyDown={handleKeyDown} aria-label="ICARUS is thinking">
      <button type="button" className="popup-orb-button" aria-label={generationId ? 'Stop generation' : 'Cancel thinking'}
        title="Click to stop · Esc to close" onClick={() => { if (generationId) void stopGeneration(); else void dismiss() }}>
        <ThinkingOrb state={capturing ? 'connecting' : lastRequest?.mode === 'full_solve' ? 'solving' : 'searching'} size={64} theme="dark" paused={Boolean(reduceMotion)} />
      </button>
      <span className="popup-visually-hidden" role="status" aria-live="polite">{capturing ? 'Reading your selection…' : 'ICARUS is thinking…'}</span>
    </main>
  )

  return (
    <main className="popup-shell" onKeyDown={handleKeyDown}>
      <motion.section
        className="popup-panel"
        aria-label="ICARUS quick panel"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.97, y: 5 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        <header className="popup-header">
          <div className="popup-brand">
            <svg className="popup-wing" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <path d="M5 11.5c4.9 1.3 10.2 5.2 15 12.8L27.8 9c2.4 5.7 3.1 12.8 1.9 18.4" />
              <path d="M9 20.5c3.9 1.3 7.2 3.7 9.8 7.2M31.5 23.6l3.6-5.3" />
            </svg>
            <span>ICARUS</span>
          </div>
          <button className="popup-code-button" type="button" onClick={() => void dismiss(true)}>Open app</button>
          <button className="popup-close" type="button" aria-label="Close ICARUS" onClick={() => void dismiss()}>×</button>
        </header>

        {view !== 'permission' && <div className="popup-mood">
          <div><label htmlFor="icarus-mood">ICARUS mood</label>
            <select id="icarus-mood" value={mood} onChange={event => setMood(event.target.value as Mood)}>
              {Object.entries(moods).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}
            </select>
          </div>
          <p>{moods[mood].description}</p>
        </div>}

        {view === 'permission' && <section className="popup-ask popup-consent" aria-labelledby="selection-permission-title">
          <p className="popup-feedback-kicker">SELECTED CODE / {sourceApp}</p>
          <h1 id="selection-permission-title">Enable selection capture.</h1>
          <p>Allow ICARUS or icarus-selection in macOS Privacy & Security → Accessibility to read highlighted text in {sourceApp}.</p>
          <p>⌘⇧Q analyzes your selection with your connected model. You can also paste text below.</p>
          {permissionMessage && <p role="status">{permissionMessage}</p>}
          <button type="button" className="popup-secondary" onClick={() => void openAccessibilitySettings()}>Open Accessibility settings</button>
          <div className="popup-actions"><button type="button" className="popup-secondary" disabled={captureBusy} onClick={() => void pasteInstead()}>Paste instead</button><button type="button" className="popup-primary" disabled={captureBusy} onClick={() => void allowSelection()}>{captureBusy ? 'Reading…' : 'Retry capture'}</button></div>
        </section>}

        {view === 'setup' && <form className="popup-ask popup-setup" onSubmit={event => { event.preventDefault(); void submitMode('analyze') }}>
          <label htmlFor="icarus-selection">{code ? `Code from ${sourceApp}` : 'Code for ICARUS'}</label>
          {permissionMessage && <p role="status">{permissionMessage}</p>}
          <textarea ref={input} id="icarus-selection" rows={4} maxLength={65536} value={code} onChange={event => setCode(event.target.value)} placeholder="Paste your selected code here…" spellCheck={false} />
          {contextFields}
          <p className="popup-privacy">Analyze infers the purpose from this excerpt. It does not inspect other files or run the code.</p>
          <div className="popup-actions"><button type="button" className="popup-secondary" onClick={() => { setActiveIndex(code.trim() ? 0 : 6); setView('menu') }}>Choose a mode</button><button type="submit" className="popup-primary" disabled={!code.trim()}>Analyze selection</button></div>
        </form>}

        {view === 'menu' && (
          <>
            <div className="popup-context" role="status" aria-live="polite">
              <span className={`popup-context-dot popup-context-dot--${context}`} aria-hidden="true" />
              <span>{hasSelection ? 'Code is ready' : context === 'checking' ? 'Checking selection…' : 'Add code or ask a question'}</span>
              <button type="button" className="popup-code-button" onClick={() => setView('code')}>{hasSelection ? 'Edit code' : 'Add code'}</button>
            </div>
            <div className="popup-menu" role="menu" aria-label="Programming modes">
              {commands.map((command, index) => {
                const disabled = command.id !== 'ask_icarus' && command.id !== 'full_solve' && !hasSelection
                return (
                  <button
                    key={command.id}
                    ref={element => { rows.current[index] = element }}
                    type="button"
                    role="menuitem"
                    className={`popup-command ${index === activeIndex ? 'popup-command--active' : ''}`}
                    tabIndex={index === activeIndex ? 0 : -1}
                    disabled={disabled}
                    title={disabled ? 'Add code to use this mode' : undefined}
                    onFocus={() => setActiveIndex(index)}
                    onClick={() => chooseMode(command.id)}
                  >
                    <span className="popup-command-icon" aria-hidden="true">{command.symbol}</span>
                    <span>{command.label}</span>
                    {index === activeIndex && !disabled && <span className="popup-command-enter" aria-hidden="true">↵</span>}
                  </button>
                )
              })}
            </div>
            <footer className="popup-footer"><span>↑↓ Navigate</span><span>↵ Select</span><span>esc Close</span></footer>
          </>
        )}

        {view === 'code' && (
          <form className="popup-ask" onSubmit={event => {
            event.preventDefault()
            if (workspaceMode) {
              void submitMode(workspaceMode)
              return
            }
            setActiveIndex(code.trim() ? 0 : 6)
            setView('menu')
          }}>
            <label htmlFor="icarus-code">{workspaceLabel || 'Code for ICARUS'}</label>
            <p>{workspaceMode === 'full_solve' ? 'Paste a problem or code for a complete solution with an explanation.' : 'Paste the code you want to explain, fix, or refactor.'}</p>
            <textarea ref={input} id="icarus-code" value={code} onChange={event => setCode(event.target.value)} rows={7} maxLength={65536} spellCheck={false} placeholder={workspaceMode === 'full_solve' ? 'Paste your problem or code here…' : 'Paste your code here…'} />
            {contextFields}
            <div className="popup-actions">
              <button type="button" className="popup-secondary" onClick={returnToMenu}>Back</button>
              <button type="submit" className="popup-primary" disabled={Boolean(workspaceMode) && !code.trim()}>{workspaceLabel ? `Run ${workspaceLabel}` : code.trim() ? 'Use code' : 'Clear code'}</button>
            </div>
          </form>
        )}

        {view === 'ask' && (
          <form className="popup-ask" onSubmit={event => { event.preventDefault(); void submitMode('ask_icarus', draft) }}>
            <label htmlFor="icarus-question">Ask ICARUS</label>
            <p>Stuck on a concept, a bug, or where to start? Let’s work through it.</p>
            <textarea
              ref={input}
              id="icarus-question"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submitMode('ask_icarus', draft)
                }
              }}
              rows={5}
              maxLength={4096}
              placeholder="Type a programming question…"
            />
            {contextFields}
            <div className="popup-actions">
              <button type="button" className="popup-secondary" onClick={returnToMenu}>Back</button>
              <button type="submit" className="popup-primary" disabled={!draft.trim()}>Ask ICARUS <span aria-hidden="true">↗</span></button>
            </div>
            <span className="popup-input-tip">Enter to send · Shift + Enter for a new line</span>
          </form>
        )}

        {view === 'response' && (
          <article className="popup-response" aria-label={`${title || 'ICARUS'} response`}>
            <div className="popup-response-head">
              <span className="popup-feedback-kicker">{title || 'ICARUS'}</span>
              <span className="popup-stream-status" role="status" aria-live="polite">
                {streamState === 'streaming' ? 'Streaming…' : streamState === 'complete' ? 'Complete' : streamState === 'stopped' ? 'Stopped' : 'Interrupted'}
              </span>
            </div>
            <div className="popup-answer" tabIndex={0}>
              {answer || (streamState === 'complete' ? 'The model returned no text.' : streamState === 'stopped' ? 'Stopped before any text arrived.' : '')}
            </div>
            {streamMessage && <p className="popup-stream-message" role={streamState === 'error' ? 'alert' : 'status'}>{streamMessage}</p>}
            <div className="popup-response-actions">
              <button type="button" className="popup-secondary" onClick={returnToMenu}>Back</button>
              {answer && <button type="button" className="popup-secondary" onClick={() => void copyAnswer()}>{copyState === 'copied' ? 'Copied' : 'Copy'}</button>}
              {generationId ? (
                <button type="button" className="popup-primary" onClick={() => void stopGeneration()}>Stop</button>
              ) : lastRequest && (
                <button type="button" className="popup-primary" onClick={() => void submitMode(lastRequest.mode, lastRequest.prompt, lastRequest)}>Retry</button>
              )}
            </div>
            {copyState === 'error' && <p className="popup-copy-error" role="alert">Could not copy the answer.</p>}
            {!generationId && answer.trim() && lastRequest && <form className="popup-follow-up" onSubmit={event => { event.preventDefault(); followUp() }}>
              <label htmlFor="icarus-follow-up">Follow-up question</label>
              <div><input id="icarus-follow-up" value={draft} maxLength={4096} onChange={event => setDraft(event.target.value)} placeholder={lastRequest.mode === 'hint' ? 'Ask for another hint…' : 'Ask why, or try another example…'} />
                <button type="submit" className="popup-primary" disabled={!draft.trim()}>Send follow-up</button></div>
              <p>Keeps this code and the last 3 exchanges. Back starts a new conversation.</p>
            </form>}
          </article>
        )}

        {view === 'outcome' && (
          <div className="popup-feedback" role="alert">
            <span className="popup-feedback-kicker">{title || 'ICARUS'}</span>
            <h1>{outcome?.status === 'model_unavailable' ? 'Model unavailable' : 'Request could not start'}</h1>
            <p>{outcome?.message || 'Try again in a moment.'}</p>
            <div className="popup-actions">
              <button type="button" className="popup-secondary" onClick={returnToMenu}>Back to commands</button>
              {lastRequest && <button type="button" className="popup-primary" onClick={() => void submitMode(lastRequest.mode, lastRequest.prompt, lastRequest)}>Retry</button>}
            </div>
          </div>
        )}
      </motion.section>
    </main>
  )
}

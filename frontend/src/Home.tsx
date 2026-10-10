import { useEffect, useRef, useState, type FormEvent } from 'react'
import { memoryKey, parseMemory, readHomeAction, type ProjectMemory } from './home-data'
import { KageLandingPage } from './KageLandingPage'
import world from '../public/landing-pages/icarus-kage.html?raw'
import './Home.css'

const emptyMemory = { project: '', goal: '', notes: '' }

function MemoryDialog({ memory, close, save }: { memory: ProjectMemory; close: () => void; save: (memory: ProjectMemory) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(memory)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      if (!window.icarus?.saveMemory) throw new Error('Desktop unavailable')
      await window.icarus.saveMemory(draft)
      localStorage.removeItem(memoryKey)
      save(draft)
      close()
    } catch { setError('Your notes could not be saved. Keep this window open and check the local engine.') }
    finally { setBusy(false) }
  }
  return (
    <dialog ref={dialog} className="home-memory" aria-labelledby="memory-title" onCancel={close}>
      <button type="button" className="memory-close" aria-label="Close project memory" onClick={close}>×</button>
      <p className="home-kicker">SAVED ON THIS MAC</p>
      <h2 id="memory-title">Remember the build.</h2>
      <p>Your project context is saved locally. Include it in an answer only when you choose “Use project notes”.</p>
      <form onSubmit={event => void submit(event)}>
        <label htmlFor="memory-project">Current project</label>
        <input id="memory-project" maxLength={160} value={draft.project} onChange={event => setDraft({ ...draft, project: event.target.value })} placeholder="Name your project" />
        <label htmlFor="memory-goal">Current goal</label>
        <input id="memory-goal" maxLength={500} value={draft.goal} onChange={event => setDraft({ ...draft, goal: event.target.value })} placeholder="What are you working toward?" />
        <label htmlFor="memory-notes">Decisions & notes</label>
        <textarea id="memory-notes" rows={5} maxLength={8000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="Keep the things you want to remember…" />
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="home-primary" disabled={busy}>{busy ? 'Saving…' : 'Save on this Mac'} <span aria-hidden="true">↗</span></button>
      </form>
    </dialog>
  )
}

export default function Home({ settings, archive, settingsOpen }: { settings: () => void; archive: () => void; settingsOpen: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memory, setMemory] = useState<ProjectMemory>(() => {
    try { return parseMemory(localStorage.getItem(memoryKey)) || emptyMemory } catch { return emptyMemory }
  })

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const saved = await window.icarus?.readMemory()
        if (!saved || !active) return
        const legacy = parseMemory(localStorage.getItem(memoryKey))
        if (legacy && !saved.project && !saved.goal && !saved.notes) {
          const migrated = await window.icarus!.saveMemory(legacy)
          localStorage.removeItem(memoryKey)
          if (active) setMemory(migrated)
        } else { localStorage.removeItem(memoryKey); setMemory(saved) }
      } catch { /* Existing notes stay available if the service is offline. */ }
    }
    void load()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      // srcDoc has an opaque origin. Validate the exact frame window and action.
      if (event.source !== host.current?.querySelector('iframe')?.contentWindow) return
      const request = readHomeAction(event.data)
      if (!request) return
      if (request.action === 'settings') { settings(); return }
      if (request.action === 'archive') { archive(); return }
      if (request.action === 'memory') { setMemoryOpen(true); return }
      if (request.action !== 'mode') return
      setError('')
      try {
        const result = await window.icarus?.openPopup(request.mode)
        if (result?.status !== 'ok') setError(result?.message || 'Open the ICARUS desktop app to use this mode.')
      } catch { setError('The mode could not open. Try again.') }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [settings, archive])

  return (
    <div className="icarus-home">
      <div ref={host} className="home-kage-page" inert={settingsOpen || memoryOpen}>
        <KageLandingPage
          active={!settingsOpen && !memoryOpen}
          headingFont="onest" bodyFont="onest" headingWeight="400" bodyWeight="300"
          primaryColor="#e0231c" headingSize={46} bodySize={17} headingLetterSpacing={-.012}
          srcDoc={world}
        />
      </div>
      {error && <div className="home-error" role="alert">{error}<button type="button" aria-label="Dismiss message" onClick={() => setError('')}>×</button></div>}
      {memoryOpen && <MemoryDialog memory={memory} save={setMemory} close={() => setMemoryOpen(false)} />}
    </div>
  )
}

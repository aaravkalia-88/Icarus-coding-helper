import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BestsellersBookShowcase } from '@designcodeio/threeui'
import '@designcodeio/threeui/style.css'
import booksPage from '../public/landing-pages/icarus-bestsellers.html?raw'
import { readEntryAction } from './entry-actions'
import './Landing.css'
import './Glass.css'

const Settings = lazy(() => import('./App'))
const Models = lazy(() => import('./Models'))
const Home = lazy(() => import('./Home'))
type DialogKind = 'settings' | 'models'

export function Scene() {
  return (
    <div className="shader-frame">
      <BestsellersBookShowcase
        srcDoc={booksPage}
        headingFont="iowan-old-style"
        bodyFont="iowan-old-style"
        headingWeight="500"
        bodyWeight="400"
        primaryColor="#c3a47b"
        headingSize={325}
        bodySize={17}
        headingLetterSpacing={-0.085}
      />
    </div>
  )
}

function SettingsDialog({ kind, close }: { kind: DialogKind; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return (
    <dialog ref={dialog} className="icarus-settings" aria-label={kind === 'models' ? 'ICARUS model connection' : 'ICARUS connections and settings'} onCancel={close}>
      <button type="button" className="settings-close" onClick={close} aria-label={kind === 'models' ? 'Close models' : 'Close settings'} autoFocus>×</button>
      <Suspense fallback={<p className="settings-loading" role="status">Opening {kind}…</p>}>
        {kind === 'models' ? <Models /> : <Settings />}
      </Suspense>
    </dialog>
  )
}

export default function Landing() {
  const host = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [screen, setScreen] = useState<'landing' | 'home'>('landing')

  useEffect(() => {
    if (screen !== 'landing') return
    const timeout = window.setTimeout(() => setPhase('error'), 45000)
    const receive = (event: MessageEvent) => {
      const frame = host.current?.querySelector('iframe')?.contentWindow ?? null
      if (!frame || event.source !== frame) return
      if (event.data?.type === 'icarus-entry-ready') {
        window.clearTimeout(timeout)
        setPhase('ready')
        return
      }
      const action = readEntryAction(event.data, event.source, frame)
      if (action === 'code') setScreen('home')
      else if (action === 'settings' || action === 'models') setDialog(action)
    }
    window.addEventListener('message', receive)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('message', receive)
    }
  }, [screen])

  function closeDialog() {
    setDialog(null)
    host.current?.querySelector('iframe')?.contentWindow?.postMessage({ type: 'icarus-entry-reset' }, '*')
  }

  if (screen === 'home') return (
    <>
      <Suspense fallback={<div className="home-loading" role="status">Entering ICARUS…</div>}>
        <Home settings={() => setDialog('settings')} archive={() => { setPhase('loading'); setScreen('landing') }} settingsOpen={dialog !== null} />
      </Suspense>
      {dialog && <SettingsDialog kind={dialog} close={closeDialog} />}
    </>
  )

  return (
    <main ref={host} className={`icarus-landing icarus-landing--${phase}`} aria-label="ICARUS — Ignite your mind">
      <Scene />
      {phase === 'error' && <p className="scene-error" role="alert">The library could not load. Reload the window to try again.</p>}
      {dialog && <SettingsDialog kind={dialog} close={closeDialog} />}
    </main>
  )
}

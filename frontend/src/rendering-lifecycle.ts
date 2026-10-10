import { useCallback, useEffect, useRef } from 'react'

// Native minimize/hide events cover sandbox frames whose visibility stays visible.
function observeRendering(update: (active: boolean) => void) {
  let nativeActive = true
  const sync = () => update(nativeActive && !document.hidden)
  const unsubscribe = window.icarus?.onRenderingState(active => { nativeActive = active; sync() })
  document.addEventListener('visibilitychange', sync)
  sync()
  return () => { unsubscribe?.(); document.removeEventListener('visibilitychange', sync) }
}

export function useDocumentRendering() {
  useEffect(() => observeRendering(active => {
    document.documentElement.dataset.icarusRendering = active ? 'active' : 'paused'
  }), [])
}

export function useFrameRendering(active = true) {
  const host = useRef<HTMLDivElement>(null)
  const state = useRef({ document: true, viewport: true, active })
  const sync = useCallback(() => {
    host.current?.querySelector('iframe')?.contentWindow?.postMessage({
      type: 'icarus-render-state', active: Object.values(state.current).every(Boolean),
    }, '*')
  }, [])
  useEffect(() => { state.current.active = active; sync() }, [active, sync])
  useEffect(() => {
    const stop = observeRendering(visible => { state.current.document = visible; sync() })
    const observer = new IntersectionObserver(([entry]) => {
      state.current.viewport = entry?.isIntersecting ?? false; sync()
    })
    if (host.current) observer.observe(host.current)
    return () => { stop(); observer.disconnect() }
  }, [host, sync])
  return [host, sync] as const
}

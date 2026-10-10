(() => {
  let parentActive = true;
  let disposed = false;
  const playing = new Set();
  window.__icarusRendering = !document.hidden;
  function sync() {
    const active = parentActive && !document.hidden && !disposed;
    document.documentElement.dataset.icarusRendering = active ? 'active' : 'paused';
    if (active === window.__icarusRendering) return;
    window.__icarusRendering = active;
    if (!active) {
      document.querySelectorAll('video').forEach(video => {
        if (!video.paused) { playing.add(video); video.pause(); }
      });
    } else {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        playing.forEach(video => { video.play()?.catch(() => {}); });
      }
      playing.clear();
    }
    dispatchEvent(new Event('icarus-render-state'));
  }
  addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'icarus-render-state'
      || typeof event.data.active !== 'boolean') return;
    parentActive = event.data.active;
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  addEventListener('pagehide', () => { disposed = true; sync(); playing.clear(); });
  sync();
})();

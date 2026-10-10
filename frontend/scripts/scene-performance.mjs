import { readFile } from 'node:fs/promises'

const lifecycle = await readFile(new URL('./rendering-lifecycle.js', import.meta.url), 'utf8')
export function withRenderingLifecycle(page) {
  return replace(page, '<head>', `<head><style id="icarus-render-style">html[data-icarus-rendering="paused"] *,html[data-icarus-rendering="paused"] *::before,html[data-icarus-rendering="paused"] *::after{animation-play-state:paused!important}</style><script id="icarus-render-lifecycle">${lifecycle}</script>`)
}

function replace(page, anchor, value) {
  if (!page.includes(anchor)) throw new Error(`Scene performance anchor missing: ${anchor.slice(0, 70)}`)
  return page.replace(anchor, value)
}

export function optimizeKage(page) {
  page = replace(page, '  (function tick() {\n    x = lerp', '  let cursorFrame = 0;\n  function tick() {\n    cursorFrame = 0;\n    x = lerp')
  page = replace(page, '    requestAnimationFrame(tick);\n  })();', `    if (Math.abs(x - tx2) > .05 || Math.abs(y - ty) > .05) wakeCursor();
    else { x = tx2; y = ty; dot.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)'; }
  }
  function wakeCursor() {
    if (!cursorFrame && window.__icarusRendering && !document.hidden) cursorFrame = requestAnimationFrame(tick);
  }
  addEventListener('icarus-render-state', () => {
    cancelAnimationFrame(cursorFrame); cursorFrame = 0; wakeCursor();
  });
  wakeCursor();`)
  page = replace(page, '    tx2 = e.clientX; ty = e.clientY;', '    tx2 = e.clientX; ty = e.clientY; wakeCursor();')
  page = replace(page, "b.addEventListener('click', () => scrollTo({ top: anchors[i], behavior: REDUCE ? 'auto' : 'smooth' }));", "b.addEventListener('click', () => { measure(); scrollTo({ top: anchors[i], behavior: REDUCE ? 'auto' : 'smooth' }); });")
  page = replace(page, '    if (!visible) { running = false; return; }', '    if (!visible || !window.__icarusRendering || document.hidden) { running = false; return; }')
  page = replace(page, '    if (dead || running || !visible) return;', '    if (dead || running || !visible || !window.__icarusRendering || document.hidden) return;')
  page = replace(page, "  document.addEventListener('visibilitychange', onHidden);", "  document.addEventListener('visibilitychange', onHidden);\n  addEventListener('icarus-render-state', () => { running = false; cancelAnimationFrame(raf); start(); });")
  page = replace(page, '  queue();\n}\nconst TIMER', `  if (!REDUCE || fadeIn < 1 || RIG.intro < 1 || Math.abs(RIG.smooth - RIG.prog) > .0001
    || Math.abs(RIG.mx - RIG.tmx) > .0001 || Math.abs(RIG.my - RIG.tmy) > .0001) queue();
}
const TIMER`)
  page = replace(page, 'function queue() { TIMER ? setTimeout(() => frame(performance.now()), 16) : requestAnimationFrame(frame); }', `let sceneFrame = 0;
function cancelSceneFrame() { TIMER ? clearTimeout(sceneFrame) : cancelAnimationFrame(sceneFrame); sceneFrame = 0; }
function queue() {
  if (sceneFrame || !running || !window.__icarusRendering || document.hidden) return;
  const next = now => { sceneFrame = 0; frame(now); };
  sceneFrame = TIMER ? setTimeout(() => next(performance.now()), 16) : requestAnimationFrame(next);
}`)
  page = replace(page, `  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; }
    else if (!running) { running = true; tPrev = performance.now(); queue(); }
  });`, `  const syncRendering = () => {
    cancelSceneFrame(); running = window.__icarusRendering && !document.hidden;
    tPrev = performance.now(); if (running) queue();
  };
  addEventListener('icarus-render-state', syncRendering);
  document.addEventListener('visibilitychange', syncRendering);
  addEventListener('scroll', () => { measure(); queue(); }, { passive: true });
  for (const event of ['pointermove', 'pointerover', 'pointerout', 'resize']) addEventListener(event, queue, { passive: true });
  const layoutObserver = new ResizeObserver(() => { measure(); queue(); });
  layoutObserver.observe(document.body);
  addEventListener('pagehide', () => { layoutObserver.disconnect(); running = false; cancelSceneFrame(); renderer.dispose(); });`)
  return page
}

export function optimizeGlass(page) {
  page = replace(page, 'let needsRender=true;', `let glassFrame=0;
function queueGlassFrame(){if(!glassFrame&&window.__icarusRendering&&!document.hidden)glassFrame=requestAnimationFrame(animate);}
let needsRender=true;`)
  page = replace(page, 'function animate(ms){requestAnimationFrame(animate);', 'function animate(ms){glassFrame=0;')
  page = replace(page, 'if(document.hidden||(paused', 'if(!window.__icarusRendering||document.hidden||(paused')
  page = replace(page, "canvas.dataset.motion=paused?'paused':'playing';}", "canvas.dataset.motion=paused?'paused':'playing';queueGlassFrame();}")
  page = replace(page, 'requestAnimationFrame(animate);\ncanvas.addEventListener', `queueGlassFrame();
for(const event of ['pointermove','pointerover','pointerout','pointerdown','pointerup','click','keydown','resize','blur','change'])window.addEventListener(event,queueGlassFrame,{passive:true});
motionPreference.addEventListener('change',queueGlassFrame);
window.addEventListener('icarus-render-state',()=>{cancelAnimationFrame(glassFrame);glassFrame=0;last=performance.now();queueGlassFrame();});
window.addEventListener('pagehide',()=>{cancelAnimationFrame(glassFrame);renderer.dispose();});
canvas.addEventListener`)
  return page
}

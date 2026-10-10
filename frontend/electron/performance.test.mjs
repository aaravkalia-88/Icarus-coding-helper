import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const read = file => readFile(new URL(file, import.meta.url), 'utf8')

test('the custom cursor settles, coalesces movement, suspends, and resumes', async () => {
  const page = await read('../public/landing-pages/icarus-kage.html')
  const source = page.match(/function wireCursor\(\) \{[\s\S]*?(?=\nfunction makeGrain)/)[0]
  const listeners = {}, frames = new Map(), dot = { style: {}, classList: { add() {}, remove() {} } }
  let id = 0
  const context = {
    window: { __icarusRendering: true }, document: { hidden: false },
    COARSE: false, RIG: {}, $: () => dot, $$: () => [], vpW: () => 1200, vpH: () => 800,
    lerp: (a, b, t) => a + (b - a) * t,
    addEventListener: (name, callback) => { listeners[name] = callback },
    requestAnimationFrame: callback => { frames.set(++id, callback); return id },
    cancelAnimationFrame: key => frames.delete(key),
  }
  const flush = () => { for (let i = 0; i < 200 && frames.size; i++) { const pending = [...frames.values()]; frames.clear(); pending.forEach(f => f()) } }
  runInNewContext(`${source}\nwireCursor();`, context)
  flush()
  assert.equal(frames.size, 0, 'a stationary cursor must not schedule frames')
  for (let i = 0; i < 100; i++) listeners.pointermove({ clientX: 100, clientY: 200 })
  assert.equal(frames.size, 1, 'movement coalesces to one frame')
  flush()
  assert.equal(frames.size, 0)
  assert.equal(dot.style.transform, 'translate3d(100.0px,200.0px,0)')
  listeners.pointermove({ clientX: 700, clientY: 500 })
  context.window.__icarusRendering = false
  listeners['icarus-render-state']()
  assert.equal(frames.size, 0, 'hiding cancels the pending frame')
  context.window.__icarusRendering = true
  listeners['icarus-render-state']()
  flush()
  assert.equal(frames.size, 0)
  assert.equal(dot.style.transform, 'translate3d(700.0px,500.0px,0)')
})

test('sandbox lifecycle accepts only its parent, pauses media and CSS, and resumes prior playback', async () => {
  const page = await read('../public/landing-pages/icarus-kage.html')
  const source = page.match(/<script id="icarus-render-lifecycle">([\s\S]*?)<\/script>/)?.[1]
  assert.ok(source, 'the scene needs an explicit rendering lifecycle')
  const listeners = {}, parent = {}, events = [], dataset = {}
  const video = { paused: false, play() { this.paused = false; return Promise.resolve() }, pause() { this.paused = true } }
  const pausedVideo = { ...video, paused: true }
  const context = {
    window: { parent }, Set, Event: class { constructor(type) { this.type = type } },
    document: { hidden: false, documentElement: { dataset }, querySelectorAll: () => [video, pausedVideo], addEventListener: (name, callback) => { listeners[name] = callback } },
    addEventListener: (name, callback) => { listeners[name] = callback },
    dispatchEvent: event => events.push(event.type),
  }
  runInNewContext(source, context)
  const send = (source, active) => listeners.message({ source, data: { type: 'icarus-render-state', active } })
  send({}, false)
  send(parent, 'false')
  assert.equal(context.window.__icarusRendering, true)
  send(parent, false)
  assert.equal(context.window.__icarusRendering, false)
  assert.equal(video.paused, true)
  assert.equal(dataset.icarusRendering, 'paused')
  const count = events.length
  send(parent, false)
  assert.equal(events.length, count, 'duplicate state does no work')
  send(parent, true)
  assert.equal(video.paused, false)
  assert.equal(pausedVideo.paused, true, 'a manually paused video stays paused')
  context.document.hidden = true
  listeners.visibilitychange()
  assert.equal(context.window.__icarusRendering, false)
  send(parent, true)
  assert.equal(context.window.__icarusRendering, false, 'parent cannot wake a minimized document')
  listeners.pagehide()
  assert.equal(context.window.__icarusRendering, false)
})

test('both desktop windows throttle in the background and the hidden popup starts hidden', async () => {
  const main = await read('./main.ts')
  assert.equal((main.match(/backgroundThrottling: true/g) || []).length, 2)
  assert.ok(main.includes('paintWhenInitiallyHidden: false'))
  assert.ok(!main.includes('disableHardwareAcceleration('))
})

test('book media is served once as original bytes instead of parsed inside JavaScript', async () => {
  const page = await read('../public/landing-pages/icarus-bestsellers.html')
  assert.ok(!/data:(?:image\/jpeg|video\/mp4);base64,/.test(page), 'heavy media must be external')
  const original = await read('../vendor/threeui/public/landing-pages/bestsellers-book-showcase.html')
  const media = [...original.matchAll(/data:(image\/jpeg|video\/mp4);base64,([A-Za-z0-9+/=]+)/g)]
  const urls = [...page.matchAll(/(?:src|poster)="(\/landing-pages\/book-assets\/[^"\s]+)"/g)]
  assert.equal(urls.length, media.length)
  for (let i = 0; i < media.length; i++) {
    assert.deepEqual(await readFile(new URL(`../public${urls[i][1]}`, import.meta.url)), Buffer.from(media[i][2], 'base64'))
  }
})

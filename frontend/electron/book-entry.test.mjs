import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const read = file => readFile(new URL(file, import.meta.url), 'utf8')
const entry = () => read('../public/landing-pages/icarus-bestsellers.html')

test('the first page uses the requested book showcase instead of the sword scene', async () => {
  const landing = await read('../src/Landing.tsx')
  assert.ok(landing.includes('<BestsellersBookShowcase'), 'the entry screen must render BestsellersBookShowcase')
  assert.ok(!landing.includes('DarkSoulsHoloCard'))
})

test('the complete registered book source remains byte exact', async () => {
  const manifest = JSON.parse(await read('../vendor/threeui/bestsellers-source-manifest.json'))
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(`../vendor/threeui/${file.path}`, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path)
  }
})

test('the authored styling and interaction program stay intact with lifecycle support', async () => {
  const original = await read('../vendor/threeui/public/landing-pages/bestsellers-book-showcase.html')
  const page = await entry()
  assert.equal(page.match(/<style>([\s\S]*?)<\/style>/)[1], original.match(/<style>([\s\S]*?)<\/style>/)[1])
  // Book descriptions are app content; everything after that data is the authored program.
  const program = html => html.match(/      const body = document.body;([\s\S]*?)<\/script>/)[1]
  assert.equal(program(page), program(original).replace('!document.hidden &&', '!document.hidden && window.__icarusRendering &&')
    .replace('document.addEventListener("visibilitychange", syncCoverMotion);', 'document.addEventListener("visibilitychange", syncCoverMotion);\n      window.addEventListener("icarus-render-state", syncCoverMotion);'))
  for (const [book, action, label] of [['codex', 'settings', 'Settings'], ['claude', 'code', 'Let’s code'], ['cursor', 'models', 'Model connection']]) {
    assert.ok(page.includes(`data-book="${book}"\n        data-icarus-entry="${action}"\n        aria-label="${label}"`), label)
  }
  assert.ok(page.includes('class="hero-word" aria-hidden="true">ICARUS'))
})

test('only the active book frame can request the three entry destinations', async () => {
  const { readEntryAction } = await import('../src/entry-actions.ts')
  const frame = {}
  for (const action of ['code', 'models', 'settings']) {
    assert.equal(readEntryAction({ type: 'icarus-entry-action', action }, frame, frame), action)
    assert.equal(readEntryAction({ type: 'icarus-entry-action', action }, {}, frame), null)
  }
  for (const data of [null, [], 'code', {}, { type: 'wrong', action: 'code' }, { type: 'icarus-entry-action', action: 'saveProviderKey' }, { type: 'icarus-entry-action', action: '__proto__' }]) {
    assert.equal(readEntryAction(data, frame, frame), null)
  }
  assert.equal(readEntryAction({ type: 'icarus-entry-action', action: 'code' }, null, null), null)
})

test('the book home link resets the library without navigating its srcDoc frame', async () => {
  const page = await entry()
  assert.ok(page.includes('class="brand" href="#" data-icarus-library'), 'the home link must stay within the book library')
  const bridge = page.match(/<script id="icarus-entry-actions">([\s\S]*?)<\/script>/)[1]
  let click, prevented = false, closed = 0, menuClosed = 0
  const body = { dataset: { mode: 'detail', menu: 'open' } }
  runInNewContext(bridge, {
    document: { body, addEventListener: (type, callback) => { if (type === 'click') click = callback }, querySelector: selector => ({ click: () => { if (selector === '#closeButton') closed++; else menuClosed++ } }) },
    parent: { postMessage() {} },
    window: { addEventListener() {} },
  })
  click({ target: { closest: () => ({ dataset: { icarusLibrary: '' } }) }, preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(closed, 1)
  assert.equal(menuClosed, 1)
})

test('book activation waits for authored opening motion, supports cancellation, and accepts resets only from its parent', async () => {
  const page = await entry()
  const bridge = page.match(/<script id="icarus-entry-actions">([\s\S]*?)<\/script>/)?.[1]
  assert.ok(bridge)
  const listeners = {}, messages = [], timers = []
  let closed = 0, reduced = false
  const parent = { postMessage: value => messages.push(JSON.parse(JSON.stringify(value))) }
  const body = { dataset: { mode: 'detail', menu: 'closed' } }
  runInNewContext(bridge, {
    document: { body, addEventListener: (type, callback) => { listeners[type] = callback }, querySelector: selector => selector === '#closeButton' ? { click: () => { closed++; body.dataset.mode = 'gallery' } } : { click() {} } },
    parent,
    window: { parent, matchMedia: () => ({ get matches() { return reduced } }), setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length }, addEventListener: (type, callback) => { listeners[type] = callback } },
  })
  assert.deepEqual(messages.shift(), { type: 'icarus-entry-ready' })
  const card = { dataset: { icarusEntry: 'code' }, classList: { contains: () => true }, matches: selector => selector === '.book-card' }
  const click = control => listeners.click({ target: { closest: () => control }, preventDefault() {}, stopPropagation() {} })
  click(card)
  assert.equal(messages.length, 0)
  assert.equal(timers[0].delay, 1200)
  timers.shift().callback()
  assert.deepEqual(messages, [{ type: 'icarus-entry-action', action: 'code' }])
  click(card)
  body.dataset.mode = 'gallery'
  timers.shift().callback()
  assert.equal(messages.length, 1, 'closing the book cancels navigation')
  body.dataset.mode = 'detail'
  reduced = true
  click(card)
  assert.equal(timers[0].delay, 0)
  timers.shift().callback()
  listeners.message({ source: {}, data: { type: 'icarus-entry-reset' } })
  assert.equal(closed, 0)
  listeners.message({ source: parent, data: { type: 'wrong' } })
  assert.equal(closed, 0)
  listeners.message({ source: parent, data: { type: 'icarus-entry-reset' } })
  assert.equal(closed, 1)
  click({ dataset: { icarusEntry: 'settings' }, matches: () => false })
  assert.equal(messages.at(-1).action, 'settings')
  click(null)
  assert.ok(!bridge.includes('window.icarus'))
})

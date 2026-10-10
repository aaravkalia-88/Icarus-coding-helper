import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import * as home from '../src/home-data.ts'
import { optimizeKage } from '../scripts/scene-performance.mjs'

const read = file => readFile(new URL(file, import.meta.url), 'utf8')
const modeIds = ['hint', 'explain_mistake', 'logic_coach', 'fix_code', 'full_solve', 'ask_icarus', 'explain_code', 'refactor']

test('every native mode has its own ICARUS mode tile', async () => {
  assert.deepEqual(home.features.filter(feature => !['memory', 'model'].includes(feature.id)).map(feature => feature.id), modeIds)
  const page = await read('../public/landing-pages/icarus-kage.html')
  const atlas = page.slice(page.indexOf('<div class="cur"'), page.indexOf('<!-- ============================================================ chapter IV'))
  assert.equal((atlas.match(/data-icarus-mode=/g) || []).length, 8)
  for (const id of modeIds) assert.ok(atlas.includes(`data-icarus-mode="${id}"`), id)
})

test('the authored scroll/Three.js program survives with ICARUS branding and sandbox-safe image loading', async () => {
  const original = await read('../vendor/threeui/public/landing-pages/kage.html')
  const page = await read('../public/landing-pages/icarus-kage.html')
  const program = html => html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1]
  const expected = program(original).replace("const word = 'KAGE'", "const word = 'ICARUS'")
    .replace('const img = new Image();\n    img.onload', "const img = new Image();\n    img.crossOrigin = 'anonymous';\n    img.onload")
    .replace("const names = ['The Hidden Gate', 'The Sanmon', 'Still Gardens', 'Sacred Craft', 'Afterlight', 'Colophon'];", "const names = ['Welcome', 'Get started', 'Featured modes', 'All modes', 'Keep coding', 'Your workspace'];")
  assert.equal(program(page), program(optimizeKage(`<script>\n${expected}</script>`)), 'the authored scene changes only app branding, sandbox compatibility, and rendering scheduling')
  assert.ok(page.includes('<span class="brand-tx"><b>ICARUS</b>'))
  assert.ok(page.includes('class="word-fb" aria-hidden="true">ICARUS'))
  assert.ok(!page.includes('buildIcarusWorld'))
  assert.ok(!page.includes('body>:not(#gl)'))
})

test('registered Kage files and binary assets remain byte exact', async () => {
  const manifest = JSON.parse(await read('../vendor/threeui/kage-source-manifest.json'))
  for (const file of [...manifest.files, ...manifest.assets]) {
    const bytes = await readFile(new URL(`../vendor/threeui/${file.path}`, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path)
  }
})

test('the sandbox can request only named modes, memory, settings, and archive', () => {
  assert.equal(typeof home.readHomeAction, 'function')
  for (const mode of modeIds) assert.deepEqual(home.readHomeAction({ type: 'icarus-home-action', action: 'mode', mode }), { action: 'mode', mode })
  for (const action of ['memory', 'settings', 'archive']) assert.deepEqual(home.readHomeAction({ type: 'icarus-home-action', action }), { action })
  for (const data of [null, [], 'mode', {}, { type: 'other', action: 'settings' },
    { type: 'icarus-home-action', action: 'mode', mode: 'memory' },
    { type: 'icarus-home-action', action: 'mode', mode: '__proto__' },
    { type: 'icarus-home-action', action: 'saveProviderKey', key: 'no-access' }]) assert.equal(home.readHomeAction(data), null)
})

test('native button clicks send a mode request without accessing the desktop bridge', async () => {
  const page = await read('../public/landing-pages/icarus-kage.html')
  const bridge = page.match(/<script id="icarus-home-actions">([\s\S]*?)<\/script>/)?.[1]
  assert.ok(bridge, 'authored page has a sandbox action bridge')
  let click
  const messages = []
  runInNewContext(bridge, {
    document: { addEventListener: (name, listener) => { if (name === 'click') click = listener } },
    parent: { postMessage: message => messages.push(JSON.parse(JSON.stringify(message))) },
  })
  const event = control => ({ target: { closest: () => control }, preventDefault() {}, stopPropagation() {} })
  click(event({ dataset: { icarusMode: 'hint' } }))
  click(event({ dataset: { icarusAction: 'settings' } }))
  click(event(null))
  assert.deepEqual(messages, [{ type: 'icarus-home-action', action: 'mode', mode: 'hint' }, { type: 'icarus-home-action', action: 'settings' }])
  assert.ok(!bridge.includes('window.icarus'))
})

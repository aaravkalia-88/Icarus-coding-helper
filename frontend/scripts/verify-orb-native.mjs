import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { _electron } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE
  || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const project = path.dirname(root)
const output = path.join(project, 'docs/verification')
const profile = await mkdtemp(path.join(tmpdir(), 'icarus-orb-native-'))
const selection = path.join(profile, 'selection.cjs')
const python = path.join(profile, 'python-fixture')
const boot = path.join(profile, 'boot.cjs')
const requests = path.join(profile, 'requests.jsonl')
const checks = []
const errors = []
let app
await mkdir(output, { recursive: true })
await writeFile(selection, `#!/usr/bin/env node
if (process.argv[2] === 'target') process.stdout.write(JSON.stringify({pid: 123, name: 'Fixture IDE'}))
else setTimeout(() => process.stdout.write(JSON.stringify({status: 'selected', selectedText: 'const selected = 42', bounds: {x: 400, y: 300, width: 100, height: 20}})), 150)
`)
await chmod(selection, 0o700)
await writeFile(python, `#!/usr/bin/env python3
import sys, os, asyncio, json
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(project)})
from backend import main as service
from backend.storage import LocalStore
cache = LocalStore(Path(os.environ['ICARUS_DATA_DIR']) / 'icarus.sqlite')
cache.put('connection', {'provider': 'ollama', 'model': 'fixture-model'})
cache.close()
class FixtureProvider:
    def __init__(self, name): self.name = name
    async def test(self, model, api_key):
        if api_key == 'rejected-fixture': raise ValueError('rejected')
    async def stream(self, messages, model, api_key):
        with open(${JSON.stringify(requests)}, 'a') as record:
            record.write(json.dumps({'provider': self.name, 'model': model, 'messages': messages, 'has_key': bool(api_key), 'matches_fixture': api_key == ('fixture-openai-key' if self.name == 'openai' else 'fixture-token')}) + '\\n')
        yield 'Native fixture answer.'
        await asyncio.sleep(0.1 if len(Path(${JSON.stringify(requests)}).read_text().splitlines()) == 1 else 8)
service.get_provider = lambda name: FixtureProvider(name)
sys.argv = [sys.argv[0], *sys.argv[2:]]
service.run()
`)
await chmod(python, 0o700)
await writeFile(boot, `const electron = require('electron')
const childProcess = require('node:child_process')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const realSpawn = childProcess.spawn
const keys = new Map()
globalThis.icarusFixtureVaultCalls = []
childProcess.spawn = (executable, args, options) => {
  if (!executable.endsWith('icarus-keychain')) return realSpawn(executable, args, options)
  const [operation, provider] = args
  globalThis.icarusFixtureVaultCalls.push({operation, provider})
  const child = new EventEmitter()
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => {}
  let input = ''
  child.stdin.on('data', chunk => input += chunk)
  child.stdin.on('end', () => setImmediate(() => {
    let code = 0
    if (operation === 'set') {
      if (globalThis.icarusFixtureNextSaveFails) { globalThis.icarusFixtureNextSaveFails = false; code = 1 }
      else { keys.set(provider, input); child.stdout.write('ok') }
    }
    else if (operation === 'get') {
      if (keys.has(provider)) child.stdout.write(keys.get(provider)); else code = 1
    } else if (operation === 'status') child.stdout.write(keys.has(provider) ? 'present' : 'missing')
    else { keys.delete(provider); child.stdout.write('ok') }
    child.stdout.end(); child.emit('close', code)
  }))
  return child
}
electron.globalShortcut.register = (accelerator, callback) => {
  globalThis.icarusFixtureShortcut = callback
  globalThis.icarusFixtureAccelerator = accelerator
  return true
}
require(${JSON.stringify(path.join(root, 'dist-electron/main.cjs'))})
`)

try {
  app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [boot], env: { ...process.env, ICARUS_DEV_URL: '', ICARUS_DATA_DIR: profile,
      ICARUS_PYTHON: python, ICARUS_SELECTION_EXECUTABLE: selection },
  })
  let main, popup
  for (let attempt = 0; attempt < 100; attempt++) {
    main = app.windows().find(page => page.url().endsWith('/index.html'))
    popup = app.windows().find(page => page.url().endsWith('/popup.html'))
    if (main && popup) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(main && popup)
  for (const page of [main, popup]) page.on('pageerror', error => errors.push(error.message))
  await main.waitForFunction(() => window.icarus)
  assert.equal((await main.evaluate(() => window.icarus.health())).status, 'ok')
  assert.equal(await app.evaluate(() => globalThis.icarusFixtureAccelerator), 'CommandOrControl+Shift+Q')
  assert.deepEqual(await main.evaluate(() => window.icarus.saveConnection(
    { provider: 'huggingface', model: 'fixture-model' }, 'fixture-token')), { status: 'saved' },
    'a new supplied token connects even if an old Keychain entry cannot be read')
  const rejected = await main.evaluate(() => window.icarus.saveConnection(
    { provider: 'openai', model: 'other-model' }, 'rejected-fixture'))
  assert.equal(rejected.status, 'error')
  assert.equal((await main.evaluate(() => window.icarus.connectionStatus())).connection.provider, 'huggingface')
  await app.evaluate(() => { globalThis.icarusFixtureNextSaveFails = true })
  const failedSave = await main.evaluate(() => window.icarus.saveConnection(
    { provider: 'openai', model: 'other-model' }, 'fixture-openai-key'))
  assert.equal(failedSave.status, 'error')
  assert.equal((await main.evaluate(() => window.icarus.connectionStatus())).connection.provider, 'huggingface')
  checks.push('new API token connects without reading an inaccessible old token', 'failed provider test preserves the saved connection',
    'failed Keychain write restores the previous provider settings')

  const started = Date.now()
  await app.evaluate(() => globalThis.icarusFixtureShortcut())
  await popup.locator('.popup-thinking').waitFor()
  await popup.waitForFunction(() => !document.hidden)
  assert.equal(await popup.locator('.popup-panel').count(), 0)
  const state = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/popup.html'))
    return { bounds: window.getBounds(), focused: window.isFocused() }
  })
  assert.equal(state.bounds.width, 112)
  assert.equal(state.bounds.height, 112)
  assert.equal(state.focused, false, 'orb preserves the source app focus during capture')
  await popup.waitForFunction(() => innerWidth === 112)
  const orb = await popup.locator('.popup-orb-button canvas').boundingBox()
  assert.ok(orb && orb.x >= 0 && orb.x + orb.width <= 112 && orb.y >= 0 && orb.y + orb.height <= 112,
    'the complete orb fits within the compact native viewport')
  await popup.screenshot({ path: path.join(output, 'orb-native-thinking.png') })
  await popup.locator('.popup-answer').waitFor({ timeout: 10000 })
  assert.ok(Date.now() - started >= 4990)
  assert.equal(await popup.locator('.popup-answer').innerText(), 'Native fixture answer.')
  const expanded = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('/popup.html')).getBounds())
  assert.equal(expanded.width, 370)
  assert.equal(expanded.height, 510)
  const calls = (await readFile(requests, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].messages[1].content.includes('const selected = 42'))
  assert.equal(calls[0].model, 'fixture-model')
  assert.equal(calls[0].provider, 'huggingface')
  assert.equal(calls[0].has_key, true)
  assert.equal(calls[0].matches_fixture, true)
  checks.push('shortcut handler captures highlighted text automatically', 'orb is a compact transparent 112px native window',
    'source app keeps focus during capture', 'real authenticated FastAPI sidecar receives selected text and saved model',
    'five-second minimum before native response expansion')
  await popup.screenshot({ path: path.join(output, 'orb-native-response.png') })

  await popup.getByRole('button', { name: 'Open app', exact: true }).click()
  assert.deepEqual(await main.evaluate(() => window.icarus.saveConnection(
    { provider: 'openai', model: 'fixture-model' }, 'fixture-openai-key')), { status: 'saved' })
  await main.evaluate(() => window.icarus.openPopup('fix_code'))
  await popup.getByLabel('Fix Code', { exact: true }).fill('const broken = 1')
  await popup.getByRole('button', { name: 'Run Fix Code', exact: true }).click()
  await popup.getByRole('button', { name: 'Stop generation', exact: true }).waitFor()
  await popup.getByRole('button', { name: 'Stop generation', exact: true }).click()
  await popup.getByRole('status').filter({ hasText: /^Stopped$/ }).waitFor()
  const vaultCalls = await app.evaluate(() => globalThis.icarusFixtureVaultCalls)
  assert.equal(vaultCalls.filter(call => call.operation === 'get').length, 0,
    'connected requests use the provider-specific native cache without prompting Keychain')
  const routed = (await readFile(requests, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(routed[1].provider, 'openai')
  assert.equal(routed[1].matches_fixture, true)
  await popup.getByRole('button', { name: 'Open app', exact: true }).click()
  checks.push('direct mode button opens input and starts generation', 'orb stop button returns a usable result panel',
    'provider switching uses the matching cached API token with no Keychain reads')
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'orb-native-results.json'), JSON.stringify({ result: 'PASS', checks, errors,
    scope: 'Real Electron windows, native IPC, real FastAPI sidecar; fixture model and selection. Shortcut callback invoked directly; no OS keystroke or live provider call.' }, null, 2) + '\n')
  console.info(JSON.stringify({ result: 'PASS', checks }, null, 2))
} catch (error) {
  await writeFile(path.join(output, 'orb-native-results.json'), JSON.stringify({ result: 'FAIL', checks, errors,
    failure: error.message }, null, 2) + '\n')
  throw error
} finally {
  if (app) await app.close()
  await rm(profile, { recursive: true, force: true })
}

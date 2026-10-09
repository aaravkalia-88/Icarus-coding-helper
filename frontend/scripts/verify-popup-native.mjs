import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { _electron } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE
  || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const project = path.dirname(root)
const output = path.join(project, 'docs/verification')
const profile = await mkdtemp(path.join(tmpdir(), 'icarus-popup-native-'))
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
        return {'model': model, 'reply': 'OK'}
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
  const originalMain = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('/index.html')).getBounds())
  const nativeState = () => app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/popup.html'))
    return { bounds: window.getBounds(), fullScreen: window.isFullScreen(), fullscreenable: window.isFullScreenable(), maximizable: window.isMaximizable() }
  })
  assert.equal((await nativeState()).fullscreenable, false)
  assert.equal((await nativeState()).maximizable, false)
  assert.equal(await app.evaluate(() => globalThis.icarusFixtureAccelerator), 'CommandOrControl+Shift+Q')
  await app.evaluate(() => globalThis.icarusFixtureShortcut())
  await popup.getByLabel('What are you building?', { exact: false }).waitFor({ timeout: 5000 })
  assert.equal(await popup.getByLabel('Code from Fixture IDE', { exact: true }).inputValue(), 'const selected = 42')
  assert.equal((await popup.evaluate(() => window.icarus.getInvocation())).mode, undefined)
  assert.equal(await readFile(requests, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error }), '')
  const before = await nativeState()
  assert.deepEqual({ width: before.bounds.width, height: before.bounds.height }, { width: 560, height: 620 })
  assert.equal(before.fullScreen, false)
  await popup.getByLabel('What are you building?', { exact: false }).fill('A local exercise')
  await popup.getByRole('button', { name: 'Choose a mode', exact: true }).click()
  await popup.screenshot({ path: path.join(output, 'glass-popup-native-modes.png') })
  await popup.getByRole('menuitem', { name: 'Hint Mode', exact: true }).click()
  await popup.locator('.popup-answer').waitFor({ timeout: 5000 })
  assert.equal(await popup.locator('.popup-answer').innerText(), 'Native fixture answer.')
  assert.deepEqual((await nativeState()).bounds, before.bounds, 'response does not grow or shrink the popup')
  const first = JSON.parse((await readFile(requests, 'utf8')).trim().split('\n')[0])
  assert.ok(first.messages.some(message => message.content.includes('const selected = 42')))
  assert.ok(first.messages.some(message => message.content.includes('A local exercise')))
  assert.equal(await popup.locator('canvas').count(), 0)
  await popup.screenshot({ path: path.join(output, 'glass-popup-native-response.png') })
  checks.push('native popup refuses fullscreen/maximize', 'shortcut captures selected code before focus transfer',
    'nothing is sent until project context and mode are chosen', 'real IPC forwards code/context to Python',
    'answer retains the compact window bounds and glass background')

  assert.equal((await main.evaluate(() => window.icarus.openPopup('full_solve'))).status, 'ok')
  await popup.getByLabel('Full Solve', { exact: true }).fill('Explain a sorting exercise')
  await popup.getByLabel('What are you building?', { exact: false }).fill('An algorithms lesson')
  await popup.getByRole('button', { name: 'Run Full Solve', exact: true }).click()
  await popup.locator('.popup-answer').waitFor({ timeout: 5000 })
  await popup.getByRole('button', { name: 'Stop', exact: true }).click()
  await popup.getByRole('status').filter({ hasText: /^Stopped$/ }).waitFor()
  assert.equal(await popup.locator('.popup-answer').innerText(), 'Native fixture answer.')
  assert.equal((await nativeState()).fullScreen, false)
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(window => window.webContents.getURL().endsWith('/index.html')).getBounds()), originalMain)
  await popup.getByRole('button', { name: 'Open app', exact: true }).click()
  checks.push('landing-mode IPC opens editable inputs in the same popup', 'stop preserves a partial answer',
    'main window bounds/content route remain unchanged and Open app still works')
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'glass-popup-native-results.json'), JSON.stringify({ result: 'PASS', checks, errors,
    scope: 'Real Electron/preload/IPC/Python; fixture selection/model, temporary data and dummy Keychain. No OS keystroke or live provider call.' }, null, 2))
  console.info(JSON.stringify({ result: 'PASS', checks }, null, 2))
} catch (error) {
  await writeFile(path.join(output, 'glass-popup-native-results.json'), JSON.stringify({ result: 'FAIL', checks, errors, failure: error.message }, null, 2))
  throw error
} finally {
  await app?.close()
  await rm(profile, { recursive: true, force: true })
}

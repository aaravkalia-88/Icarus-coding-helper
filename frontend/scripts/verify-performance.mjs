import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
const { _electron } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const output = path.resolve(root, '../docs/verification')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(`${tmpdir()}/icarus-perf-`)
const app = await _electron.launch({ executablePath: `${root}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: [root], env: { ...process.env, ICARUS_DEV_URL: '', ICARUS_DATA_DIR: profile }, timeout: 30000 })
const result = { label: 'optimized', samples: {}, errors: [] }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function sample(name, frame) {
  await app.evaluate(({ app }) => app.getAppMetrics())
  const start = await frame.evaluate(() => ({ ...window.perfCounts }))
  await wait(3000)
  const end = await frame.evaluate(() => ({ ...window.perfCounts, hidden: document.hidden, videos: [...document.querySelectorAll('video')].filter(v => !v.paused).length, animations: document.getAnimations().filter(a => a.playState === 'running').length }))
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(m => ({ type: m.type, cpu: m.cpu.percentCPUUsage, memoryKB: m.memory.workingSetSize })))
  result.samples[name] = { rafCallbacks: end.raf - start.raf, webglDraws: end.draw - start.draw, ...end, metrics }
  console.log(name, JSON.stringify(result.samples[name]))
  if (/minimized|dialog/.test(name)) {
    assert.equal(end.raf - start.raf, 0, `${name}: no animation callbacks`)
    assert.equal(end.draw - start.draw, 0, `${name}: no WebGL draws`)
    assert.equal(end.videos, 0, `${name}: no video decoding`)
    assert.equal(end.animations, 0, `${name}: CSS animations paused`)
  }
}
async function instrument(frame) {
  await frame.evaluate(() => {
    window.perfCounts = { raf: 0, draw: 0 }
    const raf = requestAnimationFrame
    window.requestAnimationFrame = callback => raf.call(window, t => { window.perfCounts.raf++; callback(t) })
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        if (!proto[name]) continue
        const draw = proto[name]
        proto[name] = function(...args) { window.perfCounts.draw++; return draw.apply(this, args) }
      }
    }
  })
}
try {
  let main
  for (let i = 0; i < 100 && !main; i++) { main = app.windows().find(p => p.url().endsWith('/index.html')); await wait(100) }
  main.on('pageerror', e => { result.errors.push(e.message); console.log('PAGE ERROR', e.message) })
  main.on('crash', () => result.errors.push('Main renderer crashed'))
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'))
    window.setIgnoreMouseEvents(true)
    window.setFocusable(false)
  })
  await main.bringToFront()
  await main.locator('.icarus-landing--ready').waitFor({ timeout: 45000 })
  let frame = await (await main.locator('iframe').elementHandle()).contentFrame()
  await wait(4000)
  frame = await (await main.locator('iframe').elementHandle()).contentFrame()
  assert.equal(await frame.getByRole('region', { name: 'ICARUS books' }).count(), 1, 'library remains the measured scene')
  await instrument(frame)
  await sample('library-visible', frame)
  await main.screenshot({ path: path.join(output, `performance-${result.label}-library.png`) })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).minimize())
  await wait(1000)
  await sample('library-minimized', frame)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')); w.restore(); w.show(); w.focus() })
  await frame.getByRole('region', { name: 'ICARUS books' }).getByRole('button', { name: 'Let’s code', exact: true }).click()
  frame = await (await main.locator('.home-kage-page iframe').elementHandle()).contentFrame()
  await frame.waitForFunction(() => window.__kage?.renderer && !document.body.classList.contains('is-locked'), null, { timeout: 45000 })
  await wait(4000)
  await instrument(frame)
  await sample('kage-visible-idle', frame)
  await main.screenshot({ path: path.join(output, `performance-${result.label}-kage.png`) })
  await frame.getByRole('button', { name: 'All modes', exact: true }).click()
  await frame.waitForFunction(() => Math.abs(window.__kage.RIG.smooth - 3) < .02)
  await sample('kage-modes', frame)
  await frame.locator('.foot [data-icarus-action="settings"]').click()
  await main.getByRole('dialog', { name: 'ICARUS connections and settings' }).waitFor()
  await sample('kage-dialog', frame)
  await main.getByRole('button', { name: 'Close settings' }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).minimize())
  await wait(1000)
  await sample('kage-minimized', frame)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')); w.restore(); w.show(); w.focus() })
  await sample('kage-resumed', frame)
  await main.emulateMedia({ reducedMotion: 'reduce' })
  await frame.getByRole('link', { name: 'Back to library', exact: true }).click()
  await main.locator('.icarus-landing--ready').waitFor({ timeout: 45000 })
  frame = await (await main.locator('iframe').elementHandle()).contentFrame()
  await frame.getByRole('region', { name: 'ICARUS books' }).getByRole('button', { name: 'Let’s code', exact: true }).click()
  frame = await (await main.locator('.home-kage-page iframe').elementHandle()).contentFrame()
  await frame.waitForFunction(() => window.__kage?.renderer && !document.body.classList.contains('is-locked'), null, { timeout: 45000 })
  await wait(1000)
  await instrument(frame)
  await sample('kage-reduced-motion', frame)
  assert.equal(result.samples['kage-reduced-motion'].webglDraws, 0)
  await frame.locator('.foot [data-icarus-action="settings"]').click()
  await main.getByRole('dialog', { name: 'ICARUS connections and settings' }).waitFor()
  await main.locator('.workflow-glass').scrollIntoViewIfNeeded()
  const glass = await (await main.locator('.workflow-glass iframe').elementHandle()).contentFrame()
  await glass.locator('#glass[data-ready="true"]').waitFor({ timeout: 45000 })
  await wait(1000)
  await instrument(glass)
  await sample('glass-paused', glass)
  assert.equal(result.samples['glass-paused'].rafCallbacks, 0)
  assert.equal(result.samples['glass-paused'].webglDraws, 0)
  await glass.getByRole('button', { name: 'Play animation' }).click()
  await sample('glass-playing', glass)
  assert.ok(result.samples['glass-playing'].webglDraws > 0)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).minimize())
  await wait(1000)
  await sample('glass-minimized', glass)
  assert.deepEqual(result.errors, [])
} finally {
  await app.close()
  await rm(profile, { recursive: true, force: true })
  await writeFile(path.join(output, `performance-${result.label}.json`), JSON.stringify(result, null, 2))
}

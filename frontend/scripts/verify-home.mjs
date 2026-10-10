import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { features } from '../src/home-data.ts'

// Optional native QA. Opens inputs only; never sends prompts or changes keys/memory.
const { _electron } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE
  || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const output = path.resolve(root, '../docs/verification')
const temporaryProfile = await mkdtemp(path.join(tmpdir(), 'icarus-home-qa-'))
const result = { result: 'RUNNING', checks: [], errors: [], limits: ['No model inference, credential writes, or project-memory writes.'] }
const modes = features.filter(feature => !['memory', 'model'].includes(feature.id))
let app, main, popup, frame
const redact = value => String(value).replace(/\b(?:hf_|sk-)[A-Za-z0-9_-]+/g, '[credential redacted]').slice(0, 1000)
async function check(name, run) {
  await run()
  result.checks.push({ name, result: 'PASS' })
  console.info(`Home QA: ${name}`)
}
async function screenshot(name) {
  await main.screenshot({ path: path.join(output, `kage-native-${name}.png`), mask: [
    main.locator('#provider-key'), main.locator('#memory-project'),
    main.locator('#memory-goal'), main.locator('#memory-notes'),
  ] })
}
async function sceneFrame() {
  const element = await main.locator('.home-kage-page iframe').elementHandle()
  frame = await element.contentFrame()
  assert.ok(frame)
  await frame.waitForFunction(() => window.__kage?.renderer && !document.body.classList.contains('is-locked'), null, { timeout: 45000 })
  assert.equal(await frame.evaluate(() => typeof window.icarus), 'undefined')
  assert.equal(await frame.evaluate(() => location.href), 'about:srcdoc')
}
await mkdir(output, { recursive: true })
try {
  app = await _electron.launch({
    executablePath: process.env.ICARUS_ELECTRON_EXECUTABLE || path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [root], env: { ...process.env, ICARUS_DEV_URL: '', ICARUS_DATA_DIR: temporaryProfile }, timeout: 30000,
  })
  for (let attempt = 0; attempt < 120 && (!main || !popup); attempt += 1) {
    main = app.windows().find(page => page.url().endsWith('/index.html'))
    popup = app.windows().find(page => page.url().endsWith('/popup.html'))
    if (!main || !popup) await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(main, 'Main app window exists')
  await main.frameLocator('.icarus-landing iframe').getByRole('region', { name: 'ICARUS books' }).getByRole('button', { name: 'Let’s code', exact: true }).waitFor({ timeout: 45000 })
  popup = app.windows().find(page => page.url().endsWith('/popup.html'))
  assert.ok(popup, 'Native input window exists')
  for (const page of [main, popup]) page.on('pageerror', error => result.errors.push(redact(error.message)))
  await check('book landing enters the complete Kage page', async () => {
    await main.locator('.icarus-landing--ready').waitFor({ timeout: 45000 })
    await main.frameLocator('.icarus-landing iframe').getByRole('region', { name: 'ICARUS books' }).getByRole('button', { name: 'Let’s code', exact: true }).click()
    await sceneFrame()
    assert.equal(await frame.evaluate(() => window.__kage.WORD.glyphs.length), 6)
    assert.equal(await frame.locator('#cur [data-icarus-mode]').count(), 8)
    await screenshot('hero')
  })
  await check('authored section navigation advances the original camera rig', async () => {
    for (const [index, name] of ['Get started', 'Featured modes', 'All modes', 'Keep coding', 'Your workspace'].entries()) {
      await frame.getByRole('button', { name, exact: true }).click()
      console.info(`Home QA: navigating to ${name}`)
      await frame.waitForFunction(i => Math.abs(window.__kage.RIG.prog - i) < .02, index + 1)
    }
    await frame.getByRole('button', { name: 'All modes', exact: true }).click()
    await frame.waitForFunction(() => Math.abs(window.__kage.RIG.smooth - 3) < .02)
    await screenshot('modes')
  })
  await check('all eight modes open native input without generating', async () => {
    for (const mode of modes) {
      const button = frame.locator('#cur').getByRole('button', { name: mode.label, exact: true })
      if (mode.id === 'hint') await button.press('Enter')
      else if (mode.id === 'refactor') await button.press('Space')
      else await button.click()
      await popup.bringToFront()
      if (mode.id === 'ask_icarus') await popup.getByLabel('Ask ICARUS', { exact: true }).waitFor()
      else await popup.locator('#icarus-code').waitFor()
      assert.equal(await popup.locator('.popup-answer').count(), 0)
      await popup.getByRole('button', { name: 'Open app', exact: true }).click()
      await main.bringToFront()
    }
  })
  await check('memory and connections remain available', async () => {
    await frame.getByRole('link', { name: 'Project memory', exact: true }).click()
    await main.getByRole('dialog', { name: 'Remember the build.' }).waitFor()
    assert.equal(await main.getByLabel('Current project', { exact: true }).count(), 1)
    await main.getByRole('button', { name: 'Close project memory' }).click()
    await frame.locator('.foot [data-icarus-action="settings"]').click()
    await main.getByRole('dialog', { name: 'ICARUS connections and settings' }).waitFor()
    await main.getByRole('button', { name: 'Close settings' }).click()
  })
  await check('narrow layout and authored reduced motion render', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html')).setContentSize(720, 850))
    await frame.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
    await frame.waitForFunction(() => window.__kage.RIG.smooth < .02)
    await screenshot('720')
    await main.emulateMedia({ reducedMotion: 'reduce' })
    await frame.getByRole('link', { name: 'Back to library', exact: true }).click()
    await main.locator('.icarus-landing--ready').waitFor({ timeout: 45000 })
    await main.frameLocator('.icarus-landing iframe').getByRole('region', { name: 'ICARUS books' }).getByRole('button', { name: 'Let’s code', exact: true }).click()
    await sceneFrame()
    assert.ok(await frame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
    await screenshot('reduced-motion')
  })
  assert.equal(result.errors.length, 0)
  result.result = 'PASS'
} catch (error) {
  result.result = 'FAIL'
  result.failure = redact(error.message)
  result.sceneState = await frame?.evaluate(() => ({ progress: window.__kage?.RIG.prog,
    smooth: window.__kage?.RIG.smooth, rendering: window.__icarusRendering, hidden: document.hidden,
    scroll: scrollY, anchors: window.__kage?.anchors(), height: innerHeight,
    scrollHeight: document.documentElement.scrollHeight })).catch(() => null)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  await rm(temporaryProfile, { recursive: true, force: true })
  await writeFile(path.join(output, 'kage-native-results.json'), JSON.stringify(result, null, 2) + '\n')
  console.info(JSON.stringify(result, null, 2))
}

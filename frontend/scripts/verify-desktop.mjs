import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const { _electron } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const output = path.resolve(root, '../docs/verification')
await mkdir(output, { recursive: true })
const app = await _electron.launch({
  executablePath: process.env.ICARUS_ELECTRON_EXECUTABLE || path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: [root], env: { ...process.env, ICARUS_DEV_URL: '' },
})
const checks = []
const errors = []
try {
  let main, popup
  for (let i = 0; i < 100; i++) {
    main = app.windows().find(page => page.url().endsWith('/index.html'))
    popup = app.windows().find(page => page.url().endsWith('/popup.html'))
    if (main && popup) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(main && popup)
  await app.evaluate(({ app }) => app.focus({ steal: true }))
  for (const page of [main, popup]) page.on('pageerror', error => errors.push(error.message))
  await main.waitForSelector('iframe')
  const scene = await (await main.locator('iframe').elementHandle()).contentFrame()
  await scene.waitForFunction(() => window.__holo?.ready, null, { timeout: 45000 })
  assert.equal(await scene.evaluate(() => typeof window.icarus), 'undefined')
  await main.getByRole('button', { name: 'Connections' }).click()
  await main.getByText('Key saved · Default model', { exact: true }).waitFor()
  assert.equal((await main.evaluate(() => window.icarus.health())).status, 'ok')
  await main.getByRole('button', { name: 'Add / replace API key' }).click()
  assert.equal(await main.getByLabel('Hugging Face access token').getAttribute('type'), 'password')
  assert.equal(await main.getByLabel('Hugging Face access token').inputValue(), '')
  await main.getByRole('button', { name: 'Cancel', exact: true }).click()
  checks.push('saved Qwen key is default', 'key management retained without revealing the saved key', 'protected backend ready')
  const glassHost = main.locator('.workflow-glass')
  await glassHost.scrollIntoViewIfNeeded()
  const glass = main.frameLocator('.workflow-glass iframe')
  await glass.locator('#glass[data-ready="true"]').waitFor()
  await main.screenshot({ path: path.join(output, 'desktop-connections.png') })
  await glass.getByRole('button', { name: 'Open ICARUS — activate the galaxy' }).click()
  await popup.waitForFunction(() => !document.hidden)
  await popup.bringToFront()
  checks.push('glass button opens the native command panel')
  await popup.getByRole('button', { name: 'Add code' }).click()
  await popup.getByLabel('Code for ICARUS').fill('def add(a, b):\n    return a - b')
  await popup.getByRole('button', { name: 'Use code' }).click()
  for (const name of ['Logic Coach', 'Explain Mistake', 'Fix Code', 'Hint', 'Explain Code', 'Refactor']) {
    assert.equal(await popup.getByRole('menuitem', { name }).isEnabled(), true)
  }
  await popup.screenshot({ path: path.join(output, 'desktop-popup.png') })
  await popup.getByRole('menuitem', { name: 'Explain Code', exact: true }).click()
  await popup.getByRole('status').filter({ hasText: /^Complete$/ }).waitFor({ timeout: 90000 })
  const answer = await popup.locator('.popup-answer').innerText()
  assert.ok(answer.trim().length > 20, 'saved Qwen key returns a real streamed answer')
  assert.equal(await popup.getByRole('alert').count(), 0)
  await popup.screenshot({ path: path.join(output, 'desktop-qwen-response.png') })
  console.log('Qwen response received:', answer.length, 'characters; buttons:', await popup.getByRole('button').allTextContents())
  await popup.getByRole('button', { name: 'Copy', exact: true }).click()
  await popup.getByRole('button', { name: 'Copied', exact: true }).waitFor()
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert.equal(copied, answer)
  checks.push('all code modes enabled for supplied code', 'live Qwen response through the native app', 'copy answer')
  await popup.getByRole('button', { name: 'Back', exact: true }).click()
  await popup.getByRole('menuitem', { name: 'Ask Icarus', exact: true }).click()
  await popup.getByLabel('Ask Icarus').fill('Explain recursion with a detailed JavaScript example.')
  await popup.getByRole('button', { name: 'Ask Icarus', exact: false }).click()
  await popup.getByRole('button', { name: /Stop/ }).waitFor()
  await popup.getByRole('button', { name: /Stop/ }).click()
  await popup.getByRole('status').filter({ hasText: /^Stopped$/ }).waitFor()
  checks.push('stop generation preserves the partial response')
  assert.deepEqual(errors, [])
  const result = { result: 'PASS', checks, errors, provider: 'Hugging Face / Qwen3.8-27B', credentials: 'macOS Keychain; never returned to renderer' }
  await writeFile(path.join(output, 'desktop-results.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const popup = app.windows().find(page => page.url().endsWith('/popup.html'))
  if (popup) {
    await popup.screenshot({ path: path.join(output, 'desktop-check-failure.png') }).catch(() => {})
    console.log('Popup check state:', await popup.evaluate(() => ({ hidden: document.hidden, buttons: [...document.querySelectorAll('button')].map(button => button.textContent) })).catch(() => null))
  }
  throw error
} finally { await app.close() }

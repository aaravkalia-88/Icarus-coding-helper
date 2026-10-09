import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from 'vite'

const { chromium } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE
  || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const crash = `export default function Fixture() {
  if (sessionStorage.getItem('recovered') !== 'yes') throw new Error('private-fixture-token')
  return <p>Recovered fixture</p>
}`

async function withPage(scenario, run) {
  const server = await createServer({ root, plugins: [{
    name: 'error-handling-fixtures', enforce: 'pre',
    load(id) {
      if (scenario === 'crash' && (id === path.join(root, 'src/Landing.tsx') || id === path.join(root, 'src/Popup.tsx'))) return crash
      if (scenario === 'settings' && id === path.join(root, 'src/Landing.tsx')) return "export { default } from './App'"
    },
  }], server: { host: '127.0.0.1', port: 0 } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true, channel: 'chrome' })
    const page = await browser.newPage({ viewport: { width: 370, height: 510 } })
    await page.addInitScript(() => {
      window.fixture = { sizes: [], permission: false, failures: [] }
      window.icarus = {
        health: async () => ({ status: 'ok' }),
        shortcutStatus: async () => ({ status: 'ready' }),
        connectionStatus: async () => ({ status: 'ok', connection: { provider: 'ollama', model: 'fixture' }, keyStatus: 'not_needed' }),
        historyStatus: async () => { throw new Error('private-fixture-token') },
        clearHistory: async () => ({ status: 'ok' }),
        getInvocation: async () => ({ selectedText: 'fixture code', permissionRequired: window.fixture.permission }),
        onInvocation: callback => { window.fixture.invoke = callback; return () => {} },
        onGeneration: callback => { window.fixture.emit = callback; return () => {} },
        setPopupThinking: async thinking => { window.fixture.sizes.push(thinking); return { status: 'ok' } },
        selectMode: async () => {
          const requestId = 'a'.repeat(24)
          window.fixture.emit({ requestId, type: 'delta', text: 'partial fixture answer' })
          window.fixture.emit({ requestId, type: 'error', message: 'Model reached its response limit. Ask a shorter question or continue from the partial answer.' })
          return { status: 'started', requestId }
        },
        stopGeneration: async () => { throw new Error('private-fixture-token') },
        openAccessibilitySettings: async () => { throw new Error('private-fixture-token') },
        dismissPopup: async () => ({ status: 'ok' }),
      }
      window.addEventListener('unhandledrejection', event => window.fixture.failures.push(String(event.reason)))
    })
    await run(page, server.resolvedUrls.local[0])
  } finally {
    await browser?.close()
    await server.close()
  }
}

for (const entry of ['index.html', 'popup.html']) {
  test(`${entry} catches a rendering crash and reloads safely`, async () => {
    await withPage('crash', async (page, url) => {
      await page.goto(url + entry)
      const alert = page.getByRole('alert')
      await alert.waitFor({ timeout: 3000 })
      assert.match(await alert.innerText(), /ICARUS could not display this screen/)
      assert.doesNotMatch(await alert.innerText(), /private-fixture-token/)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      if (entry === 'popup.html') assert.ok((await page.evaluate(() => window.fixture.sizes)).includes(false))
      await page.evaluate(() => sessionStorage.setItem('recovered', 'yes'))
      await page.getByRole('button', { name: 'Reload ICARUS', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.getByText('Recovered fixture', { exact: true }).waitFor()
    })
  })
}

test('cache read failure is visible and clearing remains usable', async () => {
  await withPage('settings', async (page, url) => {
    await page.goto(url)
    await page.getByRole('alert').filter({ hasText: 'Could not read the response cache.' }).waitFor({ timeout: 3000 })
    await page.getByRole('button', { name: 'Clear recent answers', exact: true }).click()
    await page.getByText('Recent answers cleared. Your project notes and connection are kept.', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.fixture.failures), [])
  })
})

test('partial answer keeps the specific response-limit guidance', async () => {
  await withPage('popup', async (page, url) => {
    await page.goto(url + 'popup.html')
    await page.getByRole('button', { name: 'Choose a mode', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Hint Mode', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Model reached its response limit. Ask a shorter question or continue from the partial answer.' }).waitFor({ timeout: 7000 })
    assert.equal(await page.locator('.popup-answer').innerText(), 'partial fixture answer')
    assert.deepEqual(await page.evaluate(() => window.fixture.failures), [])
  })
})

test('Accessibility settings failure offers manual recovery and background stop rejection is handled', async () => {
  await withPage('popup', async (page, url) => {
    await page.goto(url + 'popup.html')
    await page.getByRole('button', { name: 'Choose a mode', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Hint Mode', exact: true }).waitFor()
    await page.evaluate(() => {
      window.icarus.selectMode = async () => ({ status: 'started', requestId: 'b'.repeat(24) })
    })
    await page.getByRole('menuitem', { name: 'Hint Mode', exact: true }).click()
    await page.evaluate(() => { window.fixture.permission = true; window.fixture.invoke() })
    await page.getByRole('button', { name: 'Open Accessibility settings', exact: true }).click()
    await page.getByText('Could not open Accessibility settings. Open System Settings → Privacy & Security → Accessibility.', { exact: true }).waitFor({ timeout: 3000 })
    assert.deepEqual(await page.evaluate(() => window.fixture.failures), [])
  })
})

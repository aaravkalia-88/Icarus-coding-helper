import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

const { chromium } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const output = path.resolve(root, '../docs/verification')
await mkdir(output, { recursive: true })
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const checks = [], failures = [], errors = []

async function panel(invocation, complete = true, viewport = { width: 560, height: 620 }) {
  const page = await browser.newPage({ viewport })
  page.setDefaultTimeout(1200)
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ invocation, complete }) => {
    let onGeneration, onInvocation
    window.fixture = { requests: [], sizes: [], copied: [], stops: [], dismissals: [], invocation, complete,
      emit: event => onGeneration?.(event), invoke: value => { window.fixture.invocation = value; onInvocation?.() } }
    window.icarus = {
      getInvocation: async () => window.fixture.invocation,
      onInvocation: callback => { onInvocation = callback; return () => {} },
      onGeneration: callback => { onGeneration = callback; return () => {} },
      setPopupThinking: async thinking => { window.fixture.sizes.push(thinking); return { status: 'ok' } },
      selectMode: async (mode, prompt, text, options) => {
        const requestId = String(window.fixture.requests.length + 1).padStart(24, '0')
        window.fixture.requests.push({ mode, prompt, text, options, requestId })
        if (window.fixture.failure) return window.fixture.failure
        // Exercise deltas arriving before IPC resolves.
        onGeneration?.({ requestId, type: 'delta', text: 'Fixture answer for ' + mode })
        if (window.fixture.complete) onGeneration?.({ requestId, type: 'done' })
        return { status: 'started', requestId }
      },
      copyText: async text => { window.fixture.copied.push(text); return { status: 'ok' } },
      stopGeneration: async id => { window.fixture.stops.push(id); return { status: 'ok' } },
      dismissPopup: async home => { window.fixture.dismissals.push(Boolean(home)); return { status: 'ok' } },
      denySelection: async () => ({ selectedText: null }),
      allowSelection: async () => window.fixture.invocation,
    }
  }, { invocation, complete })
  await page.goto(`${server.resolvedUrls.local[0]}popup.html`)
  return page
}
async function check(name, run) {
  try { await run(); checks.push(name); console.info('PASS:', name) }
  catch (error) { failures.push({ name, message: error.message }); console.error('FAIL:', name, error.message) }
}
async function choose(page) {
  await page.getByRole('button', { name: 'Choose a mode', exact: true }).click()
}

try {
  await check('shortcut asks for project context and never submits captured code automatically', async () => {
    const page = await panel({ selectedText: 'const total = 1', autoRun: true, sourceApp: 'Fixture IDE' })
    try {
      await page.getByLabel('What are you building?', { exact: false }).fill('A shopping cart')
      const contrast = await page.getByRole('button', { name: 'Choose a mode', exact: true }).evaluate(element => {
        const style = getComputedStyle(element)
        if (style.backgroundImage !== 'none') return 0
        const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
          const c = channel / 255
          return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
        }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0)
        const a = luminance(style.color), b = luminance(style.backgroundColor)
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      })
      assert.ok(contrast >= 4.5, 'primary action must have readable text contrast')
      assert.equal(await page.getByLabel('Code from Fixture IDE', { exact: true }).inputValue(), 'const total = 1')
      assert.deepEqual(await page.evaluate(() => window.fixture.requests), [])
      await choose(page)
      assert.equal(await page.getByRole('menuitem').count(), 8)
      await page.getByRole('menuitem', { name: 'Full Coach', exact: true }).waitFor()
      await page.getByRole('menuitem', { name: 'Hint Mode', exact: true }).click()
      await page.locator('.popup-answer').waitFor()
      const request = await page.evaluate(() => window.fixture.requests[0])
      assert.equal(request.text, 'const total = 1')
      assert.equal(request.mode, 'hint')
      assert.equal(request.options.building, 'A shopping cart')
      assert.equal(request.options.includeMemory, false)
      assert.equal(await page.locator('canvas').count(), 0)
      await page.getByRole('button', { name: 'Copy', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.fixture.copied), ['Fixture answer for hint'])
      await page.screenshot({ path: path.join(output, 'glass-popup-response.png') })
    } finally { await page.close() }
  })
  await check('all landing modes allow editable code/context and keep streaming in the glass panel', async () => {
    const modes = { hint: 'Hint Mode', explain_mistake: 'Explain My Mistake', logic_coach: 'Full Coach',
      fix_code: 'Fix Code', full_solve: 'Full Solve', ask_icarus: 'Ask ICARUS', explain_code: 'Explain Code', refactor: 'Refactor' }
    for (const [mode, label] of Object.entries(modes)) {
      const page = await panel({ selectedText: 'selected fixture', mode }, false)
      try {
        await page.getByLabel('What are you building?', { exact: false }).fill('A parser')
        if (mode === 'ask_icarus') await page.getByLabel('Ask ICARUS', { exact: true }).fill('Why does it work?')
        else await page.getByLabel(label, { exact: true }).fill('edited fixture')
        await page.getByRole('button', { name: mode === 'ask_icarus' ? /Ask ICARUS/ : `Run ${label}` }).click()
        await page.locator('.popup-answer').waitFor()
        const request = await page.evaluate(() => window.fixture.requests[0])
        assert.equal(request.mode, mode)
        assert.equal(request.text, mode === 'ask_icarus' ? 'selected fixture' : 'edited fixture')
        assert.equal(request.options.building, 'A parser')
        assert.equal(await page.locator('.popup-panel').count(), 1)
        await page.getByRole('button', { name: 'Stop', exact: true }).click()
        await page.getByRole('status').filter({ hasText: /^Stopped$/ }).waitFor()
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        assert.equal(await page.getByRole('menuitem').count(), 8)
      } finally { await page.close() }
    }
  })
  await check('follow-ups and retries preserve context and stale events cannot replace a new invocation', async () => {
    const page = await panel({ selectedText: 'first code' })
    try {
      await page.getByLabel('ICARUS mood', { exact: true }).selectOption('full_tutor')
      await page.getByLabel('What are you building?', { exact: false }).fill('Learning recursion')
      await choose(page)
      await page.getByRole('menuitem', { name: 'Hint Mode', exact: true }).click()
      await page.locator('.popup-answer').waitFor()
      for (let turn = 1; turn <= 4; turn++) {
        await page.getByLabel('Follow-up question', { exact: true }).fill('Another hint')
        await page.getByRole('button', { name: 'Send follow-up', exact: true }).click()
        await page.waitForFunction(count => window.fixture.requests.length === count, turn + 1)
        await page.locator('.popup-answer').waitFor()
        const request = await page.evaluate(() => window.fixture.requests.at(-1))
        assert.equal(request.options.conversation.length, Math.min(turn * 2, 6))
        assert.equal(request.options.mood, 'full_tutor')
        assert.equal(request.options.building, 'Learning recursion')
      }
      const before = await page.evaluate(() => window.fixture.requests.at(-1))
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.waitForFunction(() => window.fixture.requests.length === 6)
      assert.deepEqual(await page.evaluate(() => window.fixture.requests.at(-1).options), before.options)
      await page.evaluate(() => window.fixture.invoke({ selectedText: 'new code', mode: 'fix_code' }))
      await page.getByLabel('Fix Code', { exact: true }).waitFor()
      await page.evaluate(() => window.fixture.emit({ requestId: window.fixture.requests[0].requestId, type: 'delta', text: 'stale answer' }))
      assert.equal(await page.getByLabel('Fix Code', { exact: true }).inputValue(), 'new code')
      assert.equal(await page.locator('.popup-answer').count(), 0)
    } finally { await page.close() }
  })
  await check('capture, permission, empty-selection and provider failures remain recoverable', async () => {
    const capturing = await panel({ selectedText: null, capturing: true })
    try {
      await capturing.getByRole('status').filter({ hasText: 'Reading your selection' }).waitFor()
      assert.equal(await capturing.locator('.popup-panel').count(), 1)
      assert.equal(await capturing.locator('canvas').count(), 0)
      assert.deepEqual(await capturing.evaluate(() => window.fixture.requests), [])
    } finally { await capturing.close() }
    for (const permissionRequired of [false, true]) {
      const page = await panel({ selectedText: null, permissionRequired })
      try {
        if (permissionRequired) await page.getByRole('button', { name: 'Paste instead', exact: true }).click()
        await page.getByLabel('Code for ICARUS', { exact: true }).fill('manual code')
        await choose(page)
        await page.evaluate(() => { window.fixture.failure = { status: 'model_unavailable', message: 'Choose and test a model.' } })
        await page.getByRole('menuitem', { name: 'Fix Code', exact: true }).click()
        await page.getByRole('heading', { name: 'Model unavailable', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Back to commands', exact: true }).click()
        assert.equal(await page.getByRole('menuitem').count(), 8)
      } finally { await page.close() }
    }
  })
  await check('panel stays compact, supports keyboard navigation and respects reduced motion', async () => {
    const page = await panel({ selectedText: 'keyboard code' }, true, { width: 1280, height: 800 })
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await choose(page)
      const bounds = await page.locator('.popup-panel').boundingBox()
      assert.ok(bounds.width <= 560 && bounds.height <= 620)
      await page.getByRole('menuitem', { name: 'Hint Mode', exact: true }).focus()
      await page.keyboard.press('ArrowDown')
      assert.equal(await page.evaluate(() => document.activeElement.textContent.includes('Full Coach')), true)
      const header = await page.locator('.popup-header').boundingBox()
      assert.ok(header.y >= bounds.y && header.x >= bounds.x, 'keyboard focus must not scroll the panel chrome out of view')
      const columns = await page.locator('.popup-menu').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      assert.equal(columns, 2)
      assert.ok((await page.getByRole('menuitem').first().boundingBox()).height >= 64, 'mode tiles fill the grid rows')
      assert.doesNotMatch(await page.locator('.popup-panel').evaluate(element => getComputedStyle(element, '::after').backgroundImage), /icarus-artwork/)
      assert.equal(await page.locator('.popup-ambient').evaluate(element => getComputedStyle(element).animationName), 'none')
      await page.screenshot({ path: path.join(output, 'glass-popup-modes.png') })
      await page.setViewportSize({ width: 320, height: 510 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: path.join(output, 'glass-popup-narrow.png') })
      await page.keyboard.press('Escape')
      assert.deepEqual(await page.evaluate(() => window.fixture.dismissals), [false])
    } finally { await page.close() }
  })
  assert.deepEqual(errors, [])
} finally {
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'glass-popup-results.json'), JSON.stringify({ checks, failures, errors, scope: 'Real React UI with fixture desktop bridge; no user code or keys.' }, null, 2))
  await browser.close()
  await server.close()
}
if (failures.length) process.exitCode = 1

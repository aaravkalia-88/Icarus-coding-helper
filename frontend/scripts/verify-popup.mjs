import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

const { chromium } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE
  || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const output = path.resolve(root, '../docs/verification')
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const checks = []
const failures = []
const errors = []

async function panel(invocation, complete = true) {
  const page = await browser.newPage({ viewport: { width: 370, height: 510 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ invocation, complete }) => {
    let onGeneration, onInvocation
    window.fixture = { requests: [], sizes: [], copied: [], invocation, complete,
      emit: event => onGeneration?.(event), invoke: value => { window.fixture.invocation = value; onInvocation?.() } }
    window.icarus = {
      getInvocation: async () => window.fixture.invocation,
      onInvocation: callback => { onInvocation = callback; return () => {} },
      onGeneration: callback => { onGeneration = callback; return () => {} },
      setPopupThinking: async thinking => { window.fixture.sizes.push(thinking); return { status: 'ok' } },
      selectMode: async (mode, prompt, text, options) => {
        const requestId = String(window.fixture.requests.length + 1).padStart(24, '0')
        window.fixture.requests.push({ mode, prompt, text, options, requestId, start: performance.now() })
        if (window.fixture.failure) return window.fixture.failure
        // Deliberately arrive before selectMode resolves to exercise IPC buffering.
        onGeneration?.({ requestId, type: 'delta', text: 'Fixture answer for ' + mode })
        if (window.fixture.complete) onGeneration?.({ requestId, type: 'done' })
        return { status: 'started', requestId }
      },
      copyText: async text => { window.fixture.copied.push(text); return { status: 'ok' } },
      stopGeneration: async () => ({ status: 'ok' }),
      dismissPopup: async () => ({ status: 'ok' }),
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

try {
  await check('a fresh shortcut uses the current mood and explicitly cleared code stays empty', async () => {
    const page = await panel({ selectedText: 'original selected code' }, false)
    try {
      await page.getByLabel('ICARUS mood', { exact: true }).selectOption('fun')
      await page.evaluate(() => window.fixture.invoke({ selectedText: 'new selection', mode: 'analyze', autoRun: true }))
      await page.waitForFunction(() => window.fixture.requests.length === 1)
      assert.equal(await page.evaluate(() => window.fixture.requests[0].options.mood), 'fun')
      await page.evaluate(() => window.fixture.invoke({ selectedText: 'original selected code' }))
      await page.getByRole('button', { name: 'Edit code', exact: true }).click()
      await page.getByLabel('Code for ICARUS', { exact: true }).fill('')
      await page.getByRole('button', { name: 'Clear code', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Ask ICARUS', exact: true }).click()
      await page.getByLabel('Ask ICARUS', { exact: true }).fill('Explain a stack')
      await page.getByRole('button', { name: /Ask ICARUS/ }).click()
      await page.waitForFunction(() => window.fixture.requests.length === 2)
      assert.equal(await page.evaluate(() => window.fixture.requests[1].text), '')
    } finally { await page.close() }
  })
  await check('mentor moods persist and follow-ups keep hint rules, code and bounded context', async () => {
    const page = await panel({ selectedText: 'def recurse(): pass' })
    try {
      const mood = page.getByLabel('ICARUS mood', { exact: true })
      await mood.selectOption('full_tutor', { timeout: 1500 })
      await page.reload()
      assert.equal(await mood.inputValue(), 'full_tutor')
      for (const value of ['friendly', 'fun', 'gen_z']) await mood.selectOption(value)
      await page.getByRole('button', { name: 'Edit code', exact: true }).click()
      await page.getByLabel('What are you building?', { exact: false }).fill('Learning recursion')
      await page.getByLabel('Use project notes in this request').check()
      await page.getByRole('button', { name: 'Use code', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Hint Mode', exact: true }).click()
      await page.locator('.popup-answer').waitFor({ timeout: 7000 })
      for (let turn = 1; turn <= 4; turn++) {
        await page.getByLabel('Follow-up question', { exact: true }).fill(`Another hint ${turn}?`)
        await page.getByRole('button', { name: 'Send follow-up', exact: true }).click()
        await page.locator('.popup-answer').waitFor({ timeout: 7000 })
        const request = await page.evaluate(() => window.fixture.requests.at(-1))
        assert.equal(request.mode, 'hint')
        assert.equal(request.text, 'def recurse(): pass')
        assert.equal(request.prompt, `Another hint ${turn}?`)
        assert.equal(request.options.mood, 'gen_z')
        assert.equal(request.options.building, 'Learning recursion')
        assert.equal(request.options.includeMemory, true)
        assert.equal(request.options.conversation.length, Math.min(turn * 2, 6))
        assert.deepEqual(request.options.conversation.map(item => item.role),
          Array.from({ length: Math.min(turn * 2, 6) }, (_, index) => index % 2 ? 'assistant' : 'user'))
      }
      const before = await page.evaluate(() => window.fixture.requests.at(-1))
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.locator('.popup-answer').waitFor({ timeout: 7000 })
      assert.deepEqual(await page.evaluate(() => window.fixture.requests.at(-1).options), before.options)
      await page.screenshot({ path: path.join(output, 'mentor-follow-up.png') })
      await page.setViewportSize({ width: 320, height: 510 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: path.join(output, 'mentor-follow-up-narrow.png') })
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Hint Mode', exact: true }).click()
      await page.waitForFunction(() => window.fixture.requests.length === 7)
      assert.deepEqual(await page.evaluate(() => window.fixture.requests.at(-1).options.conversation || []), [])
    } finally { await page.close() }
  })
  await check('shortcut auto analyzes selected text with only an orb until five seconds', async () => {
    const page = await panel({ selectedText: 'const total = 1', mode: 'analyze', autoRun: true })
    try {
      await page.waitForFunction(() => window.fixture.requests.length === 1, null, { timeout: 1500 })
      assert.equal(await page.locator('.popup-panel').count(), 0)
      assert.equal(await page.locator('.popup-thinking').count(), 1)
      await page.waitForTimeout(700)
      assert.equal(await page.locator('.popup-answer').count(), 0)
      await page.locator('.popup-answer').waitFor({ timeout: 7000 })
      assert.ok(await page.evaluate(() => performance.now() - window.fixture.requests[0].start >= 4990))
      assert.equal(await page.evaluate(() => window.fixture.requests[0].text), 'const total = 1')
      assert.equal(await page.getByRole('status').innerText(), 'Complete')
      await page.getByRole('button', { name: 'Copy', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.fixture.copied), ['Fixture answer for analyze'])
      await page.screenshot({ path: path.join(output, 'orb-popup-response.png') })
    } finally { await page.close() }
  })
  await check('mode buttons keep thinking after five seconds until the model completes', async () => {
    const page = await panel({ selectedText: 'print(1)' }, false)
    try {
      await page.getByRole('menuitem', { name: 'Hint Mode', exact: true }).click()
      await page.waitForFunction(() => window.fixture.requests.length === 1)
      assert.equal(await page.locator('.popup-panel').count(), 0)
      await page.screenshot({ path: path.join(output, 'orb-popup-thinking.png') })
      await page.waitForTimeout(5200)
      assert.equal(await page.locator('.popup-thinking').count(), 1)
      assert.equal(await page.locator('.popup-answer').count(), 0)
      await page.evaluate(() => window.fixture.emit({ requestId: window.fixture.requests[0].requestId, type: 'done' }))
      await page.locator('.popup-answer').waitFor({ timeout: 1000 })
    } finally { await page.close() }
  })
  await check('missing selection and Accessibility access show recoverable input', async () => {
    for (const permissionRequired of [false, true]) {
      const page = await panel({ selectedText: null, mode: 'analyze', autoRun: true, permissionRequired })
      try {
        if (permissionRequired) await page.getByRole('button', { name: 'Paste instead', exact: true }).waitFor()
        else await page.getByLabel('Code for ICARUS', { exact: true }).waitFor()
        assert.equal(await page.evaluate(() => window.fixture.requests.length), 0)
      } finally { await page.close() }
    }
  })
  await check('all eight Run and Ask buttons send the selected mode and editable text', async () => {
    const modes = { hint: 'Hint Mode', explain_mistake: 'Explain My Mistake', logic_coach: 'Improve Logic',
      fix_code: 'Fix Code', full_solve: 'Full Solve', ask_icarus: 'Ask ICARUS', explain_code: 'Explain Code', refactor: 'Refactor' }
    for (const [mode, label] of Object.entries(modes)) {
      const page = await panel({ selectedText: 'selected fixture', mode }, false)
      try {
        if (mode === 'ask_icarus') await page.getByLabel('Ask ICARUS', { exact: true }).fill('Why does it work?')
        else await page.getByLabel(label, { exact: true }).fill('edited fixture')
        await page.getByRole('button', { name: mode === 'ask_icarus' ? /Ask ICARUS/ : `Run ${label}` }).click()
        await page.getByRole('button', { name: 'Stop generation', exact: true }).waitFor()
        const request = await page.evaluate(() => window.fixture.requests[0])
        assert.equal(request.mode, mode)
        assert.equal(request.text, mode === 'ask_icarus' ? 'selected fixture' : 'edited fixture')
        if (mode === 'ask_icarus') assert.equal(request.prompt, 'Why does it work?')
        await page.getByRole('button', { name: 'Stop generation', exact: true }).click()
        await page.getByRole('status').filter({ hasText: /^Stopped$/ }).waitFor()
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        assert.equal(await page.getByRole('menuitem').count(), 8)
      } finally { await page.close() }
    }
  })
  await check('new invocation cancels a delayed answer and ignores stale stream events', async () => {
    const page = await panel({ selectedText: 'first fixture', mode: 'analyze', autoRun: true })
    try {
      await page.waitForFunction(() => window.fixture.requests.length === 1)
      await page.evaluate(() => window.fixture.invoke({ selectedText: 'new fixture', mode: 'fix_code' }))
      await page.getByLabel('Fix Code', { exact: true }).waitFor()
      await page.evaluate(() => window.fixture.emit({ requestId: window.fixture.requests[0].requestId, type: 'delta', text: 'stale answer' }))
      await page.waitForTimeout(5200)
      assert.equal(await page.getByLabel('Fix Code', { exact: true }).inputValue(), 'new fixture')
      assert.equal(await page.locator('.popup-answer').count(), 0)
    } finally { await page.close() }
  })
  await check('missing provider gives a usable error panel after the minimum thinking time', async () => {
    const page = await panel({ selectedText: 'fixture input' })
    try {
      await page.evaluate(() => { window.fixture.failure = { status: 'model_unavailable', message: 'Add and test an API token in Model connection.' } })
      await page.getByRole('menuitem', { name: 'Fix Code', exact: true }).click()
      await page.locator('.popup-thinking').waitFor()
      await page.getByRole('heading', { name: 'Model unavailable', exact: true }).waitFor({ timeout: 7000 })
      assert.ok(await page.evaluate(() => performance.now() - window.fixture.requests[0].start >= 4990))
      await page.getByRole('button', { name: 'Back to commands', exact: true }).click()
      assert.equal(await page.getByRole('menuitem').count(), 8)
    } finally { await page.close() }
  })
  assert.deepEqual(errors, [])
} finally {
  await mkdir(output, { recursive: true })
  await writeFile(path.join(output, 'orb-popup-results.json'), JSON.stringify({ result: failures.length ? 'FAIL' : 'PASS', checks, failures, errors, scope: 'Mocked desktop bridge; real React rendering and timing.' }, null, 2) + '\n')
  await browser.close()
  await server.close()
}
if (failures.length) process.exitCode = 1

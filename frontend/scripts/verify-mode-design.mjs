import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

const { chromium } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE
  || 'playwright')
const root = path.resolve(import.meta.dirname, '..')
const output = path.resolve(root, '../docs/verification')
await mkdir(output, { recursive: true })
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const checks = [], failures = [], errors = []
const url = `${server.resolvedUrls.local[0]}landing-pages/icarus-kage.html`

async function workspace(width, height, reduced = false) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => window.__kage && !document.body.classList.contains('is-locked'), null, { timeout: 45000 })
  await page.evaluate(() => { window.modeActions = []; addEventListener('message', event => {
    if (event.data?.type === 'icarus-home-action') window.modeActions.push(event.data)
  }) })
  return page
}
async function check(name, run) {
  try { await run(); checks.push(name); console.info('PASS:', name) }
  catch (error) { failures.push({ name, message: error.message }); console.error('FAIL:', name, error.message) }
}
try {
  await check('mode tiles reveal on scroll and keep native actions available', async () => {
    const page = await workspace(1440, 960)
    try {
      assert.equal(await page.locator('#cur .les').first().evaluate(el => Number(getComputedStyle(el).opacity)), 0,
        'offscreen mode tiles wait for the scroll reveal')
      await page.locator('#cur .les').first().scrollIntoViewIfNeeded()
      await page.waitForFunction(() => document.querySelector('#cur .les').classList.contains('rv-in'))
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#cur .les')).opacity) > .99)
      await page.getByRole('button', { name: 'HINT MODE', exact: true }).last().click()
      await page.waitForFunction(() => window.modeActions.at(-1)?.mode === 'hint')
      assert.equal(await page.evaluate(() => window.modeActions.at(-1)?.mode), 'hint')
      await page.screenshot({ path: path.join(output, 'mode-design-desktop.png') })
      const scene = await page.evaluate(() => ({ initialized: Boolean(window.__kage.renderer), progress: window.__kage.RIG.prog }))
      assert.equal(scene.initialized, true)
      assert.ok(scene.progress > 2)
    } finally { await page.close() }
  })
  await check('mode typography has theme accents and room between cards', async () => {
    const page = await workspace(1440, 960, true)
    try {
      await page.locator('#lessons').scrollIntoViewIfNeeded()
      const layout = await page.evaluate(() => ({
        colors: [...document.querySelectorAll('#cur h3')].map(el => getComputedStyle(el).color),
        gap: parseFloat(getComputedStyle(document.querySelector('#cur')).columnGap),
        padding: parseFloat(getComputedStyle(document.querySelector('#cur .les')).paddingTop),
        featuredGap: parseFloat(getComputedStyle(document.querySelector('#cards')).columnGap),
      }))
      assert.ok(new Set(layout.colors).size >= 3, 'mode titles have distinct accents from the scene palette')
      assert.ok(layout.gap >= 24 && layout.featuredGap >= 24 && layout.padding >= 30,
        'mode cards have larger gutters and interior spacing')
      await page.locator('#pathways').scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, 'mode-design-featured.png') })
    } finally { await page.close() }
  })
  await check('mobile mode labels fit and reduced motion shows every mode immediately', async () => {
    const page = await workspace(390, 844, true)
    try {
      const modes = page.locator('#cur .les')
      assert.equal(await modes.count(), 8)
      for (let i = 0; i < 8; i++) {
        const tile = modes.nth(i)
        await tile.scrollIntoViewIfNeeded()
        assert.ok(await tile.evaluate(el => {
          const style = getComputedStyle(el), heading = el.querySelector('h3')
          return Number(style.opacity) === 1 && style.transform === 'none'
            && el.scrollWidth <= el.clientWidth && heading.scrollWidth <= heading.clientWidth
        }), 'labels fit without hiding or horizontal clipping')
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await modes.first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, 'mode-design-mobile.png') })
      await modes.last().locator('button').focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => window.modeActions.at(-1)?.mode === 'refactor')
      assert.equal(await page.evaluate(() => window.modeActions.at(-1)?.mode), 'refactor')
    } finally { await page.close() }
  })
  assert.deepEqual(errors, [])
} finally {
  await writeFile(path.join(output, 'mode-design-results.json'), JSON.stringify({ result: failures.length ? 'FAIL' : 'PASS', checks, failures, errors }, null, 2) + '\n')
  await browser.close()
  await server.close()
}
if (failures.length) process.exitCode = 1

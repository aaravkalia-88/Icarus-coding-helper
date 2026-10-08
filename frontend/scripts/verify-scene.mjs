import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Optional standalone QA for the book entry. Never enters keys or sends prompts.
// This session verifies UI through Codex computer-use controls; this script is
// available for a future local Playwright run with a user-provided installation.
const { chromium } = await import(process.env.ICARUS_PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({
  headless: process.env.ICARUS_HEADLESS === '1',
  ...(process.env.ICARUS_BROWSER_EXECUTABLE ? { executablePath: process.env.ICARUS_BROWSER_EXECUTABLE } : {}),
})
const output = path.resolve(import.meta.dirname, '../../docs/verification')
await mkdir(output, { recursive: true })
const checks = [], errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', error => errors.push(error.message.slice(0, 500)))
  await page.goto(process.env.ICARUS_PREVIEW_URL || 'http://127.0.0.1:5173/')
  const getBooks = async () => {
    await page.locator('.icarus-landing--ready').waitFor()
    const frame = await (await page.locator('.icarus-landing iframe').elementHandle()).contentFrame()
    assert.ok(frame)
    return frame
  }
  let frame = await getBooks()
  await frame.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState >= 2))
  assert.equal(await frame.locator('.book-card').count(), 3)
  assert.equal(await frame.evaluate(() => typeof window.icarus), 'undefined')
  assert.equal(await frame.evaluate(() => location.href), 'about:srcdoc')
  await page.screenshot({ path: path.join(output, 'books-browser-desktop.png') })
  checks.push('three embedded animated covers in an opaque sandbox')

  await frame.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog', { name: 'ICARUS connections and settings' }).waitFor()
  await page.getByRole('heading', { name: 'Local engine', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close settings', exact: true }).click()
  await frame.waitForFunction(() => document.body.dataset.mode === 'gallery' && !document.querySelector('.selected'))
  checks.push('left book opens settings and closes back to the library')

  await frame.getByRole('button', { name: 'Model connection', exact: true }).press('Enter')
  await page.getByRole('heading', { name: 'Model connection.', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Hugging Face API token').getAttribute('type'), 'password')
  await page.getByRole('button', { name: 'Close models', exact: true }).press('Escape')
  await frame.waitForFunction(() => document.body.dataset.mode === 'gallery' && !document.querySelector('.selected'))
  checks.push('right book opens the model panel with Enter and closes with Escape')

  await frame.getByRole('region', { name: 'ICARUS books' }).getByRole('button', { name: 'Let’s code', exact: true }).press('Space')
  await page.locator('.home-kage-page').waitFor()
  frame = await (await page.locator('.home-kage-page iframe').elementHandle()).contentFrame()
  await frame.waitForFunction(() => !document.body.classList.contains('is-locked'), null, { timeout: 45000 })
  assert.equal(await frame.locator('#cur [data-icarus-mode]').count(), 8)
  await frame.getByRole('link', { name: 'Back to library', exact: true }).click()
  frame = await getBooks()
  checks.push('center book enters the eight-mode Kage page and its archive link returns')

  for (const [width, height] of [[768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await frame.getByRole('button', { name: 'Open menu', exact: true }).click()
    await frame.getByRole('link', { name: 'Model connection', exact: true }).click()
    await page.getByRole('heading', { name: 'Model connection.', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Close models', exact: true }).click()
    await page.screenshot({ path: path.join(output, `books-browser-${width}.png`) })
  }
  checks.push('tablet and phone layouts, including menu navigation')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  frame = await getBooks()
  assert.ok(await frame.evaluate(() => [...document.querySelectorAll('video')].every(video => video.paused)))
  assert.equal(await frame.locator('video').first().evaluate(video => getComputedStyle(video).display), 'none')
  checks.push('reduced motion pauses and hides cover videos')
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'books-standalone-results.json'), JSON.stringify({ result: 'PASS', checks, errors }, null, 2) + '\n')
} finally {
  await browser.close()
}

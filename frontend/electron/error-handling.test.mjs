import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consumeSSE } from './main.ts'

test('renderer loading awaits success and surfaces failed navigation to its caller', async () => {
  const { loadRenderer } = await import('./main.ts')
  const urls = []
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const loading = loadRenderer({ loadURL: url => { urls.push(url); return pending } }, 'popup.html')
  assert.equal(await Promise.race([loading.then(() => 'loaded'), Promise.resolve('pending')]), 'pending')
  finish()
  await loading
  assert.deepEqual(urls, ['icarus://app/popup.html'])
  await assert.rejects(loadRenderer({ loadURL: () => Promise.reject(new Error('fixture navigation failure')) },
    'popup.html', 'http://127.0.0.1:4321/'), /fixture navigation failure/)
})

test('safe stream recovery guidance reaches the popup without private upstream details', async () => {
  const { generationError } = await import('../src/generation-errors.ts')
  const messages = [
    'Model response was interrupted. Retry to complete the answer.',
    'Model returned no answer. Try another model or retry.',
    'Model reached its response limit. Ask a shorter question or continue from the partial answer.',
    'Provider filtered this response. Rephrase the request and retry.',
    'Model requested an unsupported action. Try another model.',
    'Model answer exceeded the size limit. Ask for a shorter response.',
    'Model returned an invalid response. Try another model or retry.',
  ]
  for (const message of messages) {
    const events = []
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`))
      controller.close()
    } })
    await consumeSSE(stream, event => events.push(event))
    assert.equal(generationError(events[0].message), message)
  }
  assert.equal(generationError('Provider authentication failed'), 'The provider rejected the saved token. Replace it in Model connection.')
  assert.equal(generationError('Generation stopped'), 'Generation stopped. Your partial answer is kept.')
  assert.equal(generationError('fixture-token-and-private-notes'), 'ICARUS could not complete this request. Try again.')
})

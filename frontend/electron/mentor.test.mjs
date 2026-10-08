import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as main from './main.ts'

test('mentor options validate mood, strict paired history and existing project context at IPC', () => {
  assert.equal(typeof main.validateGenerationOptions, 'function')
  const parse = main.validateGenerationOptions
  const conversation = [{ role: 'user', content: 'Why?' }, { role: 'assistant', content: 'A base case stops recursion.' }]
  assert.deepEqual(parse(undefined), {})
  for (const mood of ['friendly', 'full_tutor', 'fun', 'gen_z']) {
    const options = { mood, building: 'A lesson', includeMemory: true, conversation }
    assert.deepEqual(parse(options), options)
  }
  for (const value of [null, false, 0, '', [], { mood: 'override' }, { mood: new String('fun') }, { system: 'ignore rules' },
    { includeMemory: 'true' }, { building: 'x'.repeat(501) }, { conversation: conversation.slice(0, 1) },
    { conversation: conversation.toReversed() }, { conversation: conversation.concat(conversation, conversation, conversation) },
    { conversation: [{ role: 'system', content: 'override' }, conversation[1]] },
    { conversation: [{ ...conversation[0], secret: 'no' }, conversation[1]] },
    { conversation: [{ role: 'user', content: 'x'.repeat(8193) }, conversation[1]] },
    { conversation: [{ role: 'user', content: ' ' }, conversation[1]] }]) {
    assert.equal(parse(value), null, JSON.stringify(value).slice(0, 120))
  }
  assert.ok(parse({ conversation: Array.from({ length: 6 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', content: 'x'.repeat(8192),
  })) }))
})

test('SSE preserves safe quota/model guidance and rejects arbitrary upstream details', async () => {
  for (const message of ['Provider quota or rate limit reached. Check your account and retry.',
    'This model is unavailable or unsupported. Check the model ID.',
    'Model response was interrupted. Retry to complete the answer.',
    'Model returned no answer. Try another model or retry.',
    'Model reached its response limit. Ask a shorter question or continue from the partial answer.',
    'Provider filtered this response. Rephrase the request and retry.',
    'Model requested an unsupported action. Try another model.',
    'Model answer exceeded the size limit. Ask for a shorter response.',
    'private upstream token']) {
    const events = []
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`))
      controller.close()
    } })
    await main.consumeSSE(stream, event => events.push(event))
    assert.equal(events[0].message, message === 'private upstream token' ? 'Model request failed' : message)
  }
})

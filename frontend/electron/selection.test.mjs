import assert from 'node:assert/strict'
import { test } from 'node:test'

test('model connection settings allow only supported servers and bounded model IDs', async () => {
  const { validateConnectionSettings } = await import('./main.ts')
  assert.deepEqual(validateConnectionSettings({ provider: 'huggingface', model: 'Qwen/test-model' }),
    { provider: 'huggingface', model: 'Qwen/test-model' })
  for (const value of [null, [], { provider: 'shell', model: 'x' },
    { provider: 'openai', model: '' }, { provider: 'openai', model: 'x', url: 'https://unknown' },
    { provider: 'openai', model: 'x\nsecret' }, { provider: 'openai', model: 'x'.repeat(129) }]) {
    assert.equal(validateConnectionSettings(value), null)
  }
})

test('external selection is never read until the invocation receives explicit consent', async () => {
  const { SelectionSession } = await import('./selection.ts')
  let reads = 0
  const session = new SelectionSession(async target => {
    reads++
    assert.equal(target.pid, 123)
    return { status: 'selected', selectedText: 'const total = 1', bounds: { x: 10, y: 20, width: 100, height: 20 } }
  })
  session.prepare({ pid: 123, name: 'Test IDE' })
  assert.equal(reads, 0)
  assert.equal(session.invocation.permissionRequired, true)
  assert.equal(session.invocation.selectedText, null)
  const result = await session.allow()
  assert.equal(reads, 1)
  assert.equal(result.selectedText, 'const total = 1')
  assert.equal(result.permissionRequired, false)
  session.prepare({ pid: 123, name: 'Test IDE' })
  session.deny()
  assert.equal(session.invocation.selectedText, null)
  assert.equal(session.invocation.permissionRequired, false)
  assert.equal(reads, 1)
})

test('a late capture cannot replace a new invocation and invalid text cannot enter the popup', async () => {
  const { SelectionSession } = await import('./selection.ts')
  let release
  const session = new SelectionSession(() => new Promise(resolve => { release = resolve }))
  session.prepare({ pid: 123, name: 'First IDE' })
  const pending = session.allow()
  session.prepare({ pid: 456, name: 'Second IDE' })
  release({ status: 'selected', selectedText: 'old selection' })
  await pending
  assert.equal(session.invocation.sourceApp, 'Second IDE')
  assert.equal(session.invocation.selectedText, null)
  assert.equal(session.invocation.permissionRequired, true)
  const invalid = new SelectionSession(async () => ({ status: 'selected', selectedText: 'x'.repeat(65537) }))
  invalid.prepare({ pid: 123, name: 'IDE' })
  assert.equal((await invalid.allow()).selectedText, null)
})

test('an authorized shortcut captures selected text automatically and preserves its mode', async () => {
  const { SelectionSession } = await import('./selection.ts')
  let reads = 0
  const session = new SelectionSession(async () => {
    reads++
    return { status: 'selected', selectedText: 'selected answer or code' }
  })
  const result = await session.capture({ pid: 123, name: 'Test IDE' }, 'analyze')
  assert.equal(reads, 1)
  assert.equal(result.selectedText, 'selected answer or code')
  assert.equal(result.permissionRequired, false)
  assert.equal(result.mode, 'analyze')
  assert.equal((await session.capture(null, 'hint')).selectedText, null)
  assert.equal(reads, 1, 'no target means no background content read')
})

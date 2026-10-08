import assert from 'node:assert/strict'
import { test } from 'node:test'

test('Home offers real native modes and local settings without placeholder destinations', async () => {
  const { features } = await import('../src/home-data.ts')
  assert.deepEqual(features.map(feature => feature.id), [
    'hint', 'explain_mistake', 'logic_coach', 'fix_code',
    'full_solve', 'ask_icarus', 'explain_code', 'refactor', 'memory', 'model',
  ])
  assert.equal(new Set(features.map(feature => feature.id)).size, 10)
})

test('local project memory accepts only bounded user-authored text', async () => {
  const { parseMemory } = await import('../src/home-data.ts')
  const memory = { project: 'Icarus', goal: 'Understand recursion', notes: 'Use a base case.' }
  assert.deepEqual(parseMemory(JSON.stringify(memory)), memory)
  for (const raw of [null, 'invalid JSON', '[]', '{"project":42}',
    JSON.stringify({ ...memory, notes: 'x'.repeat(8001) })]) {
    assert.equal(parseMemory(raw), null)
  }
  assert.deepEqual(parseMemory(JSON.stringify({ ...memory, apiKey: 'should-not-be-retained' })), memory)
  const escaped = { ...memory, notes: '"\\\n'.repeat(2600) }
  assert.equal(parseMemory(JSON.stringify(escaped))?.notes === escaped.notes, true, 'escaped notes survive saving and loading')
})

test('pinned story progress clamps overscroll and short viewport travel', async () => {
  const { storyProgress } = await import('../src/home-data.ts')
  assert.equal(storyProgress(-80, 80, 1800, 800), 0)
  assert.equal(storyProgress(580, 80, 1800, 800), .5)
  assert.equal(storyProgress(1080, 80, 1800, 800), 1)
  assert.equal(storyProgress(3000, 80, 1800, 800), 1)
  assert.equal(storyProgress(0, 0, 0, 0), 0)
})

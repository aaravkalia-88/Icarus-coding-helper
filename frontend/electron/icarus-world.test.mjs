import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

test('the feather sculpture opens with the hero, then falls; reduced motion holds one pose', async () => {
  const context = { addEventListener() {} }
  runInNewContext(await readFile(new URL('../scripts/icarus-world.js', import.meta.url), 'utf8'), context)
  assert.equal(typeof context.icarusSculpturePose, 'function', 'scroll sculpture pose exists')
  const pose = context.icarusSculpturePose
  assert.equal(pose(0, 0, false).open, 0, 'the opening begins as a gathered bundle')
  assert.equal(pose(.2, .8, false).open, 1, 'the extended hero opens the iris')
  assert.equal(pose(.2, .8, false).fall, 0, 'the ring holds before the hero ends')
  assert.equal(pose(.55, 1, false).fall, 1, 'later chapters release the feathers')
  assert.deepEqual(pose(0, 0, true), pose(1, 1, true), 'reduced motion stays static while scrolling')
  for (const progress of [-1, 0, .1, .2, .35, .55, 1, 2]) {
    const state = pose(progress, progress, false)
    for (const value of Object.values(state)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1)
  }
})

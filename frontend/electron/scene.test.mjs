import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import * as desktop from './main.ts'

const root = path.resolve(import.meta.dirname, '..')
const hashes = {
  'src/shaders/dark-souls-holo-card/DarkSoulsHoloCard.tsx': '8ec70d08f25b0e10d62afa3fe4cc68415acf67607041307a8e53c34153b997a5',
  'public/landing-pages/dark-souls-holo-card.html': '4373734e87a17720a853e4e6d36df174e0db59d668de2607f5dc9fb5927b109d',
  'public/landing-pages/dark-souls-holo-card-cindermane.html': 'a34740e8810600de8e4c15bb96a4b14e177ab8735a84163521c90095403cb150',
  'src/shaders/threeui.css': 'efe4447139f1358dd8e9be68edf6fa46cbefbd1de423a4d6c439ca61d2c8eccf',
  'src/shaders/glass-ai-button/GlassAiButton.tsx': '1a11cd583e856d3be328a0192be4d77184607c64721f3fb646bd6d61436b2104',
  'src/shaders/glass-ai-button/sources/glass-ai-button.html': 'a484571de316c05ab7fbd2da82da5e028ee1ffe0bd169449fb8a3c7801abd81e',
}

test('all registered card and glass sources retain their exact revisions', async () => {
  for (const [file, hash] of Object.entries(hashes)) {
    const bytes = await readFile(path.join(root, 'vendor/threeui', file))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file)
  }
})

test('desktop scene asset requests stay inside the application directory', () => {
  assert.equal(typeof desktop.rendererAssetPath, 'function')
  const dist = '/tmp/icarus-test-dist'
  assert.equal(desktop.rendererAssetPath('icarus://app/landing-pages/dark-souls-holo-card.html', dist),
    path.join(dist, 'landing-pages/dark-souls-holo-card.html'))
  for (const url of ['https://app/index.html', 'icarus://other/index.html',
    'icarus://app/assets/%2e%2e%2f%2e%2e%2fprivate', 'icarus://app/%00',
    'icarus://user:pass@app/index.html', 'icarus://app:3000/index.html', 'not a url']) {
    assert.equal(desktop.rendererAssetPath(url, dist), null, url)
  }
})

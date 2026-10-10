import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { optimizeGlass, withRenderingLifecycle } from './scene-performance.mjs'

const root = path.resolve(import.meta.dirname, '..')
const vendor = path.join(root, 'vendor/threeui')
for (const name of ['source-manifest.json', 'glass-source-manifest.json']) {
 const manifest = JSON.parse(await readFile(path.join(vendor, name), 'utf8'))
 for (const file of manifest.files) {
  const bytes = await readFile(path.join(vendor, file.path))
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error(`ThreeUI source revision changed: ${file.path}`)
  }
 }
}

// Keep r180's module paths intact and ship only the scene's dependency graph.
const threeRoot = path.join(root, 'node_modules/three')
const copied = new Set()
async function copyModule(file) {
  if (copied.has(file)) return
  copied.add(file)
  const code = await readFile(path.join(threeRoot, file), 'utf8')
  const target = path.join(root, 'public/vendor/three', file)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, code)
  for (const match of code.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
    if (match[1].startsWith('.')) await copyModule(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])))
  }
}
await copyModule('build/three.module.js')
await writeFile(path.join(root, 'public/vendor/three/LICENSE'), await readFile(path.join(threeRoot, 'LICENSE')))
const original = await readFile(path.join(vendor, 'public/landing-pages/dark-souls-holo-card.html'), 'utf8')
for (const match of original.matchAll(/from "three\/addons\/([^"]+)"/g)) {
  await copyModule(`examples/jsm/${match[1]}`)
}

const logo = (await readFile(path.join(root, 'public/icarus-artwork.png'))).toString('base64')
const brand = await readFile(path.join(root, 'scripts/icarus-scene.js'), 'utf8')
const insertion = `<script>window.__ICARUS_LOGO = "data:image/png;base64,${logo}";\n${brand}</script>\n`
let scene = original
  .replaceAll('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js', '/vendor/three/build/three.module.js')
  .replaceAll('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/', '/vendor/three/examples/jsm/')
  .replaceAll('The Ashen One', 'ICARUS')
  .replace('Bonfire Archive &middot; 001 / 001', 'Dare to ascend &middot; 001 / 001')
  .replace('<script type="module">', `${insertion}<script type="module">\nawait window.__ICARUS_ART_READY;`)
  .replace('if (!document.hidden) await sleep(320);', 'if (!document.hidden) await sleep(Math.max(320, 7000 - performance.now()));')
  .replace('window.__holo.ready = true;', 'window.__holo.ready = true;\n  parent.postMessage({ type: "icarus-scene", phase: "ready" }, "*");')
  .replace('window.__holo = { ready: false, error: err.message };', 'window.__holo = { ready: false, error: err.message };\n  parent.postMessage({ type: "icarus-scene", phase: "error" }, "*");')
const pages = path.join(root, 'public/landing-pages')
await mkdir(pages, { recursive: true })
await writeFile(path.join(pages, 'dark-souls-holo-card.html'), scene)
await writeFile(path.join(pages, 'dark-souls-holo-card-cindermane.html'),
  await readFile(path.join(vendor, 'public/landing-pages/dark-souls-holo-card-cindermane.html')))
await writeFile(path.join(pages, 'icarus-glass.html'), withRenderingLifecycle(optimizeGlass(
  await readFile(path.join(vendor, 'src/shaders/glass-ai-button/sources/glass-ai-button.html'), 'utf8'))))
console.info(`Prepared ICARUS from verified ThreeUI source; ${copied.size} local Three.js r180 modules.`)
await import('./prepare-kage.mjs')
await import('./prepare-bestsellers.mjs')

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import path from 'node:path'
import { optimizeKage, withRenderingLifecycle } from './scene-performance.mjs'

const root = path.resolve(import.meta.dirname, '..')
const vendor = path.join(root, 'vendor/threeui')
const manifest = JSON.parse(await readFile(path.join(vendor, 'kage-source-manifest.json'), 'utf8'))
for (const file of [...manifest.files, ...manifest.assets]) {
  const bytes = await readFile(path.join(vendor, file.path))
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Kage revision changed: ${file.path}`)
}
const publicPages = path.join(root, 'public/landing-pages')
await mkdir(publicPages, { recursive: true })
await cp(path.join(vendor, 'public/landing-pages/secret-pathways-assets'), path.join(publicPages, 'secret-pathways-assets'), { recursive: true })
const original = await readFile(path.join(vendor, 'public/landing-pages/kage.html'), 'utf8')
await writeFile(path.join(publicPages, 'kage.html'), original)
// Adapt product copy and mode presentation. The authored Three.js/scroll program stays verbatim
// apart from its wordmark and the image CORS declaration needed by srcDoc.
const { features } = await import('../src/home-data.ts')
const modes = features.filter(feature => feature.id !== 'memory' && feature.id !== 'model')
const modeTones = {
  hint: 'gold', explain_mistake: 'ember', logic_coach: 'jade', fix_code: 'ember',
  full_solve: 'gold', ask_icarus: 'jade', explain_code: 'gold', refactor: 'jade',
}
function replace(source, anchor, replacement) {
  if (!source.includes(anchor)) throw new Error(`Kage derivative anchor missing: ${anchor.slice(0, 70)}`)
  return source.replace(anchor, replacement)
}
function modeButton(feature) {
  return `<button type="button" class="icarus-mode-target" data-icarus-mode="${feature.id}" aria-label="${feature.label}"></button>`
}
let page = original.replaceAll('secret-pathways-assets/', '/landing-pages/secret-pathways-assets/')
page = replace(page, '<title>Kage', '<title>ICARUS')
page = replace(page, '<b>KAGE</b>', '<b>ICARUS</b>')
page = replace(page, 'HIDDEN REALMS OF KYOTO', 'A CLEARER WAY TO THINK')
page = replace(page, 'Kage begins', 'ICARUS begins')
page = replace(page, 'class="word-fb" aria-hidden="true">KAGE', 'class="word-fb" aria-hidden="true">ICARUS')
page = replace(page, "const word = 'KAGE'", "const word = 'ICARUS'")
page = replace(page, 'const img = new Image();\n    img.onload', "const img = new Image();\n    img.crossOrigin = 'anonymous';\n    img.onload")
page = replace(page, '© 2026 Kage — Kage no Michi', '© 2026 ICARUS — Ignite your mind')
page = replace(page, '<div class="page" id="top">', '<div class="page" id="top" role="main">')
page = replace(page, '<span>Gardens</span>', '<span>Modes</span>')
page = replace(page, '<span>Rituals</span>', '<span>All modes</span>')
page = replace(page, '<span>Afterlight</span><span class="alt">残光</span>', '<span>Connections</span><span class="alt">残光</span>')
page = replace(page, 'href="#eternity" data-cursor><span>Connections', 'href="#eternity" data-icarus-action="settings" data-cursor><span>Connections')
page = replace(page, '— Still Gardens</span>', '— Choose your mode</span>')
page = replace(page, '— Sacred Craft</span>', '— All ICARUS modes</span>')
page = replace(page, 'Five chapters. Ninety minutes. One quiet mind.', 'Eight modes. Your pace. Your mind.')
page = replace(page, 'Each chapter is a walk, not a lecture. You arrive at the gate, climb the\n      steps, sit with the lantern, and leave with one thing worth keeping.', 'Choose the kind of help you need. A hint, a clearer explanation, a repair, or the full solution — the next step is yours.')
// The original three illustrated windows and their cloth/hover effects stay intact.
let cardIndex = 0
page = page.replace(/<article class="card"[\s\S]*?<\/article>/g, card => {
  const feature = modes[cardIndex++]
  return card.replace('<article class="card"', `<article class="card" data-icarus-tone="${modeTones[feature.id]}"`)
    .replace(/(<div class="card-lab"><b>)[^<]+/, `$1${feature.label}`)
    .replace(/(<div class="card-meta"><span>)[^<]+/, `$1${feature.title}`)
    .replace(/0[123] \/ 03/, `0${cardIndex} / 08`)
    .replace('<div class="card-fr" data-frame>', `<div class="card-fr" data-frame>${modeButton(feature)}`)
})
if (cardIndex !== 3) throw new Error('Kage illustrated card structure changed')
const atlas = `<div class="cur" id="cur">\n${modes.map((feature, index) => `    <div class="les" data-les="${index}" data-icarus-tone="${modeTones[feature.id]}" data-rv="up" data-cursor>
      <span class="k">0${index + 1}</span>
      <h3>${feature.label}<em class="jp" aria-hidden="true">${feature.symbol}</em></h3>
      <p>${feature.copy}</p>
      <span class="t">Open mode ↗</span><i class="bar"></i>
      ${modeButton(feature)}
    </div>`).join('\n')}
  </div>`
const atlasStart = page.indexOf('<div class="cur" id="cur">')
const atlasEnd = page.indexOf('\n</section>', atlasStart)
if (atlasStart < 0 || atlasEnd < 0) throw new Error('Kage mode atlas structure changed')
page = page.slice(0, atlasStart) + atlas + page.slice(atlasEnd)
page = replace(page, '<li><a href="#top" data-cursor>Journal</a></li>', '<li><a href="#top" data-icarus-action="memory" data-cursor>Project memory</a></li>')
page = replace(page, '<li><a href="#top" data-cursor>Field notes</a></li>', '<li><a href="#top" data-icarus-action="settings" data-cursor>Connections</a></li>')
page = replace(page, '<li><a href="#top" data-cursor>Colophon</a></li>', '<li><a href="#top" data-icarus-action="archive" data-cursor>Return to the archive</a></li>')

// Product copy; keep the authored assets and scene mechanics.
for (const [before, after] of Object.entries({
  "Raising the mountain temple": "Preparing your workspace",
  "Chapter 00 — The Hidden Gate": "ICARUS — Your programming companion",
  "<span>Where stillness</span>": "<span>Think clearly.</span>",
  "<span>reveals the</span>": "<span>Build with</span>",
  "<span>unseen.</span>": "<span>confidence.</span>",
  "Enter Kyoto through its quiet thresholds, where ritual,\n      craft, and memory shape the path.": "Get a hint, understand a mistake, improve your logic,\n      or work through a complete solution.",
  "<span>Temples</span>": "<span>Get started</span>",
  "<span>Scroll to enter</span>": "<span>Scroll to explore</span>",
  "<b>Thresholds</b><p>Discover the hidden gates that open on to deeper paths.</p>": "<b>Get started</b><p>Bring the code or problem you want help with.</p>",
  "<b>Still Gardens</b><p>Witness the courts where silence gently unfolds.</p>": "<b>Choose your mode</b><p>Pick the kind of help you need.</p>",
  "<b>Sacred Craft</b><p>Embrace the hands and heritage that shape devotion.</p>": "<b>Understand the answer</b><p>Read the reasoning and review the result.</p>",
  "<b>Night Rituals</b><p>Explore the rites that awaken when the day is done.</p>": "<b>Keep your context</b><p>Save your goals and notes on this Mac.</p>",
  "Preview: Sanmon, before the bell": "Preview featured modes",
  "Sanmon — before the bell": "Explore coding modes",
  "— The Sanmon</span>": "— Get started</span>",
  "Charred cypress, worn stone, one gate left open.": "The right help for your next line of code.",
  "ICARUS begins where the city stops: a mountain gate of cedar burned black,\n        standing in its own weather. The soot is not decoration. It is how a board is taught to survive a\n        hundred rainy seasons, and the first thing this place asks you to understand.": "Start with the code or problem in front of you. Choose how much help you need,\n        from one useful hint to a complete explanation.",
  "Climb the worn steps and the worship hall lifts out of the mist, its paper\n        screens lit from inside like a lantern the size of a house. Above the eaves a vermilion moon holds\n        its place, patient, half hidden. Nothing here is in a hurry. Neither, for the next ninety minutes,\n        are you.": "Press Command Shift Q from your editor to open ICARUS. Allow access to the selected text,\n        describe what you are building, and choose a mode or analyze the excerpt. Review each answer before using it.",
  "<span>Cross the threshold</span>": "<span>Choose a mode</span>",
  "<b>05</b><span>Chapters</span>": "<b>08</b><span>Coding modes</span>",
  "<b>92</b><span>Minutes</span>": "<b>⌘⇧Q</b><span>Quick access</span>",
  "<b>1611</b><span>Hall raised</span>": "<b>Local</b><span>Saved notes</span>",
  "<b>∞</b><span>Stillness</span>": "<b>You</b><span>Set the pace</span>",
  "Chapter 04 — Afterlight": "Your next step",
  ">Afterlight</h2>": ">Keep your flow.</h2>",
  "The gate does not close behind you. Take the walk whenever the noise\n    gets loud — it is always the same path, and never the same light.": "Return whenever you need a clearer explanation, a useful hint,\n    or a fresh approach to the code in front of you.",
  "<span>Begin the walk</span>": "<span>Back to top</span>",
  "A five-chapter night walk through a Kyoto mountain temple. Three illustrated garden field notes\n        sit inside a live Three.js sanctuary.": "ICARUS helps you understand, improve, and solve code. Choose your mode\n        and keep your project notes on this Mac.",
  "<h4>Chapters</h4>": "<h4>Explore</h4>",
  ">The Sanmon</a>": ">Get started</a>",
  ">Still Gardens</a>": ">Featured modes</a>",
  ">Sacred Craft</a>": ">All modes</a>",
  ">Afterlight</a>": ">Keep coding</a>",
  "<h4>Practice</h4>": "<h4>Ways to get help</h4>",
  "href=\"#lessons\" data-cursor>Borrowed scenery": "href=\"#lessons\" data-icarus-mode=\"hint\" data-cursor>Hint Mode",
  "href=\"#lessons\" data-cursor>Lantern light": "href=\"#lessons\" data-icarus-mode=\"explain_mistake\" data-cursor>Explain My Mistake",
  "href=\"#lessons\" data-cursor>Charred cypress": "href=\"#lessons\" data-icarus-mode=\"logic_coach\" data-cursor>Improve Logic",
  "href=\"#lessons\" data-cursor>Raked gravel": "href=\"#lessons\" data-icarus-mode=\"fix_code\" data-cursor>Fix Code",
  "<h4>Elsewhere</h4>": "<h4>Your workspace</h4>",
  ">Return to the archive</a>": ">Back to library</a>",
  "WebGL · Onest · Kyoto": "Programming companion · Built for macOS",
  "const names = ['The Hidden Gate', 'The Sanmon', 'Still Gardens', 'Sacred Craft', 'Afterlight', 'Colophon'];": "const names = ['Welcome', 'Get started', 'Featured modes', 'All modes', 'Keep coding', 'Your workspace'];",
  "影の道": "ICARUS",
  "伽藍": "START",
  "庭園": "MODES",
  "神事": "TOOLS",
  "残光": "SETUP",
  "山門": "CODE",
  "参道": "HINT",
  "灯籠": "LEARN",
  "月影": "THINK",
  "手業": "TOOLS",
  "静けさは一つの技である": "Think clearly. Keep your flow."
})) {
  if (!page.includes(before)) throw new Error(`ICARUS copy anchor missing: ${before.slice(0, 70)}`);
  page = page.replaceAll(before, after);
}
page = replace(page, '</head>', `<style id="icarus-mode-controls">
.icarus-mode-target{position:absolute;inset:0;z-index:3;width:100%;padding:0;border:0;background:transparent;cursor:pointer}
.icarus-mode-target:focus-visible{outline:2px solid var(--vermilion);outline-offset:4px}
.card:focus-within .card-ar{opacity:1;transform:none}
.card-meta span:first-child{max-width:75%}
[data-icarus-tone="gold"]{--mode-accent:color-mix(in srgb,var(--gold) 76%,var(--bone))}
[data-icarus-tone="ember"]{--mode-accent:color-mix(in srgb,var(--ember) 72%,var(--bone))}
[data-icarus-tone="jade"]{--mode-accent:#9fc6ae}
#cards .card-lab b,#cur h3,#cur .k,#cur .t{color:var(--mode-accent)}
.card-lab b{font-weight:500;text-shadow:0 2px 18px var(--ink)}
.card-meta{margin-top:20px;gap:24px;color:var(--bone-dim);line-height:1.8}
#pathways .cards{gap:clamp(24px,3vw,46px)}
#cards .card[data-rv]:not(.rv-in){transform:translate3d(0,26px,0)}
#lessons .cur-head{gap:clamp(32px,6vw,96px);margin-bottom:clamp(56px,9vh,104px)}
#lessons .cur{gap:clamp(22px,2.6vw,42px);background:transparent;border:0}
#lessons .les{min-height:clamp(280px,26vw,340px);padding:clamp(28px,3vw,44px);gap:22px;
  border:1px solid color-mix(in srgb,var(--mode-accent) 20%,transparent);
  background:linear-gradient(145deg,color-mix(in srgb,var(--mode-accent) 7%,transparent),transparent 65%),rgba(5,7,10,.88)}
#lessons .les:hover{padding-left:clamp(28px,3vw,44px)}
#lessons .les h3{font-size:clamp(22px,2vw,30px);line-height:1.25;text-wrap:balance}
#lessons .les h3 em{color:var(--mode-accent)}
#lessons .les p{color:var(--bone-dim);font-size:14px;line-height:1.8}
#lessons .les .bar{background:var(--mode-accent)}
#lessons .les:focus-within{opacity:1;transform:none}
#lessons .les:focus-within::before{opacity:1}
#lessons .les:focus-within .bar{transform:scaleX(1)}
#lessons .les:focus-within .icarus-mode-target{outline-color:var(--mode-accent);outline-offset:-5px}
#lessons .les[data-rv].rv-in{transition-delay:0ms}
#lessons .les[data-rv] h3,#lessons .les[data-rv] p,#lessons .les[data-rv] .t{
  opacity:0;transform:translate3d(0,14px,0);transition:opacity .6s var(--ease-out),transform .8s var(--ease-out)}
#lessons .les.rv-in h3,#lessons .les.rv-in p,#lessons .les.rv-in .t,
#lessons .les:focus-within h3,#lessons .les:focus-within p,#lessons .les:focus-within .t{opacity:1;transform:none}
#lessons .les.rv-in p{transition-delay:85ms}
#lessons .les.rv-in .t{transition-delay:170ms}
@media(min-width:821px) and (max-width:1080px){
  #cur .les:last-child{grid-column:span 3}
}
@media(max-width:820px){
  #lessons .cur-head{gap:26px;margin-bottom:48px}
  #lessons .les,#lessons .les:hover{min-height:260px;padding:28px;gap:20px}
}
@media(prefers-reduced-motion:reduce){
  #lessons .les[data-rv] h3,#lessons .les[data-rv] p,#lessons .les[data-rv] .t{opacity:1;transform:none;transition:none}
}
.no-webgl .word-fb{font-size:15vw;letter-spacing:.02em}
a:focus-visible,.nav-burger:focus-visible,.rail button:focus-visible{outline:2px solid var(--vermilion);outline-offset:5px}
</style>\n</head>`)
// Opaque sandboxed frames never receive the native desktop bridge or credentials.
page = replace(page, '</body>', `<script id="icarus-home-actions">
document.addEventListener('click', function(event) {
  var control = event.target.closest('[data-icarus-mode], [data-icarus-action]');
  if (!control) return;
  event.preventDefault();
  event.stopPropagation();
  var mode = control.dataset.icarusMode;
  parent.postMessage(mode
    ? {type:'icarus-home-action',action:'mode',mode:mode}
    : {type:'icarus-home-action',action:control.dataset.icarusAction}, '*');
}, true);
</script>\n</body>`)
await writeFile(path.join(publicPages, 'icarus-kage.html'), withRenderingLifecycle(optimizeKage(page)))
console.info('Prepared ICARUS Kage from 22 verified sources/assets with rendering lifecycle support.')

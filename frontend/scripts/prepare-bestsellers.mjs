import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const vendor = path.join(root, 'vendor/threeui')
const manifest = JSON.parse(await readFile(path.join(vendor, 'bestsellers-source-manifest.json'), 'utf8'))
for (const file of manifest.files) {
  const bytes = await readFile(path.join(vendor, file.path))
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Book showcase revision changed: ${file.path}`)
}
const original = await readFile(path.join(vendor, 'public/landing-pages/bestsellers-book-showcase.html'), 'utf8')
function replace(source, anchor, replacement) {
  if (!source.includes(anchor)) throw new Error(`Book showcase anchor missing: ${anchor.slice(0, 70)}`)
  return source.replace(anchor, replacement)
}
let page = original
page = replace(page, '<title>Field Manuals — Tools for Thought</title>', '<title>ICARUS — Ignite your mind</title>')
page = replace(page, 'An earth-toned interactive field library for Codex, Claude Code, and Cursor.', 'ICARUS: start coding, manage your model connection, or open settings.')
page = replace(page, 'Interactive AI coding field library', 'ICARUS application library')
page = replace(page, 'aria-label="Field Manuals home">Field Manuals', 'aria-label="ICARUS home">ICARUS')
page = replace(page, 'class="brand" href="#"', 'class="brand" href="#" data-icarus-library')
page = replace(page, 'class="hero-word" aria-hidden="true">Agents', 'class="hero-word" aria-hidden="true">ICARUS')
page = replace(page, 'aria-label="AI coding field manuals"', 'aria-label="ICARUS books"')
const books = {
  codex: { action: 'settings', label: 'Settings', cover: 'Settings', subtitle: 'Your Workspace', footer: 'Connections · Shortcuts · Flow', description: 'Check your local engine, manage connections, and keep ICARUS ready on this Mac.', steps: [
    { title: 'Check the local engine', body: 'See the connection status and retry if the local service is unavailable.' },
    { title: 'Connect your model', body: 'Test your model connection and save its token in macOS Keychain.' },
    { title: 'Keep the shortcut close', body: 'Press Command Shift Q from any app to open the ICARUS command menu.' },
    { title: 'Return to your work', body: 'Close settings to come back to the library.' },
  ], prompt: 'Command Shift Q · ICARUS from any app', review: 'Your model token stays in macOS Keychain. Check the connection before starting a request.' },
  claude: { action: 'code', label: 'Let’s code', cover: 'Let’s<br>code', subtitle: 'Ignite Your Mind', footer: 'Think · Understand · Build', description: 'Enter ICARUS and choose the kind of help your code needs. Choose from eight ways to understand, improve, and solve code.', steps: [
    { title: 'Choose your mode', body: 'Start with a hint, a clearer explanation, a repair, or a full solution.' },
    { title: 'Bring the code', body: 'Use the command menu to work with the code in front of you.' },
    { title: 'Keep your pace', body: 'Ask for as much help as you need and keep control of the next step.' },
    { title: 'Review the result', body: 'Read the answer and verify the changes in your own project.' },
  ], prompt: 'Explain the code in front of me and help me find the next step.', review: 'Review generated answers and verify any code before applying it.' },
  cursor: { action: 'models', label: 'Model connection', cover: 'Model<br>setup', subtitle: 'Your Intelligence', footer: 'Model · Connection · Key', description: 'Open your model connection and manage the intelligence behind ICARUS. Choose Hugging Face, OpenAI, Ollama, or LM Studio and test the selected model.', steps: [
    { title: 'Review your connection', body: 'See the current cloud model and saved-key status.' },
    { title: 'Add an access token', body: 'Test and save your API token securely in macOS Keychain.' },
    { title: 'Manage the key', body: 'Replace or remove the saved token from the model panel.' },
    { title: 'Start a request', body: 'Return to Let’s code and choose an ICARUS mode.' },
  ], prompt: 'Model connection · Your chosen provider', review: 'Prompts sent to this cloud model leave your Mac. The access token stays in macOS Keychain.' },
}
const previousTitles = { codex: 'Codex', claude: 'Claude<br>Code', cursor: 'Cursor' }
for (const [id, book] of Object.entries(books)) {
  const originalLabel = id === 'claude' ? 'Claude Code' : previousTitles[id]
  page = replace(page, `data-book="${id}"\n        aria-label="Open ${originalLabel} details"`, `data-book="${id}"\n        data-icarus-entry="${book.action}"\n        aria-label="${book.label}"`)
  page = page.replace(/<button\n        class="book-card"[\s\S]*?<\/button>/g, card => {
    if (!card.includes(`data-book="${id}"`)) return card
    return card.replace(`<span class="cover-title">${previousTitles[id]}</span>`, `<span class="cover-title">${book.cover}</span>`)
      .replace(/(<span class="cover-subtitle">)[^<]+/, `$1${book.subtitle}`)
      .replace(/(<span class="cover-footer">)[^<]+/, `$1${book.footer}`)
      .replace('class="open-badge">Read', 'class="open-badge">Open')
  })
}
// Only the book descriptions change inside the authored program. All motion,
// focus handling, reduced-motion rules, menus, media playback, and scrolling stay exact.
const dataStart = page.indexOf('      const books = {')
const dataEnd = page.indexOf('      const body = document.body;', dataStart)
if (dataStart < 0 || dataEnd < 0) throw new Error('Authored book data boundary changed')
const detailBooks = Object.fromEntries(Object.entries(books).map(([id, book]) => [id, { title: book.label, year: '2026', description: book.description, steps: book.steps, prompt: book.prompt, review: book.review }]))
page = page.slice(0, dataStart) + `      const books = ${JSON.stringify(detailBooks, null, 2)};\n\n` + page.slice(dataEnd)
page = replace(page, 'id="detailTitle">Claude Code', 'id="detailTitle">Let’s code')
page = replace(page, 'data-toast="The collection is complete.">The Collection', 'data-icarus-entry="code">Let’s code')
page = replace(page, 'href="#" data-menu-close>Volumes', 'href="#" data-menu-close data-icarus-entry="code">Let’s code')
page = replace(page, 'href="#notes" data-menu-close data-toast="Field notes are coming soon.">Notes', 'href="#models" data-menu-close data-icarus-entry="models">Model connection')
page = replace(page, 'href="#index" data-menu-close data-toast="An index of tools for thought.">Index', 'href="#settings" data-menu-close data-icarus-entry="settings">Settings')
page = replace(page, 'data-toast="Field edition · 2026"', 'data-toast="ICARUS · 2026"')
page = replace(page, '            Field Edition', '            ICARUS version')
page = replace(page, 'data-toast="Notes opened.">Read Notes', 'data-icarus-entry="settings">Workspace settings')
page = replace(page, 'data-toast="Guide opened.">View Guide', 'data-toast="Scroll through the Getting started guide above.">Getting started')
page = replace(page, 'aria-label="Save book" aria-pressed="false"', 'aria-label="Guide bookmark unavailable" aria-pressed="false" disabled')
page = replace(page, '>Field Notes</span>', '>ICARUS</span>')
page = replace(page, 'id="firstPromptLabel">Your first prompt', 'id="firstPromptLabel">Quick reference')
page = replace(page, 'id="reviewLabel">Before you ship', 'id="reviewLabel">Before you run')
page = replace(page, '</body>', `<script id="icarus-entry-actions">
function resetIcarusLibrary() {
  if (document.body.dataset.mode === 'detail') document.querySelector('#closeButton').click();
  if (document.body.dataset.menu === 'open') document.querySelector('#menuButton').click();
}
document.addEventListener('click', function(event) {
  var control = event.target.closest('[data-icarus-entry], [data-icarus-library]');
  if (!control) return;
  if (control.dataset.icarusLibrary !== undefined) {
    event.preventDefault();
    resetIcarusLibrary();
    return;
  }
  var action = control.dataset.icarusEntry;
  if (control.matches('.book-card')) {
    // Let the original click handler open the cover before changing screens.
    window.setTimeout(function() {
      if (document.body.dataset.mode === 'detail' && control.classList.contains('selected')) {
        parent.postMessage({type:'icarus-entry-action', action:action}, '*');
      }
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200);
  } else {
    event.preventDefault();
    parent.postMessage({type:'icarus-entry-action', action:action}, '*');
  }
});
window.addEventListener('message', function(event) {
  if (event.source !== window.parent || event.data?.type !== 'icarus-entry-reset') return;
  resetIcarusLibrary();
});
parent.postMessage({type:'icarus-entry-ready'}, '*');
</script>\n</body>`)
const pages = path.join(root, 'public/landing-pages')
await mkdir(pages, { recursive: true })
await writeFile(path.join(pages, 'bestsellers-book-showcase.html'), original)
await writeFile(path.join(pages, 'icarus-bestsellers.html'), page)
console.info('Prepared ICARUS books from four hash-verified registered sources; six embedded covers and authored motion preserved.')

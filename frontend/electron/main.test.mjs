import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { BackendSupervisor, consumeSSE, getInvocation, placePopup, validateModeRequest, validatePopupMode } from './main.ts'
import { KeychainStore } from './keychain.ts'

test('popup placement flips at both edges and respects a negative-origin display', () => {
  const workArea = { x: -1600, y: 25, width: 1600, height: 900 }
  const size = { width: 340, height: 430 }
  assert.deepEqual(placePopup({ x: -1200, y: 200 }, workArea, size), { x: -1184, y: 216, ...size })
  assert.deepEqual(placePopup({ x: -30, y: 900 }, workArea, size), { x: -386, y: 454, ...size })
  assert.deepEqual(placePopup({ x: -1598, y: 26 }, workArea, size), { x: -1582, y: 42, ...size })
  assert.deepEqual(placePopup({ x: 190, y: 190 }, { x: 0, y: 0, width: 200, height: 200 }, size),
    { x: 0, y: 0, width: 200, height: 200 })
})

test('mode requests validate exact commands and bounded prompts', () => {
  assert.deepEqual(validateModeRequest('ask_icarus', 'why?', null),
    { mode: 'ask_icarus', text: '', prompt: 'why?' })
  assert.equal(validateModeRequest('run_shell', 'why?', null).status, 'error')
  assert.equal(validateModeRequest('ask_icarus', 'x'.repeat(4096), null).mode, 'ask_icarus')
  assert.equal(validateModeRequest('ask_icarus', 'x'.repeat(4097), null).status, 'error')
  assert.equal(validateModeRequest('fix_code', undefined, null).status, 'error')
  assert.equal(validateModeRequest('fix_code', undefined, 'bad code').mode, 'fix_code')
  assert.deepEqual(getInvocation(), { selectedText: null })
  assert.deepEqual(validateModeRequest('fix_code', undefined, null, 'const x = 1'),
    { mode: 'fix_code', text: 'const x = 1', prompt: '' })
  assert.equal(validateModeRequest('fix_code', undefined, null, 'x'.repeat(65537)).status, 'error')
  assert.equal(validateModeRequest('fix_code', undefined, null, { code: 'x' }).status, 'error')
})

test('direct popup modes are allowlisted and default to the command menu', () => {
  assert.equal(validatePopupMode(undefined), undefined)
  for (const mode of ['logic_coach', 'explain_mistake', 'fix_code', 'hint',
    'explain_code', 'refactor', 'ask_icarus', 'full_solve']) {
    assert.equal(validatePopupMode(mode), mode)
    assert.deepEqual(getInvocation(mode), { selectedText: null, mode })
  }
  for (const mode of ['run_shell', 'fix_code ', '', null, { mode: 'hint' }]) {
    assert.equal(validatePopupMode(mode).status, 'error')
  }
  assert.deepEqual(getInvocation(), { selectedText: null })
})

test('full solve requires a problem or code and keeps request limits', () => {
  assert.deepEqual(validateModeRequest('full_solve', '  Solve this problem  ', null),
    { mode: 'full_solve', text: '', prompt: 'Solve this problem' })
  assert.deepEqual(validateModeRequest('full_solve', undefined, null, 'function unfinished() {}'),
    { mode: 'full_solve', text: 'function unfinished() {}', prompt: '' })
  assert.equal(validateModeRequest('full_solve', ' ', null, ' ').status, 'error')
  assert.equal(validateModeRequest('full_solve', 'x'.repeat(4097), null).status, 'error')
  assert.equal(validateModeRequest('full_solve', 'solve', null, 'x'.repeat(65537)).status, 'error')
})

test('SSE parser handles split UTF-8 and refuses oversized frames', async () => {
  const encoder = new TextEncoder()
  const bytes = encoder.encode('event: delta\ndata: {"text":"☃"}\n\nevent: done\ndata: {}\n\n')
  const events = []
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
  await consumeSSE(stream, event => events.push(event))
  assert.deepEqual(events, [{ type: 'delta', text: '☃' }, { type: 'done' }])

  let cancelled = false
  const oversized = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('x'.repeat(65537))) },
    cancel() { cancelled = true },
  })
  await assert.rejects(consumeSSE(oversized, () => {}), /Invalid model stream/)
  assert.equal(cancelled, true)

  const cumulative = new ReadableStream({
    start(controller) {
      for (let index = 0; index < 17; index += 1) {
        controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: 'x'.repeat(16384) })}\n\n`))
      }
      controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
      controller.close()
    },
  })
  await assert.rejects(consumeSSE(cumulative, () => {}), /Invalid model stream/)
})

test('Keychain wrapper sends a dummy key on stdin only', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'icarus-keychain-'))
  const helper = path.join(directory, 'helper.cjs')
  const state = path.join(directory, 'dummy-key')
  const calls = path.join(directory, 'calls')
  await writeFile(helper, `#!/usr/bin/env node
    const fs = require('node:fs')
    const op = process.argv[2]
    fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n')
    if (op === 'set') {
      let input = ''
      process.stdin.on('data', chunk => input += chunk)
      process.stdin.on('end', () => { fs.writeFileSync(${JSON.stringify(state)}, input); process.stdout.write('ok') })
    } else if (op === 'get') {
      if (!fs.existsSync(${JSON.stringify(state)})) process.exit(2)
      process.stdout.write(fs.readFileSync(${JSON.stringify(state)}))
    } else if (op === 'status') {
      process.stdout.write(fs.existsSync(${JSON.stringify(state)}) ? 'present' : 'missing')
    } else if (op === 'delete') {
      if (fs.existsSync(${JSON.stringify(state)})) fs.unlinkSync(${JSON.stringify(state)})
      process.stdout.write('ok')
    }
  `)
  await chmod(helper, 0o700)
  const keychain = new KeychainStore(helper)
  try {
    assert.equal(await keychain.status(), 'missing')
    await keychain.set('hf_dummy_test_key')
    assert.equal(await keychain.status(), 'configured')
    assert.equal(await keychain.get(), 'hf_dummy_test_key')
    assert.equal(await keychain.get(), 'hf_dummy_test_key')
    assert.equal((await readFile(calls, 'utf8')).split('\n').filter(line => line.startsWith('["get"')).length, 0,
      'a connected key stays in native memory without reopening Keychain')
    const reopened = new KeychainStore(helper)
    assert.deepEqual(await Promise.all([reopened.get(), reopened.get()]), ['hf_dummy_test_key', 'hf_dummy_test_key'])
    assert.equal(await reopened.status(), 'configured')
    assert.equal((await readFile(calls, 'utf8')).split('\n').filter(line => line.startsWith('["get"')).length, 1,
      'a new app session reads once, including concurrent requests')
    await keychain.set('replacement_fixture')
    assert.equal(await keychain.get(), 'replacement_fixture')
    await keychain.delete()
    assert.equal(await keychain.get(), null)
    assert.equal(await keychain.status(), 'missing')
    assert.doesNotMatch(await readFile(calls, 'utf8'), /hf_dummy_test_key/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the desktop shell reaches a token-protected backend and stops it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'icarus-backend-'))
  const scriptPath = path.join(directory, 'backend.cjs')
  const countPath = path.join(directory, 'starts')
  await writeFile(scriptPath, `
    const http = require('node:http')
    const fs = require('node:fs')
    const countPath = ${JSON.stringify(countPath)}
    let input = ''
    process.stdin.on('data', chunk => {
      input += chunk
      if (!input.includes('\\n')) return
      const { token } = JSON.parse(input.split('\\n')[0])
      const starts = (fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) : 0) + 1
      fs.writeFileSync(countPath, String(starts))
      if (starts === 1) process.exit(1)
      const port = Number(process.argv[process.argv.indexOf('--port') + 1])
      const server = http.createServer((request, response) => {
        if (request.headers.authorization !== 'Bearer ' + token) {
          response.writeHead(401).end()
        } else if (request.url === '/health') {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ status: 'ok' }))
        } else if (request.url === '/v1/chat/stream') {
          let body = ''
          request.on('data', chunk => body += chunk)
          request.on('end', () => {
            const value = JSON.parse(body)
            if (value.provider !== 'huggingface' || value.model !== 'Qwen/Qwen3.8-27B'
              || value.api_key !== 'hf_dummy_test_key' || value.prompt !== 'why?') {
              response.writeHead(400).end()
              return
            }
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.end('event: delta\\ndata: {"text":"answer"}\\n\\nevent: done\\ndata: {}\\n\\n')
          })
        }
      })
      setTimeout(() => server.listen(port, '127.0.0.1'), 150)
    })
  `)

  const backend = new BackendSupervisor(process.execPath, scriptPath)
  try {
    await backend.start()
    assert.deepEqual(await backend.health(), { status: 'ok' })
    assert.equal(await readFile(countPath, 'utf8'), '2')
    const stream = await backend.stream({
      mode: 'ask_icarus', text: '', prompt: 'why?', provider: 'huggingface',
      model: 'Qwen/Qwen3.8-27B', api_key: 'hf_dummy_test_key',
    }, AbortSignal.timeout(1000))
    const events = []
    await consumeSSE(stream, event => events.push(event))
    assert.deepEqual(events, [{ type: 'delta', text: 'answer' }, { type: 'done' }])
    await backend.stop()
    assert.deepEqual(await backend.health(), { status: 'error', message: 'Backend unavailable' })
  } finally {
    await backend.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

test('a rejected backend restart is handled and offers restart guidance', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'icarus-restart-'))
  const scriptPath = path.join(directory, 'exit.cjs')
  await writeFile(scriptPath, 'setTimeout(() => process.exit(1), 150)')
  const backend = new BackendSupervisor(process.execPath, scriptPath)
  try {
    await backend.start()
    backend.launch = async () => { throw new Error('fixture restart failure') }
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.deepEqual(await backend.health(), { status: 'error', message: 'Backend failed to restart. Restart Icarus.' })
  } finally {
    await backend.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

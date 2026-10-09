import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')

test('native Keychain operations never request a password for either provider', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'icarus-no-password-'))
  try {
    // Shadow every Security operation so this test cannot touch real credentials.
    const fixture = `
import Foundation
import Security
var interactionsAllowed = true
func SecKeychainSetUserInteractionAllowed(_ allowed: Bool) -> OSStatus {
    interactionsAllowed = allowed
    return errSecSuccess
}
func fixtureStatus(_ query: CFDictionary, _ operation: String) -> OSStatus {
    let item = query as! [String: Any]
    guard ["com.icarus.provider.huggingface", "com.icarus.provider.openai"].contains(item[kSecAttrService as String] as? String ?? ""),
          let account = item[kSecAttrAccount as String] as? String,
          ["api-key", "api-key.no-password"].contains(account) else { return errSecParam }
    let environment = ProcessInfo.processInfo.environment
    if interactionsAllowed || environment["ICARUS_FIXTURE_BLOCKED"] == "1" { return errSecInteractionNotAllowed }
    if let legacy = environment["ICARUS_FIXTURE_LEGACY"] {
        if account == "api-key" && legacy == "blocked" { return errSecInteractionNotAllowed }
        if account != "api-key" && operation == "read" { return errSecItemNotFound }
    }
    return errSecSuccess
}
func SecItemAdd(_ item: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus {
    return fixtureStatus(item, "set")
}
func SecItemUpdate(_ query: CFDictionary, _ updates: CFDictionary) -> OSStatus {
    return fixtureStatus(query, "set")
}
func SecItemDelete(_ query: CFDictionary) -> OSStatus {
    if let file = ProcessInfo.processInfo.environment["ICARUS_FIXTURE_DELETIONS"],
       let handle = FileHandle(forWritingAtPath: file) {
        handle.seekToEndOfFile()
        handle.write(Data(((query as! [String: Any])[kSecAttrAccount as String] as! String).utf8))
        handle.write(Data([10]))
        handle.closeFile()
    }
    return fixtureStatus(query, "delete")
}
func SecItemCopyMatching(_ query: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus {
    let status = fixtureStatus(query, "read")
    if status == errSecSuccess { result?.pointee = Data("fixture-saved-token".utf8) as CFData }
    return status
}
`
    const source = path.join(directory, 'fixture.swift')
    const executable = path.join(directory, 'fixture')
    await writeFile(source, fixture + await readFile(path.join(root, 'native/keychain.swift'), 'utf8'))
    const { stdout: sdk } = await execute('xcrun', ['--sdk', 'macos', '--show-sdk-path'])
    await execute('swiftc', ['-sdk', sdk.trim(),
      '-module-cache-path', path.join(directory, 'modules'), source, '-o', executable])
    const run = async (operation, provider, env = process.env) => {
      const child = execFile(executable, [operation, provider], { timeout: 1000, env })
      const result = new Promise((resolve, reject) => {
        let stdout = ''
        child.stdout.on('data', chunk => { stdout += chunk })
        child.on('error', reject)
        child.on('close', code => resolve({ code, stdout }))
      })
      child.stdin.end(operation === 'set' ? 'fixture-saved-token' : '')
      return result
    }
    for (const provider of ['huggingface', 'openai']) {
      for (const [operation, expected] of [['set', 'ok'], ['get', 'fixture-saved-token'], ['status', 'present'], ['delete', 'ok']]) {
        assert.deepEqual(await run(operation, provider), { code: 0, stdout: expected }, `${provider} ${operation} must disable Keychain dialogs`)
      }
      const readable = { ...process.env, ICARUS_FIXTURE_LEGACY: 'readable' }
      assert.deepEqual(await run('get', provider, readable), { code: 0, stdout: 'fixture-saved-token' }, 'readable legacy tokens remain usable')
      const blocked = { ...process.env, ICARUS_FIXTURE_LEGACY: 'blocked' }
      assert.deepEqual(await run('get', provider, blocked), { code: 2, stdout: '' }, 'inaccessible legacy tokens recover as missing without requesting a password')
      assert.deepEqual(await run('status', provider, blocked), { code: 0, stdout: 'missing' })
      assert.deepEqual(await run('set', provider, blocked), { code: 0, stdout: 'ok' }, 're-entering an API key must not require access to the legacy entry')
      const deletions = path.join(directory, 'deletions')
      await writeFile(deletions, '')
      assert.deepEqual(await run('delete', provider, { ...process.env, ICARUS_FIXTURE_DELETIONS: deletions }), { code: 0, stdout: 'ok' })
      assert.equal(await readFile(deletions, 'utf8'), 'api-key\napi-key.no-password\n', 'deleted legacy tokens cannot reappear after restart')
    }
    await assert.rejects(execute(executable, ['get', 'huggingface'], {
      timeout: 1000, env: { ...process.env, ICARUS_FIXTURE_BLOCKED: '1' },
    }), error => error.code === 1 && error.stdout === '', 'inaccessible keys fail without leaking a token or prompting')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('native builds use the active macOS SDK and preserve the trusted Keychain helper', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'icarus-stable-keychain-'))
  try {
    await mkdir(path.join(directory, 'native'))
    await mkdir(path.join(directory, 'bin'))
    await writeFile(path.join(directory, 'native/keychain.swift'), '// fixture keychain')
    await writeFile(path.join(directory, 'native/selection.swift'), '// fixture selection')
    const { scripts } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ scripts: { 'build:native': scripts['build:native'] } }))
    const compiler = path.join(directory, 'bin/swiftc')
    await writeFile(compiler, `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
require('node:assert/strict').equal(args[args.indexOf('-sdk') + 1], '/fixture macOS SDK')
const output = args[args.indexOf('-o') + 1]
fs.appendFileSync('calls', output + '\\n')
fs.writeFileSync(output, 'fixture executable', { mode: 0o700 })
`)
    await chmod(compiler, 0o700)
    const xcrun = path.join(directory, 'bin/xcrun')
    await writeFile(xcrun, '#!/bin/sh\n[ "$*" = "--sdk macos --show-sdk-path" ] || exit 2\nprintf "%s\\n" "/fixture macOS SDK"\n')
    await chmod(xcrun, 0o700)
    const options = { cwd: directory, env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}` } }
    await execute('npm', ['run', 'build:native'], options)
    await execute('npm', ['run', 'build:native'], options)
    const compilations = async () => (await readFile(path.join(directory, 'calls'), 'utf8'))
      .split('\n').filter(line => line.endsWith('icarus-keychain')).length
    assert.equal(await compilations(), 1, 'restarting the app must not replace the trusted executable')
    await appendFile(path.join(directory, 'native/keychain.swift'), '\n// changed source')
    await execute('npm', ['run', 'build:native'], options)
    assert.equal(await compilations(), 2, 'a changed helper must still be rebuilt')
    const calls = await readFile(path.join(directory, 'calls'), 'utf8')
    await writeFile(xcrun, '#!/bin/sh\nexit 7\n')
    await assert.rejects(execute('npm', ['run', 'build:native'], options), 'a missing SDK must stop the build')
    assert.equal(await readFile(path.join(directory, 'calls'), 'utf8'), calls, 'SDK discovery failure must not replace any helper')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as connection from './main.ts'

test('key detection uses unique formats without guessing generic or Anthropic keys', () => {
  for (const [key, provider] of [['hf_fixture', 'huggingface'], ['gsk_fixture', 'groq'],
    ['sk-or-v1-fixture', 'openrouter'], ['sk-proj-fixture', 'openai'], ['sk-svcacct-fixture', 'openai'],
    ['AIzaSyfixture', 'gemini']]) assert.equal(connection.detectProvider(key), provider)
  for (const key of ['', 'generic-fixture-token', 'sk-ambiguous', 'sk-ant-fixture']) {
    assert.equal(connection.detectProvider(key), null)
  }
})

test('unset settings and new providers validate while custom destinations are explicit', () => {
  assert.deepEqual(connection.validateConnectionSettings({ provider: 'none', model: '' }), { provider: 'none', model: '' })
  for (const provider of ['groq', 'openrouter', 'gemini']) {
    assert.deepEqual(connection.validateConnectionSettings({ provider, model: 'fixture' }), { provider, model: 'fixture' })
  }
  assert.deepEqual(connection.validateConnectionSettings({ provider: 'custom', model: 'fixture', base_url: 'https://api.example.com/v1/' }),
    { provider: 'custom', model: 'fixture', base_url: 'https://api.example.com/v1' })
  for (const base_url of ['http://api.example.com/v1', 'https://127.0.0.1/v1', 'https://localhost/v1',
    'https://[::1]/v1', 'https://user:pass@api.example.com/v1', 'https://api.example.com/v1?q=secret',
    'https://api.example.com/v1#fragment']) {
    assert.equal(connection.validateConnectionSettings({ provider: 'custom', model: 'fixture', base_url }), null)
  }
  assert.equal(connection.validateConnectionSettings({ provider: 'openai', model: 'fixture', base_url: 'https://wrong.example.com/v1' }), null)
  assert.equal(connection.validateConnectionSettings({ provider: 'none', model: 'accidental-default' }), null)
})

test('custom Keychain service identities are scoped to the canonical API endpoint', () => {
  const one = connection.keychainProvider({ provider: 'custom', model: 'one', base_url: 'https://api.example.com/v1' })
  const same = connection.keychainProvider({ provider: 'custom', model: 'two', base_url: 'https://api.example.com/v1/' })
  const another = connection.keychainProvider({ provider: 'custom', model: 'one', base_url: 'https://other.example.com/v1' })
  assert.match(one, /^custom-[a-f0-9]{64}$/)
  assert.equal(one, same)
  assert.notEqual(one, another)
  assert.equal(connection.keychainProvider({ provider: 'groq', model: 'one' }), 'groq')
  assert.equal(connection.keychainProvider({ provider: 'none', model: '' }), null)
  assert.equal(connection.keychainProvider({ provider: 'ollama', model: 'one' }), null)
})

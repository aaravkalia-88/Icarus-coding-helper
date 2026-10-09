import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

test('the connection form begins unset and offers discovery and Other API without a default model', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { ProviderConnection } = await server.ssrLoadModule('/src/App.tsx')
    const html = renderToStaticMarkup(createElement(ProviderConnection))
    assert.match(html, /<option value="none" selected="">/)
    assert.match(html, /Other API/)
    assert.match(html, /Discover models/)
    assert.doesNotMatch(html, /value="Qwen\/Qwen3\.8-27B"/)
    assert.match(html, /type="password"/)
  } finally {
    await server.close()
  }
})

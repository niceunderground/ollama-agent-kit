import test from 'node:test'
import assert from 'node:assert/strict'

import { createOllamaClient } from '../src/ollama.js'

test('apiKey is sent as an Authorization header', () => {
    const client = createOllamaClient({ apiKey: 'k123' })
    assert.equal(client.config.headers.Authorization, 'Bearer k123')
})

test('explicit headers win over the apiKey-derived Authorization header', () => {
    const client = createOllamaClient({ apiKey: 'k123', headers: { Authorization: 'Bearer other' } })
    assert.equal(client.config.headers.Authorization, 'Bearer other')
})

test('no headers are set when neither apiKey nor headers are given', () => {
    const client = createOllamaClient()
    assert.equal(client.config.headers, undefined)
})

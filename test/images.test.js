import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveImage, resolveImages, resolveConversationImages } from '../src/images.js'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_BASE64 = PNG_BYTES.toString('base64')

test('a Buffer or Uint8Array is base64-encoded', async () => {
    assert.equal(await resolveImage(PNG_BYTES), PNG_BASE64)
    assert.equal(await resolveImage(new Uint8Array(PNG_BYTES)), PNG_BASE64)
})

test('a base64 string passes through unchanged', async () => {
    assert.equal(await resolveImage(PNG_BASE64), PNG_BASE64)
})

test('a file path is read from disk and base64-encoded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oak-images-'))
    const file = join(dir, 'pixel.png')
    await writeFile(file, PNG_BYTES)
    try {
        assert.equal(await resolveImage(file), PNG_BASE64)
    }
    finally {
        await rm(dir, { recursive: true, force: true })
    }
})

test('a data: URI is stripped to its base64 payload', async () => {
    assert.equal(await resolveImage(`data:image/png;base64,${PNG_BASE64}`), PNG_BASE64)
})

test('an http(s) URL is fetched and base64-encoded', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
        assert.equal(url, 'https://example.com/pixel.png')
        return { ok: true, arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength) }
    }
    try {
        assert.equal(await resolveImage('https://example.com/pixel.png'), PNG_BASE64)
    }
    finally {
        globalThis.fetch = originalFetch
    }
})

test('a failed image fetch throws with the status code', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => ({ ok: false, status: 404 })
    try {
        await assert.rejects(() => resolveImage('https://example.com/missing.png'), /HTTP 404/)
    }
    finally {
        globalThis.fetch = originalFetch
    }
})

test('an unsupported image type throws a TypeError', async () => {
    await assert.rejects(() => resolveImage(42), TypeError)
})

test('resolveImages normalizes every entry', async () => {
    const resolved = await resolveImages([PNG_BYTES, PNG_BASE64])
    assert.deepEqual(resolved, [PNG_BASE64, PNG_BASE64])
})

test('resolveConversationImages resolves message images in place and is idempotent', async () => {
    const messages = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'look', images: [PNG_BYTES] },
        { role: 'assistant', content: 'ok' },
    ]
    await resolveConversationImages(messages)
    assert.deepEqual(messages[1].images, [PNG_BASE64])

    // a second pass leaves the already-encoded images untouched
    await resolveConversationImages(messages)
    assert.deepEqual(messages[1].images, [PNG_BASE64])
})

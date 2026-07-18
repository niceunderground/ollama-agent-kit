// Image input normalization for multimodal (vision) models.
//
// Ollama expects message images as base64 strings. Callers can pass something
// friendlier — a file path, an http(s) URL, a data: URI, a Buffer/Uint8Array,
// or an already-encoded base64 string — and everything is normalized to base64
// before the request is sent.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 * Normalize one image input to a base64 string.
 *
 * @param {string | Uint8Array} image A file path, an http(s) URL, a `data:` URI,
 *   a base64 string, a Buffer or a Uint8Array.
 * @returns {Promise<string>} The base64-encoded image data.
 */
export async function resolveImage(image) {
    if (image instanceof Uint8Array) return Buffer.from(image).toString('base64')
    if (typeof image !== 'string') {
        throw new TypeError('An image must be a file path, an http(s) URL, a data: URI, a base64 string, a Buffer or a Uint8Array')
    }
    if (/^https?:\/\//i.test(image)) {
        const response = await fetch(image)
        if (!response.ok) throw new Error(`Failed to fetch image "${image}": HTTP ${response.status}`)
        return Buffer.from(await response.arrayBuffer()).toString('base64')
    }
    if (image.startsWith('data:')) {
        const comma = image.indexOf(',')
        if (comma === -1) throw new Error(`Malformed data: URI image`)
        return image.slice(comma + 1)
    }
    // A string short enough to be a path that names an existing file is read
    // from disk; anything else is assumed to be base64 data already.
    if (image.length < 4096 && existsSync(image)) {
        return (await readFile(image)).toString('base64')
    }
    return image
}

/**
 * Normalize a list of image inputs to base64 strings.
 *
 * @param {Array<string | Uint8Array>} images
 * @returns {Promise<string[]>}
 */
export function resolveImages(images) {
    return Promise.all(images.map(resolveImage))
}

/**
 * Resolve the `images` field of every message in a conversation, in place.
 * Idempotent: already-encoded base64 entries pass through unchanged, so a
 * persistent conversation can be re-run safely.
 *
 * @param {object[]} messages
 * @returns {Promise<object[]>} The same array.
 */
export async function resolveConversationImages(messages) {
    for (const message of messages) {
        if (Array.isArray(message?.images) && message.images.length > 0) {
            message.images = await resolveImages(message.images)
        }
    }
    return messages
}

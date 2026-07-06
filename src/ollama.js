import { Ollama } from 'ollama'

/**
 * Create a configured Ollama client.
 *
 * This replaces the server's hardcoded `new Ollama({ host: 'http://localhost:11434' })`
 * plus the global `globalThis.fetch = fetch` patch: pass your own `fetch`
 * implementation (e.g. `node-fetch`) instead of mutating the global.
 *
 * @param {object} [opts]
 * @param {string} [opts.host='http://localhost:11434'] Base URL of a local/remote Ollama instance.
 * @param {string} [opts.apiKey] API key (for Ollama Cloud / hosted models and web search / web fetch).
 * @param {Function} [opts.fetch] Custom fetch implementation, injected instead of patching globalThis.
 * @param {Record<string,string>} [opts.headers] Extra headers sent with every request.
 * @returns {import('ollama').Ollama}
 */
export function createOllamaClient({
    host = 'http://localhost:11434',
    apiKey,
    fetch,
    headers,
} = {}) {
    const opts = {}
    if (host) opts.host = host
    if (apiKey) opts.apiKey = apiKey
    if (fetch) opts.fetch = fetch
    if (headers) opts.headers = headers
    return new Ollama(opts)
}

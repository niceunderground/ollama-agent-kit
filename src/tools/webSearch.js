import { z } from 'zod'

import { createOllamaClient } from '../ollama.js'

/**
 * Optional `web_search` tool, backed by the Ollama web search API.
 * Requires an Ollama API key (Ollama Cloud). Pass a `client` or an `apiKey`.
 *
 * @param {object} [opts]
 * @param {import('ollama').Ollama} [opts.client] Pre-built Ollama client to use.
 * @param {string} [opts.apiKey] Ollama API key (used if no `client` is given).
 * @param {number} [opts.maxResults=10]
 * @returns {import('../registry.js').Tool}
 */
export function webSearchTool({ client, apiKey, maxResults = 10 } = {}) {
    const ollama = client ?? createOllamaClient({ apiKey })
    return {
        name: 'web_search',
        description: 'Execute an online search / web search and return the results.',
        parameters: z.object({
            query: z.string().describe('The search query'),
        }),
        exposeAgent: true,
        exposeMcp: false,
        handler: async ({ query }) => await ollama.webSearch({ query, maxResults }),
    }
}

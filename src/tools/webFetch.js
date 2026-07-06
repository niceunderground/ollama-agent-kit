import { z } from 'zod'

import { createOllamaClient } from '../ollama.js'

/**
 * Optional `web_fetch` tool, backed by the Ollama web fetch API.
 * Requires an Ollama API key (Ollama Cloud). Pass a `client` or an `apiKey`.
 *
 * @param {object} [opts]
 * @param {import('ollama').Ollama} [opts.client] Pre-built Ollama client to use.
 * @param {string} [opts.apiKey] Ollama API key (used if no `client` is given).
 * @returns {import('../registry.js').Tool}
 */
export function webFetchTool({ client, apiKey } = {}) {
    const ollama = client ?? createOllamaClient({ apiKey })
    return {
        name: 'web_fetch',
        description: 'Fetch the content of a url / web page and return it.',
        parameters: z.object({
            url: z.string().describe('The url to fetch'),
        }),
        exposeAgent: true,
        exposeMcp: false,
        handler: async ({ url }) => await ollama.webFetch({ url }),
    }
}

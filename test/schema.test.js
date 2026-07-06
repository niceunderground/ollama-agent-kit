import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { toOllamaTool } from '../src/registry.js'

test('toOllamaTool wraps a local (zod) tool in the Ollama function format', () => {
    const tool = {
        name: 'web_search',
        description: 'Search the web',
        parameters: z.object({
            query: z.string().describe('The search query'),
        }),
        handler: async () => 'ok',
    }

    const out = toOllamaTool(tool)

    assert.equal(out.type, 'function')
    assert.equal(out.function.name, 'web_search')
    assert.equal(out.function.description, 'Search the web')
    assert.equal(out.function.parameters.type, 'object')
    assert.ok(out.function.parameters.properties.query, 'query property present')
    assert.equal(out.function.parameters.properties.query.type, 'string')
})

test('toOllamaTool passes MCP rawParameters (JSON Schema) through untouched', () => {
    const rawParameters = {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
    }
    const tool = {
        name: 'fs__read',
        description: 'Read a file',
        rawParameters,
        handler: async () => 'ok',
    }

    const out = toOllamaTool(tool)

    assert.equal(out.function.parameters, rawParameters)
})

test('toOllamaTool prefers rawParameters over zod parameters when both are present', () => {
    const rawParameters = { type: 'object', properties: {} }
    const out = toOllamaTool({
        name: 't',
        description: 'd',
        rawParameters,
        parameters: z.object({ a: z.string() }),
        handler: async () => {},
    })
    assert.equal(out.function.parameters, rawParameters)
})

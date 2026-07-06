import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { createMcpServer } from '../src/mcp/server.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const tools = [
    {
        name: 'greet',
        description: 'Greet someone by name',
        parameters: z.object({ name: z.string() }),
        exposeAgent: true,
        exposeMcp: true,
        handler: async ({ name }) => `Hello, ${name}!`,
    },
    {
        name: 'add',
        description: 'Add two numbers',
        parameters: z.object({ a: z.number(), b: z.number() }),
        exposeMcp: true,
        handler: async ({ a, b }) => a + b,
    },
    {
        name: 'secret',
        description: 'Agent-only tool, must not be published',
        parameters: z.object({}),
        exposeAgent: true,
        exposeMcp: false,
        handler: async () => 'nope',
    },
]

async function connectedClient(server) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(clientTransport)
    return client
}

test('createMcpServer only publishes exposeMcp tools', async () => {
    const server = await createMcpServer(tools)
    const client = await connectedClient(server)

    const { tools: published } = await client.listTools()
    const names = published.map(t => t.name).sort()
    assert.deepEqual(names, ['add', 'greet'])   // 'secret' is exposeMcp:false

    await client.close()
    await server.close()
})

test('published tools carry the JSON Schema converted from zod', async () => {
    const server = await createMcpServer(tools)
    const client = await connectedClient(server)

    const { tools: published } = await client.listTools()
    const greet = published.find(t => t.name === 'greet')
    assert.equal(greet.inputSchema.type, 'object')
    assert.ok(greet.inputSchema.properties.name, 'name property present')

    await client.close()
    await server.close()
})

test('calling a published tool runs the same handler and returns text content', async () => {
    const server = await createMcpServer(tools)
    const client = await connectedClient(server)

    const greet = await client.callTool({ name: 'greet', arguments: { name: 'Ada' } })
    assert.equal(greet.content[0].text, 'Hello, Ada!')

    // non-string results are JSON-stringified
    const sum = await client.callTool({ name: 'add', arguments: { a: 2, b: 3 } })
    assert.equal(sum.content[0].text, '5')

    await client.close()
    await server.close()
})

test('includeAll ignores the exposeMcp flag', async () => {
    const server = await createMcpServer(tools, { includeAll: true })
    const client = await connectedClient(server)

    const { tools: published } = await client.listTools()
    assert.equal(published.length, 3)

    await client.close()
    await server.close()
})

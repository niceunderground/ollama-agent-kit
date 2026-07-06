import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { createAgent } from '../src/agent.js'
import { MaxTurnsError } from '../src/errors.js'

/**
 * Minimal fake Ollama client: `chat` returns queued responses in order.
 * Each queued item is a `message` object.
 */
function fakeClient(messages) {
    const queue = [...messages]
    const calls = []
    return {
        calls,
        async chat(req) {
            calls.push(req)
            return { message: queue.shift() }
        },
    }
}

const echoTool = {
    name: 'echo',
    description: 'echoes its input',
    parameters: z.object({ value: z.string() }),
    handler: async ({ value }) => `echo:${value}`,
}

test('run returns the final answer when the model stops calling tools', async () => {
    const client = fakeClient([{ content: 'final answer', tool_calls: [] }])
    const agent = createAgent({ client, tools: [echoTool] })
    const answer = await agent.run('hi')
    assert.equal(answer, 'final answer')
    assert.equal(client.calls.length, 1)
})

test('run executes tool calls, feeds results back, then returns the answer', async () => {
    const client = fakeClient([
        { content: '', tool_calls: [{ function: { name: 'echo', arguments: { value: 'hello' } } }] },
        { content: 'done', tool_calls: [] },
    ])
    const toolCalls = []
    const agent = createAgent({
        client,
        tools: [echoTool],
        onToolCall: (e) => toolCalls.push(e),
    })

    const answer = await agent.run('use echo')
    assert.equal(answer, 'done')

    // onToolCall fired with the executed result
    assert.equal(toolCalls.length, 1)
    assert.equal(toolCalls[0].name, 'echo')
    assert.equal(toolCalls[0].result, 'echo:hello')
    assert.equal(toolCalls[0].error, null)

    // second chat turn saw the tool result appended to the conversation
    const secondTurnMessages = client.calls[1].messages
    const toolMsg = secondTurnMessages.find(m => m.role === 'tool')
    assert.ok(toolMsg)
    assert.equal(toolMsg.content, 'echo:hello')
    assert.equal(toolMsg.tool_name, 'echo')
})

test('a thrown tool error is captured and reported, not propagated', async () => {
    const boom = {
        name: 'boom',
        description: 'always throws',
        parameters: z.object({}),
        handler: async () => { throw new Error('kaboom') },
    }
    const client = fakeClient([
        { content: '', tool_calls: [{ function: { name: 'boom', arguments: {} } }] },
        { content: 'recovered', tool_calls: [] },
    ])
    const seen = []
    const agent = createAgent({ client, tools: [boom], onToolCall: (e) => seen.push(e) })

    const answer = await agent.run('go')
    assert.equal(answer, 'recovered')
    assert.equal(seen[0].error.message, 'kaboom')
    assert.match(seen[0].result, /kaboom/)
})

test('an unknown tool name is reported back to the model', async () => {
    const client = fakeClient([
        { content: '', tool_calls: [{ function: { name: 'ghost', arguments: {} } }] },
        { content: 'ok', tool_calls: [] },
    ])
    const seen = []
    const agent = createAgent({ client, tools: [echoTool], onToolCall: (e) => seen.push(e) })

    await agent.run('go')
    assert.equal(seen[0].error.name, 'ToolNotFoundError')
})

test('run throws MaxTurnsError when the model never stops', async () => {
    const client = fakeClient([
        { content: '', tool_calls: [{ function: { name: 'echo', arguments: { value: 'a' } } }] },
        { content: '', tool_calls: [{ function: { name: 'echo', arguments: { value: 'b' } } }] },
    ])
    const agent = createAgent({ client, tools: [echoTool], maxTurns: 2 })
    await assert.rejects(() => agent.run('loop'), MaxTurnsError)
})

test('a function entry in tools is called with the agent context (client, apiKey, host)', async () => {
    const client = fakeClient([{ content: 'x', tool_calls: [] }])
    let receivedCtx = null
    const factory = (ctx) => {
        receivedCtx = ctx
        return { ...echoTool, name: 'from_factory' }
    }
    const agent = createAgent({ client, apiKey: 'k123', tools: [echoTool, factory] })

    const resolved = await agent.resolveTools()
    assert.deepEqual(resolved.map(t => t.name), ['echo', 'from_factory'])
    assert.equal(receivedCtx.client, client)
    assert.equal(receivedCtx.apiKey, 'k123')
    assert.equal(receivedCtx.host, 'http://localhost:11434')
})

test('mcp tools are merged and local names win on collision', async () => {
    const client = fakeClient([{ content: 'x', tool_calls: [] }])
    const agent = createAgent({
        client,
        tools: [echoTool],
        mcp: async () => ([
            { name: 'echo', description: 'remote echo', rawParameters: { type: 'object' }, handler: async () => 'remote' },
            { name: 'remote_only', description: 'r', rawParameters: { type: 'object' }, handler: async () => 'r' },
        ]),
    })
    const resolved = await agent.resolveTools()
    const names = resolved.map(t => t.name)
    assert.deepEqual(names, ['echo', 'remote_only'])
    // the local echo (with zod parameters) was kept, not the remote one
    assert.ok(resolved.find(t => t.name === 'echo').parameters)
})

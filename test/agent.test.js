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

test('run with opts.messages keeps a persistent conversation across runs', async () => {
    const client = fakeClient([
        { content: 'first answer', tool_calls: [] },
        { content: 'second answer', tool_calls: [] },
    ])
    const agent = createAgent({ client, tools: [echoTool] })

    const history = []
    await agent.run('first question', { messages: history })
    assert.equal(history[0].role, 'system')
    assert.deepEqual(history[1], { role: 'user', content: 'first question' })
    assert.equal(history[2].content, 'first answer')

    await agent.run('second question', { messages: history })
    // the second request carried the whole conversation
    const secondRequest = client.calls[1].messages
    assert.deepEqual(secondRequest.filter(m => m.role === 'user').map(m => m.content), ['first question', 'second question'])
    assert.equal(history.at(-1).content, 'second answer')
    assert.equal(history.length, 5)
})

test('run accepts a messages array directly, normalizing string entries', async () => {
    const client = fakeClient([{ content: 'ok', tool_calls: [] }])
    const agent = createAgent({ client, tools: [echoTool] })

    const history = ['hello']
    const answer = await agent.run(history)
    assert.equal(answer, 'ok')
    assert.equal(history[0].role, 'system')
    assert.deepEqual(history[1], { role: 'user', content: 'hello' })
    assert.equal(history.at(-1).content, 'ok')
})

test('a string prompt without opts.messages stays a single task', async () => {
    const client = fakeClient([
        { content: 'a', tool_calls: [] },
        { content: 'b', tool_calls: [] },
    ])
    const agent = createAgent({ client, tools: [echoTool] })
    await agent.run('one')
    await agent.run('two')
    // each run started a fresh conversation: one user message per request
    assert.equal(client.calls[1].messages.filter(m => m.role === 'user').length, 1)
})

test('run attaches images to the user message, normalized to base64', async () => {
    const client = fakeClient([{ content: 'a red pixel', tool_calls: [] }])
    const agent = createAgent({ client })

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await agent.run('What is in this image?', { images: [bytes] })

    const userMsg = client.calls[0].messages.find(m => m.role === 'user')
    assert.deepEqual(userMsg.images, [bytes.toString('base64')])
})

test('run with opts.messages carries images on the appended user message', async () => {
    const client = fakeClient([{ content: 'seen', tool_calls: [] }])
    const agent = createAgent({ client })

    const history = []
    const bytes = Buffer.from('img')
    await agent.run('Look at this', { messages: history, images: [bytes] })

    const userMsg = history.find(m => m.role === 'user')
    assert.deepEqual(userMsg.images, [bytes.toString('base64')])
})

test('images inside a messages-array input are resolved before the request', async () => {
    const client = fakeClient([{ content: 'ok', tool_calls: [] }])
    const agent = createAgent({ client })

    const bytes = Buffer.from('img')
    await agent.run([{ role: 'user', content: 'describe', images: [bytes] }])

    const userMsg = client.calls[0].messages.find(m => m.role === 'user')
    assert.deepEqual(userMsg.images, [bytes.toString('base64')])
})

test('the request omits tools when the agent has none (vision models without tool support)', async () => {
    const client = fakeClient([{ content: 'x', tool_calls: [] }])
    const agent = createAgent({ client })
    await agent.run('hi')
    assert.ok(!('tools' in client.calls[0]))
})

test('the request still carries tools when the agent has them', async () => {
    const client = fakeClient([{ content: 'x', tool_calls: [] }])
    const agent = createAgent({ client, tools: [echoTool] })
    await agent.run('hi')
    assert.equal(client.calls[0].tools.length, 1)
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

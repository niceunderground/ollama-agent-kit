import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import {
    createRegistry,
    validateTools,
    toHandlerMap,
    defineTool,
} from '../src/registry.js'
import { RegistryError } from '../src/errors.js'

const okTool = (name, extra = {}) => ({
    name,
    description: `${name} tool`,
    parameters: z.object({}),
    handler: async () => 'ok',
    ...extra,
})

test('validateTools accepts a well-formed list and returns the seen names', () => {
    const seen = validateTools([okTool('a'), okTool('b')])
    assert.deepEqual([...seen].sort(), ['a', 'b'])
})

test('validateTools rejects a tool without a name', () => {
    assert.throws(
        () => validateTools([{ handler: async () => {} }]),
        RegistryError,
    )
})

test('validateTools rejects a tool whose handler is not a function', () => {
    assert.throws(
        () => validateTools([{ name: 'bad', handler: 'nope' }]),
        RegistryError,
    )
})

test('validateTools rejects duplicate tool names', () => {
    assert.throws(
        () => validateTools([okTool('dup'), okTool('dup')]),
        /Duplicate tool/,
    )
})

test('createRegistry splits tools by exposeAgent / exposeMcp', () => {
    const reg = createRegistry([
        okTool('agent-only', { exposeAgent: true }),
        okTool('mcp-only', { exposeMcp: true }),
        okTool('both', { exposeAgent: true, exposeMcp: true }),
    ])
    assert.deepEqual(reg.agentTools.map(t => t.name), ['agent-only', 'both'])
    assert.deepEqual(reg.mcpTools.map(t => t.name), ['mcp-only', 'both'])
})

test('toHandlerMap maps every tool name to its handler', () => {
    const a = okTool('a')
    const b = okTool('b')
    const map = toHandlerMap([a, b])
    assert.equal(map.a, a.handler)
    assert.equal(map.b, b.handler)
})

test('defineTool returns the tool unchanged', () => {
    const t = okTool('x')
    assert.equal(defineTool(t), t)
})

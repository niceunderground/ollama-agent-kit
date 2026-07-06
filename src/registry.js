import { z } from 'zod'

import { RegistryError } from './errors.js'

/**
 * @typedef {object} Tool
 * @property {string} name Unique tool name.
 * @property {string} [description] Human/LLM readable description.
 * @property {import('zod').ZodType} [parameters] Zod schema (local tools). Converted to JSON Schema for Ollama.
 * @property {object} [rawParameters] JSON Schema (MCP tools already ship JSON Schema, no zod).
 * @property {boolean} [exposeAgent] Available to the agent loop.
 * @property {boolean} [exposeMcp] Published by your own MCP server.
 * @property {(args: any) => any | Promise<any>} handler Executes the tool.
 */

/**
 * Validate a list of tools. A malformed tool must fail immediately at startup,
 * not mid-conversation.
 * @param {Tool[]} tools
 * @returns {Set<string>} the set of seen tool names
 */
export function validateTools(tools) {
    const seen = new Set()
    for (const tool of tools) {
        if (!tool?.name || typeof tool.handler !== 'function') {
            throw new RegistryError(`Malformed tool in registry: ${JSON.stringify(tool?.name ?? tool)}`)
        }
        if (seen.has(tool.name)) {
            throw new RegistryError(`Duplicate tool in registry: "${tool.name}"`)
        }
        seen.add(tool.name)
    }
    return seen
}

/**
 * Convert a registry tool into the Ollama API `tools` format.
 * MCP tools already carry JSON Schema (`rawParameters`); local tools carry zod (`parameters`).
 * @param {Tool} tool
 */
export function toOllamaTool(tool) {
    const fn = {
        name: tool.name,
        description: tool.description,
    }
    if (tool.rawParameters) fn.parameters = tool.rawParameters
    else if (tool.parameters) fn.parameters = z.toJSONSchema(tool.parameters)
    return { type: 'function', function: fn }
}

/**
 * Build a `{ [name]: handler }` map for fast dispatch during the loop.
 * @param {Tool[]} toolList
 */
export function toHandlerMap(toolList) {
    return Object.fromEntries(toolList.map(t => [t.name, t.handler]))
}

/**
 * Identity helper for authoring a single tool. Gives editors JSDoc types and a
 * clear "this object is a tool" intent, without changing the object.
 * @param {Tool} tool
 * @returns {Tool}
 */
export function defineTool(tool) {
    return tool
}

/**
 * Create a validated registry from a flat list of tools.
 * The same definition serves both the agent (`exposeAgent`) and your MCP server (`exposeMcp`).
 * @param {Tool[]} [tools]
 */
export function createRegistry(tools = []) {
    const names = validateTools(tools)
    return {
        tools,
        names,
        agentTools: tools.filter(t => t.exposeAgent),
        mcpTools: tools.filter(t => t.exposeMcp),
        toOllamaTool,
        toHandlerMap,
    }
}

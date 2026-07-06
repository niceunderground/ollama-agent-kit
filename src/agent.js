import { createOllamaClient } from './ollama.js'
import { toOllamaTool, toHandlerMap, validateTools } from './registry.js'
import { MaxTurnsError, ToolNotFoundError } from './errors.js'

export const defaultSystemPrompt = `
    You are an autonomous tool-using agent.
    Rules:
    - You MUST use tools when needed.
    - You MUST NOT hallucinate external data.
    - Always prefer web_search + web_fetch for unknown facts.
    - Always reason step-by-step internally.
    - Avoid repeating the same tool call with same parameters.
    - Stop when task is solved.

    When you use tools, assume they are the only source of truth.
`

const noop = () => {}

/**
 * Resolve the `mcp` option into a list of remote tools.
 * Accepts: an McpClientManager (has `loadTools()`), an async function returning
 * a tool list, an already-resolved tool array, or a falsy value (no MCP).
 */
async function resolveMcpTools(mcp) {
    if (!mcp) return []
    if (Array.isArray(mcp)) return mcp
    if (typeof mcp === 'function') return await mcp()
    if (typeof mcp.loadTools === 'function') return await mcp.loadTools()
    if (typeof mcp.getTools === 'function') return await mcp.getTools()
    throw new TypeError('`mcp` must be an McpClientManager, an async () => tools, a tools array, or falsy')
}

/**
 * Create a configured agent. Configure the Ollama client, model and tools once,
 * then call `.run(prompt)` as many times as you like.
 *
 * @param {object} [config]
 * @param {string}   [config.host='http://localhost:11434'] Ollama host (ignored if `client` is given).
 * @param {string}   [config.apiKey] Ollama API key (ignored if `client` is given).
 * @param {Function} [config.fetch] Custom fetch, injected instead of patching globalThis.
 * @param {import('ollama').Ollama} [config.client] A pre-built Ollama client (overrides host/apiKey/fetch).
 * @param {string}   [config.model='qwen3'] Any Ollama model with tool-calling support.
 * @param {string}   [config.think] Ollama thinking effort (e.g. 'low'|'medium'|'high'). Omitted from
 *   the request when unset, so non-thinking models work out of the box.
 * @param {number}   [config.temperature=0.8] Sampling temperature.
 * @param {string}   [config.systemPrompt] System prompt for the agent.
 * @param {number}   [config.maxTurns=10] Safety cap on loop iterations.
 * @param {import('./registry.js').Tool[]} [config.tools] Local tools available to the agent.
 * @param {*}        [config.mcp] McpClientManager | async () => tools | tools[] | falsy.
 * @param {(e:{turn:number,message:object,messages:object[]}) => void} [config.onTurn] Called after each model turn.
 * @param {(e:{name:string,arguments:any,result:any,error:Error|null,turn:number}) => void} [config.onToolCall] Called after each tool execution.
 * @param {(e:{content:string,turns:number,messages:object[]}) => void} [config.onFinal] Called with the final answer.
 */
export function createAgent({
    host = 'http://localhost:11434',
    apiKey,
    fetch,
    client,
    model = 'qwen3',
    think,
    temperature = 0.8,
    systemPrompt = defaultSystemPrompt,
    maxTurns = 10,
    tools = [],
    mcp = null,
    onTurn = noop,
    onToolCall = noop,
    onFinal = noop,
} = {}) {
    const ollama = client ?? createOllamaClient({ host, apiKey, fetch })

    /** Merge local tools with MCP tools (local names win on collision) and validate. */
    async function resolveTools() {
        const seen = new Set(tools.map(t => t?.name))
        const merged = [...tools]
        for (const tool of await resolveMcpTools(mcp)) {
            if (seen.has(tool.name)) continue
            seen.add(tool.name)
            merged.push(tool)
        }
        validateTools(merged)
        return merged
    }

    /**
     * Run the agent loop against a prompt.
     * @param {string} prompt
     * @param {object} [opts]
     * @param {string} [opts.model] Per-run model override.
     * @param {import('./registry.js').Tool[]} [opts.tools] Explicit tool list, skips resolution.
     * @returns {Promise<string>} the model's final answer
     */
    async function run(prompt, { model: runModel = model, tools: runTools } = {}) {
        const activeTools = runTools ?? await resolveTools()
        const ollamaTools = activeTools.map(toOllamaTool)
        const handlers = toHandlerMap(activeTools)

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
        ]

        for (let turn = 0; turn < maxTurns; turn++) {
            const request = {
                model: runModel,
                options: { temperature },
                tools: ollamaTools,
                messages,
            }
            if (think !== undefined) request.think = think

            const response = await ollama.chat(request)

            const { message } = response
            onTurn({ turn, message, messages })

            if (!message.tool_calls || message.tool_calls.length === 0) {
                onFinal({ content: message.content, turns: turn + 1, messages })
                return message.content
            }

            messages.push(message)

            const toolResults = await Promise.all(message.tool_calls.map(async (toolCall) => {
                const name = toolCall.function.name
                const args = toolCall.function.arguments
                const fn = handlers[name]

                let result
                let error = null

                if (!fn) {
                    error = new ToolNotFoundError(name)
                    result = error.message
                }
                else {
                    try {
                        result = await fn(args)
                    }
                    catch (err) {
                        error = err
                        result = `Error while executing the tool: ${err.message}`
                    }
                }

                onToolCall({ name, arguments: args, result, error, turn })

                return {
                    role: 'tool',
                    content: typeof result === 'string' ? result : JSON.stringify(result),
                    tool_name: name,
                }
            }))

            messages.push(...toolResults)
        }

        throw new MaxTurnsError(maxTurns)
    }

    return { run, resolveTools, ollama }
}

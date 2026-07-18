import { createOllamaClient } from './ollama.js'
import { toOllamaTool, toHandlerMap, validateTools } from './registry.js'
import { resolveConversationImages } from './images.js'
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
 * @param {string}   [config.model='gemma4:latest'] Any Ollama model with tool-calling support.
 * @param {string}   [config.think] Ollama thinking effort (e.g. 'low'|'medium'|'high'). Omitted from
 *   the request when unset, so non-thinking models work out of the box.
 * @param {number}   [config.temperature=0.8] Sampling temperature.
 * @param {string}   [config.systemPrompt] System prompt for the agent.
 * @param {number}   [config.maxTurns=10] Safety cap on loop iterations.
 * @param {string}   [config.workdir] Working folder for the built-in filesystem/shell tools:
 *   relative paths resolve against it, the shell starts there, and file access is restricted
 *   to it unless `fullAccess` is true.
 * @param {boolean}  [config.fullAccess=false] Lift the `workdir` restriction and give the
 *   tools access to the whole machine (`workdir` stays the default base path).
 * @param {Array<import('./registry.js').Tool | ((ctx:{client:import('ollama').Ollama,apiKey?:string,host:string}) => import('./registry.js').Tool)>} [config.tools]
 *   Local tools available to the agent. An entry can also be a factory function: it is called once
 *   with the agent context (`client`, `apiKey`, `host`), so tools like `webSearchTool` / `webFetchTool`
 *   can be passed bare and reuse the agent's client/API key instead of configuring their own.
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
    model = 'gemma4:latest',
    think,
    temperature = 0.8,
    systemPrompt = defaultSystemPrompt,
    maxTurns = 10,
    workdir,
    fullAccess = false,
    tools = [],
    mcp = null,
    onTurn = noop,
    onToolCall = noop,
    onFinal = noop,
} = {}) {
    const ollama = client ?? createOllamaClient({ host, apiKey, fetch })

    /** A function entry in a tools list is a factory: call it with the agent context. */
    const toolContext = { client: ollama, apiKey, host, workdir, fullAccess }
    const materializeTools = list => list.map(t => (typeof t === 'function' ? t(toolContext) : t))
    const localTools = materializeTools(tools)

    /** Merge local tools with MCP tools (local names win on collision) and validate. */
    async function resolveTools() {
        const seen = new Set(localTools.map(t => t?.name))
        const merged = [...localTools]
        for (const tool of await resolveMcpTools(mcp)) {
            if (seen.has(tool.name)) continue
            seen.add(tool.name)
            merged.push(tool)
        }
        validateTools(merged)
        return merged
    }

    /**
     * Normalize a caller-owned messages array into a valid conversation, in place:
     * string entries become user messages and the system prompt is inserted once
     * at the top. The same array keeps accumulating messages across runs, which is
     * what makes the conversation persistent.
     */
    function normalizeConversation(history) {
        for (let i = 0; i < history.length; i++) {
            if (typeof history[i] === 'string') history[i] = { role: 'user', content: history[i] }
        }
        if (!history.some(m => m?.role === 'system')) {
            history.unshift({ role: 'system', content: systemPrompt })
        }
        return history
    }

    /**
     * Run the agent loop.
     *
     * A string input is a single task: a fresh conversation is created for it.
     * A messages array (or a string plus `opts.messages`) is a persistent
     * conversation: the array is used as the history and every new message —
     * user, assistant, tool results, final answer — is pushed into it, so passing
     * the same array across runs continues the same conversation.
     *
     * @param {string | Array<object|string>} input A single-task prompt, or the conversation array.
     * @param {object} [opts]
     * @param {string} [opts.model] Per-run model override.
     * @param {import('./registry.js').Tool[]} [opts.tools] Explicit tool list, skips resolution.
     * @param {Array<object|string>} [opts.messages] Persistent conversation array the string `input` is pushed into.
     * @param {Array<string | Uint8Array>} [opts.images] Images attached to the prompt for multimodal
     *   (vision) models. Each entry can be a file path, an http(s) URL, a `data:` URI, a base64
     *   string, a Buffer or a Uint8Array — everything is normalized to base64. Ignored when `input`
     *   is a messages array: put `images` on the user messages directly in that case.
     * @returns {Promise<string>} the model's final answer
     */
    async function run(input, { model: runModel = model, tools: runTools, messages: history, images } = {}) {
        const activeTools = runTools ? materializeTools(runTools) : await resolveTools()
        const ollamaTools = activeTools.map(toOllamaTool)
        const handlers = toHandlerMap(activeTools)

        const userMessage = content => (images?.length ? { role: 'user', content, images } : { role: 'user', content })

        let messages
        if (Array.isArray(input)) {
            messages = normalizeConversation(input)
        }
        else if (Array.isArray(history)) {
            messages = normalizeConversation(history)
            messages.push(userMessage(input))
        }
        else {
            messages = [
                { role: 'system', content: systemPrompt },
                userMessage(input),
            ]
        }

        await resolveConversationImages(messages)

        for (let turn = 0; turn < maxTurns; turn++) {
            const request = {
                model: runModel,
                options: { temperature },
                messages,
            }
            // Omitted when empty: Ollama rejects a request carrying tools if the
            // model doesn't support them, and many vision models don't.
            if (ollamaTools.length > 0) request.tools = ollamaTools
            if (think !== undefined) request.think = think

            const response = await ollama.chat(request)

            const { message } = response
            onTurn({ turn, message, messages })

            if (!message.tool_calls || message.tool_calls.length === 0) {
                messages.push(message)
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

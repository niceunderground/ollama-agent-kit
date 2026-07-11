# ollama-agent-kit

[![npm version](https://img.shields.io/npm/v/ollama-agent-kit)](https://www.npmjs.com/package/ollama-agent-kit)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**ollama-agent-kit** is a minimal Node.js library for building autonomous, tool-calling AI agents on local LLMs with [Ollama](https://ollama.com). It provides an agent loop with function calling and a unified tool registry that merges **local tools** (defined with [Zod](https://zod.dev) schemas) and **MCP tools** (loaded from external [Model Context Protocol](https://modelcontextprotocol.io) servers).

> **Define a tool once — your agent uses it, and your MCP server exposes it.** The registry works in both directions.

The core is intentionally small: a chat loop that sends the conversation to Ollama, executes any requested tool calls **in parallel**, feeds the results back, and stops when the model produces a final answer (or `maxTurns` is reached).

```
createAgent(config).run(prompt)
   │
   ├── resolves tools: your local registry + MCP servers
   │
   └── loop (up to maxTurns):
         ├── ollama.chat() with the merged tool list
         ├── no tool calls? → return the final answer
         └── run all tool calls in parallel → feed results back → next turn
```

## Install

```bash
npm install ollama-agent-kit
# MCP support is optional — install the SDK only if you connect to MCP servers:
npm install @modelcontextprotocol/sdk
```

Requires **Node.js 18+** and a reachable Ollama instance with a tool-calling model. `web_search` / `web_fetch` need an `OLLAMA_API_KEY` (Ollama Cloud).

## Quick start — four lines

```js
import { createAgent, webSearchTool } from 'ollama-agent-kit'

const agent = createAgent({ apiKey: process.env.OLLAMA_API_KEY, tools: [webSearchTool] })
const answer = await agent.run('Summarize the latest new media art news')
console.log(answer)
```

## Defining a tool

One object, a Zod schema, a handler. `exposeAgent` / `exposeMcp` decide where it shows up — the **same definition** serves both the agent loop and your MCP server.

```js
import { defineTool } from 'ollama-agent-kit'
import { z } from 'zod'

export const bulb = defineTool({
    name: 'bulb',
    description: 'Control a smart light: turn it on/off and set brightness.',
    parameters: z.object({
        room: z.string().describe('Room name, e.g. "studio"'),
        on: z.boolean().optional(),
        brightness: z.number().min(0).max(100).optional(),
    }),
    exposeAgent: true,   // available to the agent loop
    exposeMcp: true,     // and publishable by your own MCP server
    handler: async ({ room, on, brightness }) => setLight(room, { on, brightness }),
})
```

- `parameters` (Zod) is converted to JSON Schema automatically for the Ollama API.
- Tools are validated up front (name present, handler is a function, no duplicates) so a malformed tool fails immediately instead of mid-conversation.
- MCP tools arrive already carrying JSON Schema (`rawParameters`), so both kinds live in one registry.

See [`examples/home-lights.js`](https://github.com/niceunderground/ollama-agent-kit/blob/main/examples/home-lights.js) for the full home-automation demo — the kind of thing that runs happily on a Raspberry Pi.

## Built-in tools

A handful of tool factories ship with the kit. Pass them bare in `tools` (they reuse the agent's client) or call them with options:

| Tool                  | Purpose                                      | Notes |
| --------------------- | --------------------------------------------- | ----- |
| `webSearchTool`       | Web search via the Ollama web API             | Needs `OLLAMA_API_KEY` |
| `webFetchTool`        | Fetch the content of a URL                    | Needs `OLLAMA_API_KEY` |
| `readFileTool`        | Read a file's full text content               | Local filesystem |
| `writeFileTool`       | Create/overwrite a file                       | Local filesystem |
| `editFileTool`        | Replace an exact string occurrence in a file  | Local filesystem |
| `listDirectoryTool`   | List a directory's entries                    | Local filesystem |
| `runShellCommandTool` | Execute a shell command, returns stdout/stderr | Local shell. Runs arbitrary commands — only use with trusted models/prompts |

## Configuring the agent

`createAgent` injects the Ollama client, model and tools; `.run()` executes a prompt.

```js
const agent = createAgent({
    host: 'http://localhost:11434',   // optional (this is the default) — or a pre-built `client`
    apiKey: process.env.OLLAMA_API_KEY, // one key for cloud models + web tools
    model: 'qwen3',
    tools: [bulb, webSearchTool],     // bare tool factories reuse the agent's client/apiKey
    onTurn:     ({ turn }) => console.log(`turn ${turn}`),
    onToolCall: ({ name, result }) => console.log(`→ ${name}`, result),
})

await agent.run('Turn on the studio light and tell me the weather in Naples')
```

### `createAgent(config)` options

| Option         | Default                | Description                                                        |
| -------------- | ---------------------- | ------------------------------------------------------------------ |
| `host`         | `http://localhost:11434` | Ollama host (ignored if `client` is given)                       |
| `apiKey`       | –                      | Ollama API key (ignored if `client` is given)                      |
| `fetch`        | –                      | Custom fetch, injected instead of patching `globalThis`            |
| `client`       | –                      | A pre-built Ollama client (overrides `host`/`apiKey`/`fetch`)      |
| `model`        | `qwen3`                | Any Ollama model with tool-calling support                         |
| `think`        | unset                  | Ollama thinking effort (`'low'`\|`'medium'`\|`'high'`). Only sent when set, so non-thinking models work out of the box |
| `temperature`  | `0.8`                  | Sampling temperature                                               |
| `systemPrompt` | built-in               | System prompt for the agent                                        |
| `maxTurns`     | `10`                   | Safety cap on loop iterations (throws `MaxTurnsError` if exceeded) |
| `tools`        | `[]`                   | Local tools available to the agent. An entry can also be a factory `(ctx) => Tool` called with `{ client, apiKey, host }` — so `webSearchTool` / `webFetchTool` can be passed bare and reuse the agent's client |
| `mcp`          | `null`                 | `McpClientManager` \| `async () => tools` \| `tools[]` \| falsy    |
| `onTurn`       | no-op                  | `({ turn, message, messages }) => void` after each model turn      |
| `onToolCall`   | no-op                  | `({ name, arguments, result, error, turn }) => void` per tool call |
| `onFinal`      | no-op                  | `({ content, turns, messages }) => void` on the final answer       |

`run(prompt, { model, tools })` accepts per-run overrides and returns the model's final answer.

## Connecting to MCP servers

External MCP servers (stdio or HTTP) are connected by `McpClientManager`. Their tools are loaded at run time, prefixed with the server name (`filesystem__read_file`), and merged into the same registry — local names win on collision.

```js
import { createAgent, McpClientManager } from 'ollama-agent-kit'

const mcp = new McpClientManager({
    servers: {
        filesystem: {
            enabled: true,
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        },
    },
})

const agent = createAgent({ mcp })
const answer = await agent.run('List the files in the current directory')
await mcp.close()
```

HTTP servers behind OAuth are supported via `FileOAuthProvider` (tokens persisted per-server under `.mcp-auth/`). Log in once with [`examples/mcp-auth.js`](https://github.com/niceunderground/ollama-agent-kit/blob/main/examples/mcp-auth.js). You can also load a `{ servers: {...} }` JSON file with `loadMcpConfigFile(path)`.

## Serving your tools as an MCP server

The reciprocal of `createAgent`: hand the **same** tool definitions to an MCP server and every tool flagged `exposeMcp: true` becomes callable by any MCP client (Claude Desktop, another agent, ...). The Zod schema is converted to JSON Schema for you.

```js
import { createMcpServer, serveMcpStdio, serveMcpHttp } from 'ollama-agent-kit'

// Just build the configured server (register onto any transport yourself):
const server = await createMcpServer([bulb, add])   // only exposeMcp tools are registered

// Or serve it directly, one line:
await serveMcpStdio([bulb, add])                     // local process, spawned over stdio
await serveMcpHttp([bulb, add], { port: 3000 })      // online at http://localhost:3000/mcp
```

See [`examples/serve-mcp.js`](https://github.com/niceunderground/ollama-agent-kit/blob/main/examples/serve-mcp.js) for the full, runnable server.

## Exposing the MCP server over HTTP

An MCP server speaks over one of two **transports**:

- **stdio** — the server is a local process the client spawns; it talks over stdin/stdout. No network, no auth. Ideal on a Raspberry Pi next to your hardware. Use `serveMcpStdio(tools)`.
- **Streamable HTTP** — the server exposes an HTTP endpoint (`https://your-host/mcp`) any client can reach. This is what "online" means. Use `serveMcpHttp(tools, { port })`.

`serveMcpHttp` starts a plain Node HTTP server (no Express dependency) in **stateless** mode — a fresh MCP server is created per request, which suits low-traffic home deployments. To actually expose it:

1. **Run it** on a machine with a public address (VPS, Raspberry Pi, ...), or a tunnel like Cloudflare Tunnel / ngrok for quick tests.
2. **Add HTTPS** with a reverse proxy (Caddy, Nginx) in front of the port.
3. **Protect it.** An open endpoint lets anyone with the URL run your tools. The simplest guard is a shared bearer token — pass `authToken` and clients must send `Authorization: Bearer <token>`. For full OAuth, use the SDK's auth middleware.

```js
await serveMcpHttp([bulb], {
    port: 3000,
    authToken: process.env.MCP_TOKEN,   // require Authorization: Bearer <token>
})
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `port` | `3000` | Listen port |
| `host` | all interfaces | Bind address |
| `path` | `/mcp` | Endpoint path |
| `authToken` | – | If set, require `Authorization: Bearer <token>` |
| `enableJsonResponse` | `false` | Return plain JSON instead of an SSE stream |
| `name` / `version` | kit defaults | Advertised MCP server identity |
| `includeAll` | `false` | Register every tool, ignoring `exposeMcp` |

## API

```js
import {
    createAgent, createOllamaClient,
    createRegistry, defineTool, validateTools, toOllamaTool, toHandlerMap,
    webSearchTool, webFetchTool,
    readFileTool, writeFileTool, editFileTool, listDirectoryTool, runShellCommandTool,
    McpClientManager, createMcpTools, loadMcpConfigFile, FileOAuthProvider,
    createMcpServer, serveMcpStdio, serveMcpHttp,
    AgentError, MaxTurnsError, ToolNotFoundError, RegistryError,
} from 'ollama-agent-kit'
```

## FAQ

**Which Ollama models support tool calling?**
Any model tagged with tool support in the [Ollama library](https://ollama.com/search?c=tools) — `qwen3` (the default), `llama3.1`, `mistral`, and others. Note that Ollama rejects a chat request that carries tools if the model doesn't support them, so pick a tool-capable model when the agent has tools configured.

**Does it work fully offline?**
Yes. The agent loop, local tools and stdio MCP servers need no network beyond your Ollama instance. Only `web_search` / `web_fetch` and cloud models require an `OLLAMA_API_KEY`.

**Can the same tool be used by the agent and published over MCP?**
Yes — that's the point of the registry. One `defineTool` definition with `exposeAgent: true` and `exposeMcp: true` serves both directions; the Zod schema is converted to JSON Schema wherever it's needed.

**How does this compare to LangChain or the Vercel AI SDK?**
Much smaller scope, on purpose: two runtime dependencies (`ollama`, `zod`), one loop, no prompt/chain abstractions, Ollama only. If you need multi-provider support, streaming UI helpers or RAG pipelines, use those frameworks. If you want a small, readable agent loop for local models that also speaks MCP in both directions, this is it.

**Is it written in TypeScript?**
No — plain ESM JavaScript, no bundled type definitions. Zod gives you runtime validation of tool arguments; editors still infer a fair amount from the JSDoc and Zod schemas.

**Where does MCP fit if I'm new to it?**
[MCP](https://modelcontextprotocol.io) is a standard protocol for exposing tools to AI clients. This kit is both a **client** (your agent can call tools from any MCP server) and a **server** (your tools become callable by Claude Desktop or any other MCP client).

## Tests

```bash
npm test        # node --test
```

## License

[MIT](LICENSE) © niceunderground

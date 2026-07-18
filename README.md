# ollama-agent-kit

Give a local LLM hands. A minimal Node.js agent loop for [Ollama](https://ollama.com) that lets the model read, write and edit files, run shell commands, and call tools from any [MCP](https://modelcontextprotocol.io) server — entirely on your machine.

[![npm version](https://img.shields.io/npm/v/ollama-agent-kit)](https://www.npmjs.com/package/ollama-agent-kit)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**[→ npm](https://www.npmjs.com/package/ollama-agent-kit)** · **[→ Examples](https://github.com/niceunderground/ollama-agent-kit/tree/main/examples)**

---

## Table of contents

- [Why an agent on a local model](#why-an-agent-on-a-local-model)
- [How it works](#how-it-works)
- [Install](#install)
- [Built-in tools](#built-in-tools)
- [Defining a tool](#defining-a-tool)
- [One registry, two directions](#one-registry-two-directions)
- [Configuring the agent](#configuring-the-agent)
- [Persistent conversations](#persistent-conversations)
- [Images and multimodal models](#images-and-multimodal-models)
- [Working folder and full access](#working-folder-and-full-access)
- [Connecting to MCP servers](#connecting-to-mcp-servers)
- [Serving your tools as an MCP server](#serving-your-tools-as-an-mcp-server)
- [API](#api)
- [FAQ](#faq)
- [Tests](#tests)
- [License](#license)

## Why an agent on a local model

An agent is only useful when it can *act*: modify files, run commands, touch the system it lives on. Nobody in their right mind hands that power to a cloud API. With a model running on your own hardware the equation changes: prompts, file contents and command output never leave your machine, inference costs nothing after setup, and everything keeps working offline.

ollama-agent-kit is built for exactly that scenario. Two runtime dependencies (`ollama`, `zod`), no chains, no prompt abstractions, no framework tax — small enough to run comfortably next to the model on a Raspberry Pi or a home server, readable enough to audit in an afternoon.

```js
import { createAgent, readFileTool, writeFileTool, editFileTool, runShellCommandTool } from 'ollama-agent-kit'

const agent = createAgent({
    model: 'gemma4:latest',
    tools: [readFileTool, writeFileTool, editFileTool, runShellCommandTool],
})
await agent.run('Read package.json, bump the patch version, and run the tests')
```

That's a fully autonomous loop on a local model: it reads the file, edits it, runs the command, checks the output — no API key, no network, no data leaving the LAN.

<!-- TODO: terminal demo GIF here — record the loop above with `vhs` or asciinema+agg and embed it: ![ollama-agent-kit demo](docs/demo.gif) -->

> ⚠️ `runShellCommandTool` executes arbitrary commands with your process's permissions. Only enable it for models and prompts you trust — see [A note on trust](#a-note-on-trust).

## How it works

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

Requires **Node.js 18+** and a reachable Ollama instance with a tool-calling model. `webSearchTool` / `webFetchTool` need an `OLLAMA_API_KEY` (Ollama Cloud).

## Built-in tools

A handful of tool factories ship with the kit. Pass them bare in `tools` (they reuse the agent's client) or call them with options. They split into two groups: tools that **act on your machine** and tools that **fetch information**.

**Act on your machine**

| Tool                  | Purpose                                        | Notes |
| --------------------- | ---------------------------------------------- | ----- |
| `writeFileTool`       | Create/overwrite a file                        | Writes to the local filesystem |
| `editFileTool`        | Replace an exact string occurrence in a file (all occurrences with `replaceAll`) | Modifies files in place |
| `runShellCommandTool` | Execute a shell command, returns stdout/stderr | **Runs arbitrary commands with your process's permissions — only enable it for models and prompts you trust.** |

**Fetch information**

| Tool                  | Purpose                            | Notes |
| --------------------- | ---------------------------------- | ----- |
| `readFileTool`        | Read a file's full text content    | Local filesystem |
| `listDirectoryTool`   | List a directory's entries         | Local filesystem |
| `webSearchTool`       | Web search via the Ollama web API  | Needs `OLLAMA_API_KEY` |
| `webFetchTool`        | Fetch the content of a URL         | Needs `OLLAMA_API_KEY` |

### A note on trust

The "act" tools give an autonomous loop real power over your machine: it can overwrite files and run shell commands without asking. That's the point — but scope what you pass in. Set a [`workdir`](#working-folder-and-full-access) to sandbox the filesystem tools to one folder; on untrusted input, prefer the read-only tools, run the agent in a sandbox/container, or drop `runShellCommandTool`. The advantage of a local model is that the blast radius is a machine you own, not an account on someone else's cloud.

## Defining a tool

One object, a Zod schema, a handler. Anything on your system with an API — a light, a script, a device — becomes something the model can operate.

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

See [`examples/home-lights.js`](https://github.com/niceunderground/ollama-agent-kit/blob/main/examples/home-lights.js) for the full home-automation demo — an agent controlling real lights from a local model, the kind of thing that runs happily on a Raspberry Pi.

## One registry, two directions

The registry is what makes the tool definition above reusable: **define a tool once — your agent uses it, and your MCP server exposes it.** `exposeAgent` / `exposeMcp` decide where it shows up; the same definition serves both the agent loop and your own MCP server, and external MCP tools land in the same registry next to your local ones.

## Configuring the agent

`createAgent` injects the Ollama client, model and tools; `.run()` executes a prompt.

```js
const agent = createAgent({
    host: 'http://localhost:11434',   // optional (this is the default) — or a pre-built `client`
    apiKey: process.env.OLLAMA_API_KEY, // one key for cloud models + web tools
    model: 'gemma4:latest',
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
| `model`        | `gemma4:latest`        | Any Ollama model with tool-calling support                         |
| `think`        | unset                  | Ollama thinking effort (`'low'`\|`'medium'`\|`'high'`). Only sent when set, so non-thinking models work out of the box |
| `temperature`  | `0.8`                  | Sampling temperature                                               |
| `systemPrompt` | built-in               | System prompt for the agent                                        |
| `maxTurns`     | `10`                   | Safety cap on loop iterations (throws `MaxTurnsError` if exceeded) |
| `workdir`      | –                      | Working folder for the built-in filesystem/shell tools: relative paths resolve against it, the shell starts there, and file access is **restricted to it** unless `fullAccess` is true |
| `fullAccess`   | `false`                | Lift the `workdir` restriction: the tools can reach the whole machine, `workdir` stays the default base path |
| `tools`        | `[]`                   | Local tools available to the agent. An entry can also be a factory `(ctx) => Tool` called with `{ client, apiKey, host }` — so `webSearchTool` / `webFetchTool` can be passed bare and reuse the agent's client |
| `mcp`          | `null`                 | `McpClientManager` \| `async () => tools` \| `tools[]` \| falsy    |
| `onTurn`       | no-op                  | `({ turn, message, messages }) => void` after each model turn      |
| `onToolCall`   | no-op                  | `({ name, arguments, result, error, turn }) => void` per tool call |
| `onFinal`      | no-op                  | `({ content, turns, messages }) => void` on the final answer       |

`run(input, { model, tools, messages, images })` accepts per-run overrides and returns the model's final answer. `input` is a single-task prompt string, or a messages array for a [persistent conversation](#persistent-conversations). `images` attaches image inputs for [multimodal models](#images-and-multimodal-models).

## Persistent conversations

`run()` works in two modes:

- **Single task** — pass a string. A fresh conversation is created, the agent solves the task and the history is discarded. Every run starts from zero.
- **Persistent conversation** — pass a messages array (or a string plus a `messages` array). The array is used as the conversation history and every new message — user turns, assistant replies, tool results, the final answer — is **pushed into it**. Reuse the same array across runs and the agent remembers the whole conversation.

```js
const agent = createAgent({ model: 'gemma4:latest', tools: [readFileTool] })

// Single task: no memory between runs
await agent.run('Summarize package.json')

// Persistent conversation: pass the same array every time
const history = []
await agent.run('Read package.json and tell me the version', { messages: history })
await agent.run('Now bump it to the next minor', { messages: history })  // remembers the previous answer

// Equivalent: manage the array yourself and pass it as the input
history.push({ role: 'user', content: 'And what dependencies does it have?' })
await agent.run(history)
```

Notes:

- String entries in the array are normalized to `{ role: 'user', content }` messages.
- The system prompt is inserted once at the top if the array doesn't already contain a `system` message.
- The array is caller-owned: persist it to disk, trim it, or seed it with prior context as you like.

## Images and multimodal models

Vision models (e.g. `gemma3`, `llama3.2-vision`, `qwen2.5vl`, `llava`) accept images alongside the prompt. Pass them per run with `images`:

```js
const agent = createAgent({ model: 'gemma3:latest' })

// A file path, straight from disk
await agent.run('What is in this picture?', { images: ['./photo.png'] })

// Any mix of formats works — everything is normalized to base64 for the Ollama API
await agent.run('Compare these images', {
    images: [
        './local/screenshot.png',                 // file path
        'https://example.com/chart.jpg',          // http(s) URL (fetched for you)
        'data:image/png;base64,iVBORw0KGgo...',   // data: URI
        fs.readFileSync('raw.webp'),              // Buffer / Uint8Array
        'iVBORw0KGgoAAAANSUhEUg...',              // already-encoded base64
    ],
})
```

In a [persistent conversation](#persistent-conversations), `images` attaches to the user message being appended; in a messages array you manage yourself, put an `images` array on the user messages directly — it is normalized the same way:

```js
const history = []
await agent.run('Describe this photo', { messages: history, images: ['./photo.png'] })
await agent.run('Now write an alt text for it', { messages: history })  // remembers the image

// Equivalent, managing the array yourself:
await agent.run([{ role: 'user', content: 'Describe this photo', images: ['./photo.png'] }])
```

Notes:

- Relative file paths resolve against the process working directory (they are caller inputs, not model inputs, so `workdir` does not apply).
- Many vision models don't support tool calling, and Ollama rejects a request that carries tools the model can't use. The kit omits the `tools` field automatically when the agent has none, so a bare `createAgent({ model: 'llava' })` works out of the box; with tools configured, disable them for a vision run via the per-run override: `agent.run(prompt, { images, tools: [] })`.
- The normalization helpers are exported if you need them standalone: `resolveImage(input)` / `resolveImages(inputs)` return base64 strings.

## Working folder and full access

`workdir` scopes the built-in filesystem and shell tools to a folder. Relative paths resolve against it, `run_shell_command` starts there, and any path escaping the folder is rejected — the model gets an `Access denied` error instead. Set `fullAccess: true` to lift the restriction and let the agent reach the whole machine, with `workdir` remaining the default base path.

```js
import { createAgent, readFileTool, writeFileTool, editFileTool, listDirectoryTool, runShellCommandTool } from 'ollama-agent-kit'

// Sandboxed to a project folder (recommended)
const agent = createAgent({
    workdir: '/home/me/my-project',
    tools: [readFileTool, writeFileTool, editFileTool, listDirectoryTool, runShellCommandTool],
})

// Full access to the whole machine, workdir is just the starting point
const trusted = createAgent({
    workdir: '/home/me/my-project',
    fullAccess: true,
    tools: [readFileTool, writeFileTool, editFileTool, listDirectoryTool, runShellCommandTool],
})

// No workdir at all: historical behavior — full access, cwd as base path
const free = createAgent({ tools: [readFileTool, runShellCommandTool] })
```

The options flow through the agent's tool context, so bare factories pick them up automatically; calling a factory directly with its own options also works (`readFileTool({ workdir, fullAccess })`, `runShellCommandTool({ workdir, cwd })`).

> ⚠️ The sandbox applies to the **filesystem tools** (`read_file`, `write_file`, `edit_file`, `list_directory`). `run_shell_command` only *starts* in `workdir` — a shell command can still `cd` anywhere or use absolute paths. If containment matters, drop the shell tool or run the agent in a container.

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

### Exposing it over HTTP

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
    createAgent, createOllamaClient, defaultSystemPrompt,
    resolveImage, resolveImages,
    createRegistry, defineTool, validateTools, toOllamaTool, toHandlerMap,
    webSearchTool, webFetchTool,
    readFileTool, writeFileTool, editFileTool, listDirectoryTool, runShellCommandTool,
    McpClientManager, createMcpTools, loadMcpConfigFile, FileOAuthProvider, DEFAULT_CALLBACK_PORT,
    createMcpServer, serveMcpStdio, serveMcpHttp,
    AgentError, MaxTurnsError, ToolNotFoundError, RegistryError,
} from 'ollama-agent-kit'
```

## FAQ

**Why run an agent on a local model instead of a cloud API?**
Because of what the agent is allowed to do. Filesystem and shell access on a cloud-connected agent means your files and command output transit someone else's servers. On a local model everything stays on your hardware: full privacy, zero inference cost after setup, and it keeps working with no internet connection.

**Which Ollama models support tool calling?**
Any model tagged with tool support in the [Ollama library](https://ollama.com/search?c=tools) — `gemma4:latest` (the default), `llama3.1`, `mistral`, and others. Note that Ollama rejects a chat request that carries tools if the model doesn't support them, so pick a tool-capable model when the agent has tools configured.

**Does it work fully offline?**
Yes. The agent loop, local tools and stdio MCP servers need no network beyond your Ollama instance. Only `webSearchTool` / `webFetchTool` and cloud models require an `OLLAMA_API_KEY`.

**Can the same tool be used by the agent and published over MCP?**
Yes — that's the point of the registry. One `defineTool` definition with `exposeAgent: true` and `exposeMcp: true` serves both directions; the Zod schema is converted to JSON Schema wherever it's needed.

**How does this compare to LangChain or the Vercel AI SDK?**
Much smaller scope, on purpose: two runtime dependencies (`ollama`, `zod`), one loop, no prompt/chain abstractions, Ollama only. If you need multi-provider support, streaming UI helpers or RAG pipelines, use those frameworks. If you want a small, readable agent loop that gives a local model real capabilities — files, shell, MCP in both directions — this is it.

**Is it written in TypeScript?**
No — plain ESM JavaScript, no bundled type definitions. Zod gives you runtime validation of tool arguments; editors still infer a fair amount from the JSDoc and Zod schemas.

**Where does MCP fit if I'm new to it?**
[MCP](https://modelcontextprotocol.io) is a standard protocol for exposing tools to AI clients. This kit is both a **client** (your agent can call tools from any MCP server) and a **server** (your tools become callable by Claude Desktop or any other MCP client).

## Tests

```bash
npm test        # node --test
```

## License

[MIT](LICENSE) niceunderground
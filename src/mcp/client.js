import fs from 'node:fs'

import { FileOAuthProvider } from './auth.js'

// Separator between server name and tool name: avoids collisions across servers.
const SEP = '__'

const noop = () => {}

/**
 * Dynamically import the MCP SDK. It is an optional dependency: only users who
 * actually connect to MCP servers need it installed.
 */
async function loadSdk() {
    try {
        const [{ Client }, { StdioClientTransport }, { StreamableHTTPClientTransport }] = await Promise.all([
            import('@modelcontextprotocol/sdk/client/index.js'),
            import('@modelcontextprotocol/sdk/client/stdio.js'),
            import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
        ])
        return { Client, StdioClientTransport, StreamableHTTPClientTransport }
    }
    catch {
        throw new Error('MCP support requires the optional peer dependency "@modelcontextprotocol/sdk". Install it with: npm i @modelcontextprotocol/sdk')
    }
}

/** Read a `{ servers: { ... } }` MCP config file and return the `servers` map. */
export function loadMcpConfigFile(configPath) {
    if (!fs.existsSync(configPath)) return {}
    const { servers = {} } = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return servers
}

/**
 * Connects to a set of MCP servers (stdio or HTTP) and exposes their tools in the
 * same shape as the local registry, so the agent treats local and remote tools alike.
 * Remote tool names are prefixed with `<serverName>__` to avoid collisions.
 */
export class McpClientManager {
    /**
     * @param {object} [opts]
     * @param {Record<string, object>} [opts.servers] Server config map (name -> { enabled, type, ... }).
     * @param {string} [opts.configPath] Path to a `{ servers: {...} }` JSON file (used if `servers` is omitted).
     * @param {string} [opts.clientName='ollama-agent-kit-mcp-client']
     * @param {string} [opts.clientVersion='1.0.0']
     * @param {object} [opts.auth] Options forwarded to FileOAuthProvider (authDir, callbackPort, clientName).
     * @param {(msg: string, ...args: any[]) => void} [opts.onLog] Log sink (default: silent).
     */
    constructor({
        servers,
        configPath,
        clientName = 'ollama-agent-kit-mcp-client',
        clientVersion = '1.0.0',
        auth = {},
        onLog = noop,
    } = {}) {
        this.servers = servers ?? (configPath ? loadMcpConfigFile(configPath) : {})
        this.clientName = clientName
        this.clientVersion = clientVersion
        this.auth = auth
        this.onLog = onLog
        this.clients = new Map()   // serverName -> Client
        this.connecting = null     // in-flight connectAll promise, avoids double connect
        this._sdk = null
    }

    async sdk() {
        if (!this._sdk) this._sdk = await loadSdk()
        return this._sdk
    }

    loadConfig() {
        return this.servers
    }

    async createTransport(name, cfg, onRedirect = null) {
        const { StdioClientTransport, StreamableHTTPClientTransport } = await this.sdk()
        if (cfg.type === 'stdio') {
            return new StdioClientTransport({
                command: cfg.command,
                args: cfg.args ?? [],
                env: { ...process.env, ...cfg.env },
            })
        }
        if (cfg.type === 'http') {
            return new StreamableHTTPClientTransport(new URL(cfg.url), {
                requestInit: { headers: cfg.headers ?? {} },
                // On 401 the OAuth flow starts: tokens saved by FileOAuthProvider,
                // interactive login done once (see examples/mcp-auth.js).
                authProvider: new FileOAuthProvider(name, { ...this.auth, onRedirect }),
            })
        }
        throw new Error(`Unknown MCP transport type: "${cfg.type}"`)
    }

    async newClient() {
        const { Client } = await this.sdk()
        return new Client({ name: this.clientName, version: this.clientVersion })
    }

    async connect(name, cfg) {
        if (this.clients.has(name)) return this.clients.get(name)

        const client = await this.newClient()
        await client.connect(await this.createTransport(name, cfg))

        this.clients.set(name, client)
        this.onLog(`MCP client connected to "${name}"`)
        return client
    }

    /** Connect all enabled servers; one failing server does not block the others. */
    async connectAll() {
        if (this.connecting) return this.connecting

        this.connecting = (async () => {
            const servers = this.loadConfig()
            await Promise.all(Object.entries(servers).map(async ([name, cfg]) => {
                if (cfg.enabled === false) return
                try {
                    await this.connect(name, cfg)
                }
                catch (err) {
                    this.onLog(`MCP client: connection to "${name}" failed:`, err.message)
                }
            }))
        })()

        return this.connecting
    }

    /** Return every connected server's tools in the local registry shape. */
    async getTools() {
        const tools = []

        for (const [serverName, client] of this.clients) {
            try {
                const { tools: remoteTools } = await client.listTools()

                for (const t of remoteTools) {
                    tools.push({
                        name: `${serverName}${SEP}${t.name}`,
                        description: t.description ?? '',
                        rawParameters: t.inputSchema,   // already JSON Schema, no zod
                        exposeAgent: true,
                        exposeMcp: false,               // never re-expose remote tools on your own MCP server
                        server: serverName,
                        handler: (args) => this.callTool(serverName, t.name, args),
                    })
                }
            }
            catch (err) {
                this.onLog(`MCP client: listTools on "${serverName}" failed:`, err.message)
            }
        }

        return tools
    }

    /** Connect (once) and return remote tools — the shape `createAgent({ mcp })` expects. */
    async loadTools() {
        await this.connectAll()
        return this.getTools()
    }

    async callTool(serverName, toolName, args) {
        const client = this.clients.get(serverName)
        if (!client) throw new Error(`MCP server "${serverName}" not connected`)

        const result = await client.callTool({ name: toolName, arguments: args ?? {} })

        const text = (result.content ?? [])
            .map(c => c.type === 'text' ? c.text : JSON.stringify(c))
            .join('\n')

        if (result.isError) throw new Error(text || `Error from MCP tool "${toolName}"`)
        return text
    }

    async close() {
        await Promise.all([...this.clients.values()].map(c => c.close().catch(() => {})))
        this.clients.clear()
        this.connecting = null
    }
}

/**
 * Convenience: build a manager and return its remote tools in one call.
 * @param {ConstructorParameters<typeof McpClientManager>[0]} [opts]
 */
export async function createMcpTools(opts) {
    const manager = new McpClientManager(opts)
    return manager.loadTools()
}

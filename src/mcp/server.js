import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const noop = () => {}

/** Constant-time string comparison, so the bearer token can't be guessed byte-by-byte via timing. */
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a))
    const bufB = Buffer.from(String(b))
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/**
 * Dynamically import the MCP SDK server pieces. Optional dependency: only users
 * who actually publish an MCP server need it installed.
 */
async function loadServerSdk() {
    try {
        const [{ McpServer }, { StdioServerTransport }, { StreamableHTTPServerTransport }] = await Promise.all([
            import('@modelcontextprotocol/sdk/server/mcp.js'),
            import('@modelcontextprotocol/sdk/server/stdio.js'),
            import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
        ])
        return { McpServer, StdioServerTransport, StreamableHTTPServerTransport }
    }
    catch {
        throw new Error('MCP server support requires the optional peer dependency "@modelcontextprotocol/sdk". Install it with: npm i @modelcontextprotocol/sdk')
    }
}

/**
 * Build an `McpServer` and register the tools flagged `exposeMcp: true` (the
 * reciprocal of `createAgent`: the same tool definition your agent calls is now
 * published for other MCP clients). A fresh server is returned on each call.
 *
 * @param {import('../registry.js').Tool[]} tools
 * @param {object} [opts]
 * @param {string} [opts.name='ollama-agent-kit-mcp']
 * @param {string} [opts.version='1.0.0']
 * @param {boolean} [opts.includeAll=false] Register every tool, ignoring the `exposeMcp` flag.
 * @returns {Promise<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>}
 */
export async function createMcpServer(tools, {
    name = 'ollama-agent-kit-mcp',
    version = '1.0.0',
    includeAll = false,
} = {}) {
    const { McpServer } = await loadServerSdk()
    const server = new McpServer({ name, version })

    const toExpose = includeAll ? tools : tools.filter(t => t.exposeMcp)
    for (const tool of toExpose) {
        server.registerTool(
            tool.name,
            {
                description: tool.description,
                // Local tools carry a zod schema; `.shape` is the raw shape the SDK expects.
                inputSchema: tool.parameters ? tool.parameters.shape : {},
            },
            async (args) => {
                const result = await tool.handler(args)
                return {
                    content: [{
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result),
                    }],
                }
            },
        )
    }

    return server
}

/**
 * Serve your tools over **stdio** — the server runs as a local process a client
 * spawns (e.g. `command: 'node', args: ['serve.js']`). No network, no auth.
 *
 * @param {import('../registry.js').Tool[]} tools
 * @param {Parameters<typeof createMcpServer>[1]} [opts]
 * @returns {Promise<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>}
 */
export async function serveMcpStdio(tools, opts = {}) {
    const { StdioServerTransport } = await loadServerSdk()
    const server = await createMcpServer(tools, opts)
    await server.connect(new StdioServerTransport())
    return server
}

function readJsonBody(req, maxBytes = 4 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let data = ''
        req.on('data', (chunk) => {
            data += chunk
            if (data.length > maxBytes) reject(new Error('Request body too large'))
        })
        req.on('end', () => {
            if (!data) return resolve(undefined)
            try { resolve(JSON.parse(data)) }
            catch (err) { reject(err) }
        })
        req.on('error', reject)
    })
}

/**
 * Serve your tools **online** over Streamable HTTP. Starts a plain Node HTTP
 * server (no Express dependency) in stateless mode: a fresh MCP server +
 * transport is created per request, which avoids cross-request id collisions and
 * is a good fit for low-traffic home/Raspberry Pi deployments.
 *
 * For a public endpoint, put this behind a reverse proxy with HTTPS and protect
 * it — the simplest guard is a shared bearer token (`authToken`); for real OAuth
 * use the SDK's auth middleware.
 *
 * @param {import('../registry.js').Tool[]} tools
 * @param {object} [opts]
 * @param {number} [opts.port=3000]
 * @param {string} [opts.host] Bind address (default: all interfaces).
 * @param {string} [opts.path='/mcp'] Endpoint path.
 * @param {string} [opts.authToken] If set, require `Authorization: Bearer <token>`.
 * @param {boolean} [opts.enableJsonResponse=false] Return plain JSON instead of an SSE stream.
 * @param {string} [opts.name] MCP server name (forwarded to createMcpServer).
 * @param {string} [opts.version] MCP server version (forwarded to createMcpServer).
 * @param {boolean} [opts.includeAll] Ignore the `exposeMcp` flag (forwarded).
 * @param {(msg: string, ...args: any[]) => void} [opts.onLog]
 * @returns {Promise<import('node:http').Server>}
 */
export async function serveMcpHttp(tools, {
    port = 3000,
    host,
    path: mcpPath = '/mcp',
    authToken,
    enableJsonResponse = false,
    onLog = noop,
    name,
    version,
    includeAll,
} = {}) {
    const { StreamableHTTPServerTransport } = await loadServerSdk()
    const serverOpts = { name, version, includeAll }

    const httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)

        if (url.pathname !== mcpPath) {
            res.writeHead(404).end('Not found')
            return
        }

        if (authToken && !safeEqual(req.headers.authorization ?? '', `Bearer ${authToken}`)) {
            res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized')
            return
        }

        // Stateless: no session, so no GET (server-push SSE) or DELETE (session teardown).
        if (req.method !== 'POST') {
            res.writeHead(405, { Allow: 'POST' }).end('Method Not Allowed')
            return
        }

        try {
            const body = await readJsonBody(req)
            const server = await createMcpServer(tools, serverOpts)
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,   // stateless
                enableJsonResponse,
            })
            res.on('close', () => { transport.close(); server.close() })
            await server.connect(transport)
            await transport.handleRequest(req, res, body)
        }
        catch (err) {
            onLog('MCP HTTP request failed:', err.message)
            if (!res.headersSent) res.writeHead(500).end('Internal error')
        }
    })

    await new Promise((resolve) => httpServer.listen(port, host, resolve))
    onLog(`MCP server listening on http://${host ?? 'localhost'}:${port}${mcpPath}`)
    return httpServer
}

// One-time OAuth login to a remote (HTTP) MCP server.
//
//   node examples/mcp-auth.js <server-name>
//
// `<server-name>` must be an http server defined in the config below (or loaded
// from a file). From a remote host, port-forward the callback:
//   ssh -L 8976:localhost:8976 user@<server-ip>

import http from 'node:http'

import { McpClientManager, DEFAULT_CALLBACK_PORT } from 'ollama-agent-kit'

// Point this at your real config (or use `loadMcpConfigFile('mcp.config.json')`).
const servers = {
    example: {
        enabled: true,
        type: 'http',
        url: 'https://example.com/mcp',
    },
}

const serverName = process.argv[2]
const manager = new McpClientManager({ servers })
const cfg = servers[serverName]

if (!cfg || cfg.type !== 'http') {
    const httpServers = Object.entries(servers).filter(([, c]) => c.type === 'http').map(([n]) => n)
    console.log(`Usage: node examples/mcp-auth.js <server-name>\nAvailable http servers: ${httpServers.join(', ') || 'none'}`)
    process.exit(1)
}

let resolveCode
const codePromise = new Promise(resolve => { resolveCode = resolve })

const callbackServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${DEFAULT_CALLBACK_PORT}`)
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return }

    const error = url.searchParams.get('error')
    if (error) {
        res.end(`Authorization denied: ${error}`)
        console.log(`Authorization denied: ${error}`)
        process.exit(1)
    }
    res.end('Authorization complete — you can close this page.')
    resolveCode(url.searchParams.get('code'))
})
callbackServer.listen(DEFAULT_CALLBACK_PORT)

const onRedirect = (url) => {
    console.log(`\nOpen this URL in your browser to authorize "${serverName}":\n\n${url}\n`)
    console.log(`Waiting for the callback on http://localhost:${DEFAULT_CALLBACK_PORT}/callback ...`)
}

try {
    const transport = await manager.createTransport(serverName, cfg, onRedirect)
    try {
        const client = await manager.newClient()
        await client.connect(transport)
        console.log(`"${serverName}" is already authorized.`)
        await client.close()
    }
    catch (err) {
        // Only the 401 (UnauthorizedError) is expected here: the URL was already printed.
        if (err.constructor?.name !== 'UnauthorizedError') throw err
        const code = await codePromise
        await transport.finishAuth(code)

        // Reconnect with the freshly-saved tokens to verify it works.
        const client = await manager.newClient()
        await client.connect(await manager.createTransport(serverName, cfg, onRedirect))
        const { tools } = await client.listTools()
        console.log(`Authorization succeeded: "${serverName}" exposes ${tools.length} tool(s).`)
        await client.close()
    }
    process.exit(0)
}
catch (err) {
    console.log(`Error while authorizing "${serverName}": ${err.message}`)
    process.exit(1)
}

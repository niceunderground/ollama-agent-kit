// Agent + MCP servers: local tools and remote MCP tools, merged into one loop.
//
// The MCP SDK is an optional dependency — install it to use this example:
//   npm i @modelcontextprotocol/sdk
//
//   node examples/mcp.js "list the files in my home directory"

import { createAgent, McpClientManager } from 'ollama-agent-kit'

// Inline config (you can also load a file with `loadMcpConfigFile('mcp.config.json')`).
const mcp = new McpClientManager({
    onLog: (...a) => console.log('[mcp]', ...a),
    servers: {
        filesystem: {
            enabled: true,
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        },
        // Remote HTTP server with OAuth — run examples/mcp-auth.js once to log in:
        // example: {
        //     enabled: false,
        //     type: 'http',
        //     url: 'https://example.com/mcp',
        // },
    },
})

const agent = createAgent({
    host: process.env.OLLAMA_HOST,
    model: process.env.OLLAMA_MODEL || 'gemma4:latest',
    tools: [],           // add your local tools here
    mcp,                 // remote tools are prefixed, e.g. `filesystem__read_file`
    onToolCall: ({ name }) => console.log(`→ ${name}`),
})

const prompt = process.argv.slice(2).join(' ') || 'List the files in the current directory'
try {
    const answer = await agent.run(prompt)
    console.log('\n=== ANSWER ===\n')
    console.log(answer)
}
finally {
    await mcp.close()
}

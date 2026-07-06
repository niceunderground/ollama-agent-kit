// Publish your tools as an MCP server — the reciprocal of the agent.
//
// The SAME `bulb` definition an agent would call is here exposed to any MCP
// client (Claude Desktop, another agent, ...). Requires the optional SDK:
//   npm i @modelcontextprotocol/sdk
//
//   node examples/serve-mcp.js            # HTTP, online at http://localhost:3000/mcp
//   node examples/serve-mcp.js --stdio    # stdio, spawned as a local process
//
// Protect a public HTTP endpoint with a bearer token:
//   MCP_TOKEN=secret node examples/serve-mcp.js

import { defineTool, serveMcpHttp, serveMcpStdio } from 'ollama-agent-kit'
import { z } from 'zod'

const lights = { studio: { on: false, brightness: 100 } }

const bulb = defineTool({
    name: 'bulb',
    description: 'Control a smart light: turn it on/off and set brightness.',
    parameters: z.object({
        room: z.string().describe('Room name, e.g. "studio"'),
        on: z.boolean().optional(),
        brightness: z.number().min(0).max(100).optional(),
    }),
    exposeAgent: true,
    exposeMcp: true,     // <-- this is what makes it show up on the MCP server
    handler: async ({ room, on, brightness }) => {
        const light = lights[room]
        if (!light) throw new Error(`Unknown room "${room}"`)
        if (on !== undefined) light.on = on
        if (brightness !== undefined) light.brightness = brightness
        return `light[${room}] -> ${JSON.stringify(light)}`
    },
})

const tools = [bulb]

if (process.argv.includes('--stdio')) {
    await serveMcpStdio(tools, { name: 'home-mcp', version: '1.0.0' })
    // stdio: keep the process alive; the client drives it over stdin/stdout.
}
else {
    const port = Number(process.env.PORT) || 3000
    await serveMcpHttp(tools, {
        port,
        name: 'home-mcp',
        version: '1.0.0',
        authToken: process.env.MCP_TOKEN,   // omit for an open endpoint (localhost/dev only)
        onLog: (...a) => console.log('[mcp]', ...a),
    })
    console.log(`Try it: npx @modelcontextprotocol/inspector  →  connect to http://localhost:${port}/mcp`)
}

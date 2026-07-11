// The showcase demo: an agent that controls the lights in your home.
//
// Define a tool once with a Zod schema — the agent can call it, and (because
// `exposeMcp: true`) the very same definition can be published by your own MCP
// server. Here the "bulb" handler is a stub; swap it for your real integration
// (Tuya, Home Assistant, Zigbee, a Raspberry Pi GPIO relay, ...).
//
//   node examples/home-lights.js "turn on the studio light, then dim it to 30%"

import { createAgent, defineTool } from 'ollama-agent-kit'
import { z } from 'zod'

// --- your hardware, behind a tiny async function -------------------------
const lights = { studio: { on: false, brightness: 100 } }

async function setLight(room, { on, brightness }) {
    const light = lights[room]
    if (!light) throw new Error(`Unknown room "${room}"`)
    if (on !== undefined) light.on = on
    if (brightness !== undefined) light.brightness = brightness
    // e.g. await tuya.set({ ... }) / await gpio.write(pin, ...) here
    return `light[${room}] -> ${JSON.stringify(light)}`
}
// -------------------------------------------------------------------------

const bulb = defineTool({
    name: 'bulb',
    description: 'Control a smart light in a room: turn it on/off and set brightness.',
    parameters: z.object({
        room: z.string().describe('Room name, e.g. "studio"'),
        on: z.boolean().optional().describe('Turn the light on (true) or off (false)'),
        brightness: z.number().min(0).max(100).optional().describe('Brightness percentage 0-100'),
    }),
    exposeAgent: true,   // available to the agent loop
    exposeMcp: true,     // and publishable by your MCP server — same definition
    handler: async ({ room, on, brightness }) => setLight(room, { on, brightness }),
})

const agent = createAgent({
    host: process.env.OLLAMA_HOST,
    model: process.env.OLLAMA_MODEL || 'gemma4:latest',
    tools: [bulb],
    onToolCall: ({ name, arguments: args, result }) => console.log(`→ ${name}`, args, '=>', result),
})

const prompt = process.argv.slice(2).join(' ') || 'Turn on the studio light and set it to 30% brightness'
const answer = await agent.run(prompt)

console.log('\n=== ANSWER ===\n')
console.log(answer)

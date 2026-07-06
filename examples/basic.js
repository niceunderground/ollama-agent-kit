// Basic agent: web search + web fetch, driven from the command line.
//
//   OLLAMA_API_KEY=... node examples/basic.js "latest new media art news"
//
// Requires a reachable Ollama instance and an API key for the web tools.

import { createAgent, webSearchTool, webFetchTool } from 'ollama-agent-kit'

const apiKey = process.env.OLLAMA_API_KEY

const agent = createAgent({
    host: process.env.OLLAMA_HOST,        // defaults to http://localhost:11434
    model: process.env.OLLAMA_MODEL || 'qwen3',
    tools: [
        webSearchTool({ apiKey }),
        webFetchTool({ apiKey }),
    ],
    onToolCall: ({ name, arguments: args }) => console.log(`→ ${name}`, args),
})

const prompt = process.argv.slice(2).join(' ') || 'Summarize the latest new media art news'
const answer = await agent.run(prompt)

console.log('\n=== ANSWER ===\n')
console.log(answer)

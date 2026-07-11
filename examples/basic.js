// Basic agent: web search + web fetch, driven from the command line.
//
//   OLLAMA_API_KEY=... node examples/basic.js "latest new media art news"
//
// Requires a reachable Ollama instance and an API key for the web tools.

import { createAgent, webSearchTool, webFetchTool } from 'ollama-agent-kit'

const agent = createAgent({
    host: process.env.OLLAMA_HOST,        // defaults to http://localhost:11434
    apiKey: process.env.OLLAMA_API_KEY,   // shared by cloud models and the web tools below
    model: process.env.OLLAMA_MODEL || 'gemma4:latest',
    tools: [
        webSearchTool,
        webFetchTool,
    ],
    onToolCall: ({ name, arguments: args }) => console.log(`→ ${name}`, args),
})

const prompt = process.argv.slice(2).join(' ') || 'Summarize the latest new media art news'
const answer = await agent.run(prompt)

console.log('\n=== ANSWER ===\n')
console.log(answer)

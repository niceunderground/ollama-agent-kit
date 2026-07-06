// ollama-agent-kit — public API
//
// Define a tool once — your agent uses it, your MCP server exposes it.

export { createAgent, defaultSystemPrompt } from './agent.js'
export { createOllamaClient } from './ollama.js'
export {
    createRegistry,
    defineTool,
    validateTools,
    toOllamaTool,
    toHandlerMap,
} from './registry.js'
export { webSearchTool, webFetchTool } from './tools/index.js'
export {
    McpClientManager,
    createMcpTools,
    loadMcpConfigFile,
    FileOAuthProvider,
    DEFAULT_CALLBACK_PORT,
    createMcpServer,
    serveMcpStdio,
    serveMcpHttp,
} from './mcp/index.js'
export {
    AgentError,
    MaxTurnsError,
    ToolNotFoundError,
    RegistryError,
} from './errors.js'

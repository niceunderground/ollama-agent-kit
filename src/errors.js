/** Base class for all errors thrown by the kit. */
export class AgentError extends Error {
    constructor(message) {
        super(message)
        this.name = 'AgentError'
    }
}

/** Thrown when the agent loop hits `maxTurns` without producing a final answer. */
export class MaxTurnsError extends AgentError {
    constructor(maxTurns) {
        super(`Agent reached maxTurns (${maxTurns}) without a final answer`)
        this.name = 'MaxTurnsError'
        this.maxTurns = maxTurns
    }
}

/** Thrown (into the tool result) when the model calls a tool that is not registered. */
export class ToolNotFoundError extends AgentError {
    constructor(toolName) {
        super(`Tool "${toolName}" not found`)
        this.name = 'ToolNotFoundError'
        this.toolName = toolName
    }
}

/** Thrown when a tool definition is malformed or a tool name is duplicated in the registry. */
export class RegistryError extends AgentError {
    constructor(message) {
        super(message)
        this.name = 'RegistryError'
    }
}

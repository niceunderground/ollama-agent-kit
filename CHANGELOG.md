# Changelog

All notable changes to **ollama-agent-kit** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org).

## [0.3.0] - 2026-07-18

### Added
- **Persistent conversations.** `run()` now accepts either a string (single task, fresh conversation — the previous behavior) or a messages array: the array is used as the conversation history and every new message (user turns, assistant replies, tool results, final answer) is pushed into it, so reusing the same array across runs continues the same conversation. A string prompt can also be appended to an existing history with `run(prompt, { messages: history })`. String entries in the array are normalized to user messages and the system prompt is inserted once if missing.
- **Working folder (`workdir`).** New `createAgent({ workdir })` option, propagated through the tool context to the built-in tools: relative paths in `read_file` / `write_file` / `edit_file` / `list_directory` resolve against it, `run_shell_command` starts there, and filesystem access is restricted to the folder — escaping paths are rejected with an `Access denied` error.
- **Full machine access (`fullAccess`).** `createAgent({ workdir, fullAccess: true })` lifts the `workdir` restriction: the tools can reach the whole machine while `workdir` remains the default base path. Without `workdir` the behavior is unchanged (full access, `process.cwd()` as base).
- Filesystem tool factories accept `{ workdir, fullAccess }` directly; `runShellCommandTool` accepts `{ workdir }` (its `cwd` option overrides it).
- **Images for multimodal (vision) models.** `run(prompt, { images })` attaches images to the user message. Each entry can be a file path, an http(s) URL (fetched for you), a `data:` URI, a base64 string, a Buffer or a Uint8Array — everything is normalized to the base64 form the Ollama API expects. Works with persistent conversations too (`run(prompt, { messages, images })`), and user messages in a caller-managed conversation array can carry their own `images` field, normalized the same way. The helpers are exported as `resolveImage` / `resolveImages`.
- Tests for persistent conversations, the `workdir` / `fullAccess` sandbox (`test/filesystem.test.js`), and image normalization (`test/images.test.js`).

### Changed
- The final assistant message is now pushed onto the messages array before `onFinal` fires, so the history handed to callbacks (and kept in persistent conversations) is complete.
- The `tools` field is omitted from the chat request when the agent has no tools: Ollama rejects a request carrying tools if the model doesn't support them, and many vision models don't — a bare `createAgent({ model: 'llava' })` now works out of the box.

## [0.2.1] - 2026-07

### Changed
- Documentation and package metadata updates.

## [0.2.0] - 2026-07

### Added
- Filesystem tools: `readFileTool`, `writeFileTool`, `editFileTool`, `listDirectoryTool`.
- Shell tool: `runShellCommandTool` (timeout, maxBuffer, cwd options).

### Changed
- Default model switched to `gemma4:latest`.
- Tool naming cleanup.

## [0.1.3] - 2026

### Fixed
- Removed `publishConfig` from `package.json`.

## [0.1.2] - 2026

### Changed
- Registry updates and refusal-handling tweaks.

## [0.1.1] - 2026

### Added
- Tool entries can be factory functions `(ctx) => Tool` called with the agent context (`client`, `apiKey`, `host`), so tools like `webSearchTool` / `webFetchTool` reuse the agent's client.

### Changed
- `maxTurns` default documented as 10.

## [0.1.0] - 2026

### Added
- Initial release: agent loop on Ollama, unified tool registry (Zod → JSON Schema), MCP client (`McpClientManager`, OAuth via `FileOAuthProvider`) and MCP server (`createMcpServer`, `serveMcpStdio`, `serveMcpHttp`), web tools (`webSearchTool`, `webFetchTool`).

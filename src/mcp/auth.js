import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_CALLBACK_PORT = 8976

/**
 * OAuth provider that persists tokens and client info per-server as JSON files
 * (default: `<cwd>/.mcp-auth/<serverName>.json`). Suitable for a long-lived
 * server process; the interactive login is done once with a small script
 * (see `examples/mcp-auth.js`).
 */
export class FileOAuthProvider {
    /**
     * @param {string} serverName
     * @param {object} [opts]
     * @param {string} [opts.authDir] Directory for the token files (default `<cwd>/.mcp-auth`).
     * @param {number} [opts.callbackPort=8976] Local OAuth callback port.
     * @param {string} [opts.clientName='ollama-agent-kit-mcp-client']
     * @param {(url: string) => void} [opts.onRedirect] Called with the authorization URL when
     *   interactive login is required. If omitted, `redirectToAuthorization` throws with instructions.
     */
    constructor(serverName, {
        authDir = path.join(process.cwd(), '.mcp-auth'),
        callbackPort = DEFAULT_CALLBACK_PORT,
        clientName = 'ollama-agent-kit-mcp-client',
        onRedirect = null,
    } = {}) {
        this.serverName = serverName
        this.authDir = authDir
        this.file = path.join(authDir, `${serverName}.json`)
        this.callbackPort = callbackPort
        this.callbackUrl = `http://localhost:${callbackPort}/callback`
        this.clientName = clientName
        this.onRedirect = onRedirect
    }

    read() {
        try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) }
        catch { return {} }
    }

    write(patch) {
        fs.mkdirSync(this.authDir, { recursive: true })
        fs.writeFileSync(this.file, JSON.stringify({ ...this.read(), ...patch }, null, 2), { mode: 0o600 })
    }

    get redirectUrl() { return this.callbackUrl }

    get clientMetadata() {
        return {
            client_name: this.clientName,
            redirect_uris: [this.callbackUrl],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        }
    }

    clientInformation() { return this.read().clientInformation }
    saveClientInformation(info) { this.write({ clientInformation: info }) }

    tokens() { return this.read().tokens }
    saveTokens(tokens) { this.write({ tokens }) }

    saveCodeVerifier(verifier) { this.write({ codeVerifier: verifier }) }
    codeVerifier() { return this.read().codeVerifier }

    redirectToAuthorization(url) {
        if (this.onRedirect) return this.onRedirect(url.toString())
        throw new Error(`MCP server "${this.serverName}" requires OAuth authorization. Run the interactive login for this server (see examples/mcp-auth.js).`)
    }
}

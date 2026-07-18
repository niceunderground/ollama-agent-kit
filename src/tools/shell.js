import { z } from 'zod'
import { exec } from 'child_process'
import { resolve } from 'path'

/**
 * `run_shell_command` tool: execute a shell command on the host machine and
 * return its stdout/stderr.
 *
 * Note: `workdir` only sets where the shell starts — a shell command can still
 * touch any path on the machine (`cd ..`, absolute paths). Sandboxing shell
 * commands is out of scope; drop this tool if that matters.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeout=15000] Max time (ms) before the command is killed.
 * @param {number} [opts.maxBuffer=1024 * 1024] Max stdout/stderr size (bytes).
 * @param {string} [opts.cwd] Working directory for the command (overrides `workdir`).
 * @param {string} [opts.workdir] Default working directory, shared with the filesystem tools.
 * @returns {import('../registry.js').Tool}
 */
export function runShellCommandTool({ timeout = 15000, maxBuffer = 1024 * 1024, cwd, workdir } = {}) {
    cwd = cwd ?? (workdir ? resolve(workdir) : undefined)
    return {
        name: 'run_shell_command',
        description: 'Execute a shell command on the host machine and return stdout/stderr.',
        parameters: z.object({
            command: z.string().describe('The shell command to execute'),
        }),
        exposeAgent: true,
        exposeMcp: false,
        handler: async ({ command }) => await runCommand(command, { timeout, maxBuffer, cwd }),
    }
}

function runCommand(command, { timeout, maxBuffer, cwd }) {
    console.log(`RunCommand: ${command}`)
    return new Promise((resolve) => {
        exec(command, { timeout, maxBuffer, cwd }, (error, stdout, stderr) => {
            if (error) {
                resolve({ success: false, error: error.message, stdout, stderr })
                return
            }
            resolve({ success: true, stdout, stderr })
        })
    })
}

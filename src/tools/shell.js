import { z } from 'zod'
import { exec } from 'child_process'

/**
 * `run_shell_command` tool: execute a shell command on the host machine and
 * return its stdout/stderr.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeout=15000] Max time (ms) before the command is killed.
 * @param {number} [opts.maxBuffer=1024 * 1024] Max stdout/stderr size (bytes).
 * @param {string} [opts.cwd] Working directory for the command.
 * @returns {import('../registry.js').Tool}
 */
export function runShellCommandTool({ timeout = 15000, maxBuffer = 1024 * 1024, cwd } = {}) {
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

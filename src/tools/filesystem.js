import { z } from 'zod'
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'path'

/**
 * Build the path resolver shared by the filesystem tools.
 *
 * - No `workdir`: relative paths resolve against `process.cwd()`, any path on the
 *   machine is allowed (full access, the historical behavior).
 * - `workdir` set: relative paths resolve against it and access is restricted to
 *   that folder — a path escaping it makes the tool report an error to the model.
 * - `workdir` + `fullAccess: true`: `workdir` stays the default base for relative
 *   paths, but any path on the machine is allowed.
 *
 * @param {object} [opts]
 * @param {string}  [opts.workdir] Base folder for relative paths.
 * @param {boolean} [opts.fullAccess] Allow paths outside `workdir`.
 */
function createPathResolver({ workdir, fullAccess } = {}) {
    const base = workdir ? resolve(workdir) : process.cwd()
    return (p = '.') => {
        const full = resolve(base, p)
        if (workdir && !fullAccess) {
            const rel = relative(base, full)
            if (rel.startsWith('..') || isAbsolute(rel)) {
                throw new Error(`Access denied: "${full}" is outside the working folder "${base}".`)
            }
        }
        return full
    }
}

/**
 * `read_file` tool: read the full text content of a file.
 * @param {object} [opts]
 * @param {string}  [opts.workdir] Base folder for relative paths; restricts access to it unless `fullAccess` is true.
 * @param {boolean} [opts.fullAccess] Allow paths outside `workdir` (whole machine).
 * @returns {import('../registry.js').Tool}
 */
export function readFileTool({ workdir, fullAccess } = {}) {
    const resolvePath = createPathResolver({ workdir, fullAccess })
    return {
        name: 'read_file',
        description: 'Read the full text content of a file from the filesystem and return it. Use it to inspect a file before editing.',
        parameters: z.object({
            path: z.string().describe('Absolute or relative path of the file to read'),
        }),
        exposeAgent: true,
        exposeMcp: false,
        handler: async ({ path }) => {
            console.log(`Reading file: ${path}`)
            const full = resolvePath(path)
            const content = await readFile(full, 'utf8')
            return content === '' ? `(file "${full}" is empty)` : content
        },
    }
}

/**
 * `write_file` tool: create or overwrite a file with the given content.
 * @param {object} [opts]
 * @param {string}  [opts.workdir] Base folder for relative paths; restricts access to it unless `fullAccess` is true.
 * @param {boolean} [opts.fullAccess] Allow paths outside `workdir` (whole machine).
 * @returns {import('../registry.js').Tool}
 */
export function writeFileTool({ workdir, fullAccess } = {}) {
    const resolvePath = createPathResolver({ workdir, fullAccess })
    return {
        name: 'write_file',
        description: 'Write text content to a file, creating it (and any missing parent directories) or overwriting it entirely if it already exists.',
        parameters: z.object({
            path: z.string().describe('Absolute or relative path of the file to write'),
            content: z.string().describe('The full text content to write into the file'),
        }),
        exposeAgent: true,
        exposeMcp: false,
        handler: async ({ path, content }) => {
            console.log(`Writing to file: ${path}`)
            const full = resolvePath(path)
            await mkdir(dirname(full), { recursive: true })
            await writeFile(full, content, 'utf8')
            return `Wrote ${content.length} characters to "${full}".`
        },
    }
}

/**
 * `edit_file` tool: replace an exact string occurrence within a file.
 * @param {object} [opts]
 * @param {string}  [opts.workdir] Base folder for relative paths; restricts access to it unless `fullAccess` is true.
 * @param {boolean} [opts.fullAccess] Allow paths outside `workdir` (whole machine).
 * @returns {import('../registry.js').Tool}
 */
export function editFileTool({ workdir, fullAccess } = {}) {
    const resolvePath = createPathResolver({ workdir, fullAccess })
    return {
        name: 'edit_file',
        description: 'Edit a file by replacing an exact occurrence of a string with another. The "oldString" must appear exactly once in the file unless "replaceAll" is true. Use it for targeted changes without rewriting the whole file.',
        parameters: z.object({
            path: z.string().describe('Absolute or relative path of the file to edit'),
            oldString: z.string().describe('The exact text to find and replace'),
            newString: z.string().describe('The text to replace it with'),
            replaceAll: z.boolean().optional().describe('Replace every occurrence instead of requiring a single unique match'),
        }),
        exposeAgent: true,
        exposeMcp: false,
        handler: async ({ path, oldString, newString, replaceAll }) => {
            console.log(`Editing file: ${path}`)
            const full = resolvePath(path)
            const content = await readFile(full, 'utf8')

            if (oldString === newString) return 'Error: "oldString" and "newString" are identical, nothing to do.'

            const occurrences = content.split(oldString).length - 1
            if (occurrences === 0) return `Error: "oldString" not found in "${full}".`
            if (occurrences > 1 && !replaceAll) {
                return `Error: "oldString" found ${occurrences} times in "${full}". Make it unique or set "replaceAll" to true.`
            }

            const updated = replaceAll
                ? content.split(oldString).join(newString)
                : content.replace(oldString, newString)

            await writeFile(full, updated, 'utf8')
            return `Replaced ${replaceAll ? occurrences : 1} occurrence(s) in "${full}".`
        },
    }
}

/**
 * `list_directory` tool: list the entries of a directory.
 * @param {object} [opts]
 * @param {string}  [opts.workdir] Base folder for relative paths; restricts access to it unless `fullAccess` is true.
 * @param {boolean} [opts.fullAccess] Allow paths outside `workdir` (whole machine).
 * @returns {import('../registry.js').Tool}
 */
export function listDirectoryTool({ workdir, fullAccess } = {}) {
    const resolvePath = createPathResolver({ workdir, fullAccess })
    return {
        name: 'list_directory',
        description: 'List the entries of a directory, marking each as a file or a directory. Use it to explore the filesystem.',
        parameters: z.object({
            path: z.string().optional().describe('Absolute or relative path of the directory to list (defaults to the working folder)'),
        }),
        exposeAgent: true,
        exposeMcp: false,
        handler: async ({ path }) => {
            console.log(`Listing directory: ${path ?? '.'}`)
            const full = resolvePath(path)
            const entries = await readdir(full)
            if (entries.length === 0) return `(directory "${full}" is empty)`

            const lines = await Promise.all(
                entries.sort().map(async name => {
                    try {
                        const info = await stat(resolve(full, name))
                        return `${info.isDirectory() ? '[dir] ' : '[file]'} ${name}`
                    } catch {
                        return `[?]    ${name}`
                    }
                }),
            )
            return `Contents of "${full}":\n${lines.join('\n')}`
        },
    }
}

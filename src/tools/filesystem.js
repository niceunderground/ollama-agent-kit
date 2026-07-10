import { z } from 'zod'
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises'
import { dirname, resolve } from 'path'

const resolvePath = p => resolve(p)

/**
 * `fs_read_file` tool: read the full text content of a file.
 * @returns {import('../registry.js').Tool}
 */
export function fsReadFileTool() {
    return {
        name: 'fs_read_file',
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
 * `fs_write_file` tool: create or overwrite a file with the given content.
 * @returns {import('../registry.js').Tool}
 */
export function fsWriteFileTool() {
    return {
        name: 'fs_write_file',
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
 * `fs_edit_file` tool: replace an exact string occurrence within a file.
 * @returns {import('../registry.js').Tool}
 */
export function fsEditFileTool() {
    return {
        name: 'fs_edit_file',
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
 * `fs_list_directory` tool: list the entries of a directory.
 * @returns {import('../registry.js').Tool}
 */
export function fsListDirectoryTool() {
    return {
        name: 'fs_list_directory',
        description: 'List the entries of a directory, marking each as a file or a directory. Use it to explore the filesystem.',
        parameters: z.object({
            path: z.string().optional().describe('Absolute or relative path of the directory to list (defaults to the current working directory)'),
        }),
        exposeAgent: true,
        exposeMcp: false,
        handler: async ({ path }) => {
            console.log(`Listing directory: ${path ?? '.'}`)
            const full = resolvePath(path ?? '.')
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

import { readFileTool, writeFileTool, listDirectoryTool } from '../src/tools/filesystem.js'
import { runShellCommandTool } from '../src/tools/shell.js'

async function withWorkdir(fn) {
    const dir = await mkdtemp(join(tmpdir(), 'oak-fs-'))
    try {
        await fn(dir)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

test('relative paths resolve against workdir', async () => {
    await withWorkdir(async (dir) => {
        await writeFile(join(dir, 'note.txt'), 'hello from workdir')
        const content = await readFileTool({ workdir: dir }).handler({ path: 'note.txt' })
        assert.equal(content, 'hello from workdir')

        await writeFileTool({ workdir: dir }).handler({ path: 'out.txt', content: 'x' })
        const listing = await listDirectoryTool({ workdir: dir }).handler({})
        assert.match(listing, /out\.txt/)
    })
})

test('paths outside workdir are rejected without fullAccess', async () => {
    await withWorkdir(async (dir) => {
        await assert.rejects(
            () => readFileTool({ workdir: dir }).handler({ path: '../escape.txt' }),
            /Access denied/,
        )
        await assert.rejects(
            () => writeFileTool({ workdir: dir }).handler({ path: resolve(tmpdir(), 'escape.txt'), content: 'x' }),
            /Access denied/,
        )
    })
})

test('fullAccess allows paths outside workdir, with workdir as default base', async () => {
    await withWorkdir(async (dir) => {
        const outside = join(await mkdtemp(join(tmpdir(), 'oak-out-')), 'far.txt')
        await writeFile(outside, 'far away')
        try {
            const tool = readFileTool({ workdir: dir, fullAccess: true })
            assert.equal(await tool.handler({ path: outside }), 'far away')

            await writeFile(join(dir, 'near.txt'), 'near')
            assert.equal(await tool.handler({ path: 'near.txt' }), 'near')
        } finally {
            await rm(join(outside, '..'), { recursive: true, force: true })
        }
    })
})

test('without workdir any path is allowed (historical behavior)', async () => {
    await withWorkdir(async (dir) => {
        await writeFile(join(dir, 'free.txt'), 'free')
        const content = await readFileTool().handler({ path: join(dir, 'free.txt') })
        assert.equal(content, 'free')
    })
})

test('run_shell_command starts in workdir', async () => {
    await withWorkdir(async (dir) => {
        const tool = runShellCommandTool({ workdir: dir })
        const result = await tool.handler({ command: process.platform === 'win32' ? 'cd' : 'pwd' })
        assert.equal(result.success, true)
        assert.match(result.stdout.trim().toLowerCase(), new RegExp(resolve(dir).replaceAll('\\', '\\\\').toLowerCase()))
    })
})

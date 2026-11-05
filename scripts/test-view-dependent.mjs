import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import { rollup } from 'rollup';
import ts from 'typescript';

// Bundle the production loader/exporter for Node without adding a test runtime
// dependency. The browser regression script tests the actual compiled shaders.
const dir = await mkdtemp(join(tmpdir(), 'supersplat-view-dependent-'));
try {
    const bundle = await rollup({
        input: 'tests/view-dependent.test.mjs',
        external: id => id.startsWith('node:'),
        plugins: [
            {
                name: 'test-typescript',
                transform(code, id) {
                    if (!id.endsWith('.ts')) return null;
                    return ts.transpileModule(code, {
                        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
                    }).outputText;
                }
            },
            resolve({ extensions: ['.mjs', '.js', '.json', '.ts'] }),
            json()
        ]
    });
    const file = join(dir, 'test.mjs');
    await bundle.write({ dir, format: 'esm', entryFileNames: 'test.mjs' });
    await bundle.close();
    const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
} finally {
    await rm(dir, { recursive: true, force: true });
}

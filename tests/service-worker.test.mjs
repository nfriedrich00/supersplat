import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('built worker waits for fresh assets, replaces old app cache, and serves its own build', async () => {
    const code = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
    assert.ok(!code.includes('__SUPERSPLAT_BUILD_REVISION__'), 'build revision is substituted');
    const handlers = new Map();
    const deleted = [];
    let currentCache;
    let finishDownload;
    let skippedWaiting = false;
    let claimed = false;
    const downloaded = new Promise(resolve => { finishDownload = resolve; });
    runInNewContext(code, {
        console: { log() {} },
        self: {
            addEventListener: (name, handler) => handlers.set(name, handler),
            skipWaiting: async () => { skippedWaiting = true; },
            clients: { claim: async () => { claimed = true; } }
        },
        caches: {
            open: async (name) => {
                assert.notEqual(name, 'superSplat-v2.32.3');
                currentCache = name;
                return { addAll: () => downloaded, match: async () => 'new sided renderer' };
            },
            keys: async () => ['superSplat-v2.32.3', 'unrelated-cache', currentCache],
            delete: async name => { deleted.push(name); }
        },
        fetch: () => { throw new Error('fresh cached assets should not need a network request'); }
    });
    let installation;
    handlers.get('install')({ waitUntil: promise => { installation = promise; } });
    await Promise.resolve();
    assert.equal(skippedWaiting, false, 'installation waits until assets are downloaded');
    finishDownload();
    await installation;
    assert.equal(skippedWaiting, true);
    let activation;
    handlers.get('activate')({ waitUntil: promise => { activation = promise; } });
    await activation;
    assert.deepEqual(deleted, ['superSplat-v2.32.3']);
    assert.equal(claimed, true);
    let response;
    handlers.get('fetch')({ request: '/index.js', respondWith: promise => { response = promise; } });
    assert.equal(await response, 'new sided renderer');
});

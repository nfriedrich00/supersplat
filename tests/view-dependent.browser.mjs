import assert from 'node:assert/strict';

import { makePly } from './view-dependent-fixture.mjs';

// Optional integration test. Install Playwright separately and run against a
// built, running editor. PLAYWRIGHT_MODULE can point to an existing installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const errors = [];
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${process.env.SUPERSPLAT_URL || 'http://127.0.0.1:3100/'}?lng=en`);
    await page.waitForFunction(() => !!window.scene);
    const importPly = async (bytes) => {
        await page.route('**/view-fixture.ply', route => route.fulfill({ body: Buffer.from(bytes) }));
        await page.evaluate(async () => {
            const bytes = await (await fetch('/view-fixture.ply')).arrayBuffer();
            await window.scene.events.invoke('import', [{
                filename: 'fixture.ply', contents: new File([bytes], 'fixture.ply')
            }]);
        });
        await page.unroute('**/view-fixture.ply');
    };
    const pose = async (d, rotate = false) => {
        await page.evaluate(({ d, rotate }) => {
            const scene = window.scene;
            const splat = scene.events.invoke('selection');
            if (rotate) splat.entity.setLocalEulerAngles(23, 51, -17);
            const V = scene.camera.mainCamera.getPosition().constructor;
            const position = splat.worldTransform.transformPoint(new V(d.map(v => -5 * v)));
            scene.camera.setPose(position, new V(0, 0, 0), 0);
            scene.camera.onUpdate(0);
            scene.forceRender = true;
        }, { d, rotate });
        await page.waitForTimeout(150);
    };
    const visible = async () => page.evaluate(async () => {
        const pixels = await window.scene.events.invoke('render.offscreen', 64, 64);
        const i = (32 * 64 + 32) * 4;
        return pixels[i] + pixels[i + 1] + pixels[i + 2] > 50;
    });
    const pick = async () => page.evaluate(async () => {
        const scene = window.scene;
        scene.camera.pickPrep(scene.events.invoke('selection'), 'set');
        return await scene.camera.pick(0.5, 0.5);
    });
    const threshold = async (id, value) => {
        const input = page.locator(`#${id} input`);
        await input.fill(String(value));
        await input.press('Enter');
    };

    const obs = [0.3, -0.4, Math.sqrt(0.75)];
    // A second, off-axis Gaussian gives the editor non-degenerate scene bounds.
    await importPly(makePly([0, 4], undefined, obs));
    await page.evaluate(() => {
        window.scene.events.fire('grid.setVisible', false);
        window.scene.events.fire('camera.setBound', false);
        window.scene.events.fire('camera.setOverlay', false);
        window.scene.events.fire('view.setBands', 0);
    });
    assert.equal(await page.locator('#max-view-uncertainty input').inputValue(), '1');
    await pose([0, 0, -1]);
    assert.equal(await visible(), true, 'default rendering');

    await threshold('max-view-uncertainty', 0.5);
    assert.equal(await visible(), true, 'low uncertainty direction');
    assert.equal(await pick(), 0, 'visible Gaussian is pickable');
    await pose([0, 0, 1]);
    assert.equal(await visible(), false, 'high uncertainty direction');
    assert.equal(await pick(), 0xffffffff, 'filtered Gaussian is not pickable');
    await page.getByText('Show all directions', { exact: true }).click();
    assert.equal(await visible(), true, 'reset restores the Gaussian');

    // Compare the GPU degree-3 evaluation against the observation kernel,
    // including both hemispheres and a rotated entity coordinate frame.
    for (const rotate of [false, true]) {
        for (const d of [obs, obs.map(v => -v), [0, 0, 1], [0.6, 0.8, 0]]) {
            await pose(d, rotate);
            const dot = d.reduce((v, x, c) => v + x * obs[c], 0);
            const expected = 3 * ((1 + dot) / 2) ** 3;
            for (const limit of [Math.max(0, expected - 0.08), expected + 0.08]) {
                await threshold('min-view-evidence', limit);
                assert.equal(await visible(), expected >= limit, `evidence=${expected}, limit=${limit}, rotated=${rotate}`);
            }
        }
    }

    // Numeric input must support evidence thresholds above one.
    await threshold('min-view-evidence', 20);
    assert.equal(await page.evaluate(() => window.scene.events.invoke('selection').minViewEvidence), 20);
    assert.equal(await visible(), false);

    // Project metadata round trip, with SH retained by the separately tested
    // PLY writer used inside .ssproj archives.
    await page.evaluate(() => {
        const splat = window.scene.events.invoke('selection');
        const doc = splat.docSerialize();
        splat.maxViewUncertainty = 0.1;
        splat.minViewEvidence = 0;
        splat.docDeserialize(doc);
    });
    assert.equal(await page.evaluate(() => window.scene.events.invoke('selection').minViewEvidence), 20);

    await importPly(makePly([0, 4], []));
    await pose([0, 0, -1]);
    assert.equal(await visible(), true, 'ordinary PLY rendering');
    assert.equal(await page.locator('#max-view-uncertainty input').isEditable(), false);
    assert.equal(await page.locator('#min-view-evidence input').isEditable(), false);
    assert.deepEqual(errors, [], 'browser/GPU errors');
    console.log('Browser checks passed: directional uncertainty/evidence, rotation, picking, numeric thresholds, reset, metadata, ordinary PLY.');
} finally {
    await browser.close();
}

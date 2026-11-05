import assert from 'node:assert/strict';

import { makeHistogramPly, makePly } from './view-dependent-fixture.mjs';

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

    // Histogram evaluations must use the renderer's data-space direction,
    // and remain available when appearance SH is disabled.
    await importPly(makePly([0, 4], undefined, obs));
    const histogram = async (mode, onScreenOnly = false, isOrtho = false) => page.evaluate(async ({ mode, onScreenOnly, isOrtho }) => {
        const scene = window.scene;
        const splat = scene.events.invoke('selection');
        return await scene.commandQueue.enqueue(async () => {
            const cam = scene.camera.camera;
            const projection = cam.projectionMatrix.clone().mul(cam.viewMatrix);
            const options = {
                entityMatrix: splat.worldTransform, viewMatrix: cam.viewMatrix,
                cameraPos: scene.camera.position, viewProjection: projection, onScreenOnly, isOrtho
            };
            const result = await scene.dataProcessor.calcHistogram(splat, mode, options);
            const mask = await scene.dataProcessor.selectByRange(splat, mode, {
                ...options, min: result.min, max: result.max, numBins: 256, rangeStart: 0, rangeEnd: 0
            });
            const firstBinXs = Array.from(splat.splatData.getProp('x')).filter((_, i) => mask[i] === 255);
            scene.dataProcessor.releaseMask(mask);
            return {
                min: result.min, max: result.max, total: result.numValues,
                zero: result.exactZero, one: result.exactOne,
                first: result.selected[0] + result.unselected[0],
                last: result.selected[255] + result.unselected[255],
                selectedFirst: result.selected[0], firstBinXs
            };
        });
    }, { mode, onScreenOnly, isOrtho });
    for (const rotate of [false, true]) {
        await pose([0, 0, -1], rotate);
        const low = await histogram(69);
        assert.ok(Math.abs(low.min - 0.1) < 1e-6, 'uncertainty histogram in low direction');
        await pose([0, 0, 1], rotate);
        const high = await histogram(69);
        assert.ok(Math.abs(high.max - 0.9) < 1e-6, 'uncertainty histogram in high direction');
    }
    await pose(obs, true);
    const supported = await histogram(70);
    assert.ok(supported.max >= 3 - 1e-5, 'evidence histogram at an observed direction');
    const ortho = await histogram(69, false, true);
    assert.ok(Math.abs(ortho.max - ortho.min) < 1e-6, 'parallel orthographic rays');

    await page.evaluate(() => window.scene.events.fire('statusBar.panelChanged', 'splatData'));
    await page.locator('[data-property="view-uncertainty"]').click();
    await pose([0, 0, -1], true);
    await page.waitForFunction(() => document.querySelector('.histogram-info-min').textContent === '0.100');
    await pose([0, 0, 1], true);
    await page.waitForFunction(() => document.querySelector('.histogram-info-max').textContent === '0.900');

    await importPly(makeHistogramPly());
    await page.evaluate(async () => {
        const splat = window.scene.events.invoke('selection');
        const xs = splat.splatData.getProp('x');
        for (let i = 0; i < xs.length; i++) {
            const state = xs[i] === 0 ? 1 : xs[i] === 5 ? 2 : xs[i] === 6 ? 4 : 0;
            if (state) splat.state.setBits({ forEach: fn => fn(i) }, state);
        }
        await splat.updateState(4);
    });
    await pose([0, 0, -1]);
    const distribution = await histogram(69);
    assert.deepEqual(distribution, {
        min: 0, max: 1, total: 5, zero: 2, one: 1,
        first: 3, last: 2, selectedFirst: 1, firstBinXs: [0, 1, 2]
    });
    const evidenceDistribution = await histogram(70);
    assert.equal(evidenceDistribution.zero, 2, 'exact evidence zeros');
    assert.equal(evidenceDistribution.first, 3, 'near-zero evidence is not an exact zero');
    const onScreen = await histogram(69, true);
    assert.ok(onScreen.total < 5 && onScreen.total > 0, 'on-screen filter applies');
    await page.evaluate(() => {
        const splat = window.scene.events.invoke('selection');
        splat.maxViewUncertainty = 0.25;
        splat.minViewEvidence = 2;
    });
    assert.deepEqual(await histogram(69), distribution, 'distribution is independent of opacity thresholds');

    await page.evaluate(() => window.scene.events.fire('statusBar.panelChanged', 'splatData'));
    await page.locator('[data-property="view-uncertainty"]').click();
    await page.waitForFunction(() => document.querySelector('#histogram-exact-one').textContent === 'Exactly 1: 1 (20.0%)');
    assert.equal(await page.locator('#histogram-value-total').textContent(), 'Total: 5');
    assert.equal(await page.locator('#histogram-exact-zero').textContent(), 'Exactly 0: 2 (40.0%)');
    await page.locator('[data-property="view-evidence"]').click();
    await page.waitForFunction(() => !document.querySelector('#histogram-view-dependent-stats').hidden);
    assert.equal(await page.locator('#histogram-exact-one').isVisible(), false);
    await page.screenshot({ path: process.env.SUPERSPLAT_HISTOGRAM_SCREENSHOT || '/tmp/supersplat-histogram.png' });

    await importPly(makePly([0, 4], []));
    assert.equal(await page.locator('[data-property="view-uncertainty"]').count(), 0);
    assert.equal(await page.locator('[data-property="view-evidence"]').count(), 0);
    assert.equal(await page.locator('#histogram-view-dependent-stats').isVisible(), false);

    for (const [prefix, property, other, mode] of [
        ['appearance_uncertainty_sh_', 'view-uncertainty', 'view-evidence', 69],
        ['observation_evidence_sh_', 'view-evidence', 'view-uncertainty', 70]
    ]) {
        await importPly(makePly([0, 4], [prefix]));
        assert.equal(await page.locator(`[data-property="${property}"]`).count(), 1);
        assert.equal(await page.locator(`[data-property="${other}"]`).count(), 0);
        assert.equal((await histogram(mode)).total, 2, 'independent-field shader variant');
    }
    assert.deepEqual(errors, [], 'browser/GPU errors');
    console.log('Browser checks passed: directional filtering, picking, histograms, exact endpoints, bin selection, camera/rotation/orthographic views, ordinary PLY.');
} finally {
    await browser.close();
}

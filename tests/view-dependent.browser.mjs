import assert from 'node:assert/strict';

import { makeHistogramPly, makePly, makeSidedPly } from './view-dependent-fixture.mjs';

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
            for (const splat of window.scene.events.invoke('scene.allSplats')) splat.visible = false;
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
    const pixel = async () => page.evaluate(async () => {
        const pixels = await window.scene.events.invoke('render.offscreen', 64, 64);
        const i = (32 * 64 + 32) * 4;
        return Array.from(pixels.slice(i, i + 4));
    });
    const visible = async () => (await pixel()).slice(0, 3).reduce((sum, value) => sum + value, 0) > 50;
    const fallbackColor = async (rgb) => page.locator('#outside-threshold-color').evaluate((el, value) => { el.ui.value = value; }, rgb);
    const outsideMode = async (value) => page.locator('#outside-threshold-mode').evaluate((el, mode) => { el.ui.value = mode; }, value);
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
    assert.equal(await page.evaluate(() => window.scene.events.invoke('selection').outsideThresholdMode), 'hide');
    assert.equal(await page.locator('#outside-threshold-color').isVisible(), false);
    await pose([0, 0, -1]);
    assert.equal(await visible(), true, 'default rendering');

    await threshold('min-view-uncertainty', 0.5);
    assert.equal(await visible(), false, 'minimum uncertainty hides the low direction');
    assert.equal(await pick(), 0xffffffff, 'minimum uncertainty applies to picking');
    await pose([0, 0, 1]);
    assert.equal(await visible(), true, 'minimum uncertainty keeps the high direction');
    assert.equal(await pick(), 0, 'high-uncertainty Gaussian remains pickable');
    await page.getByText('Show all directions', { exact: true }).click();
    await pose([0, 0, -1]);

    await threshold('max-view-uncertainty', 0.5);
    assert.equal(await visible(), true, 'low uncertainty direction');
    assert.equal(await pick(), 0, 'visible Gaussian is pickable');
    await pose([0, 0, 1]);
    assert.equal(await visible(), false, 'high uncertainty direction');
    assert.equal(await pick(), 0xffffffff, 'filtered Gaussian is not pickable');

    // The fallback is a view policy, with the same opacity and geometry as the
    // original Gaussian. Exercise the actual dropdown and color-picker events.
    await page.locator('#outside-threshold-mode').click();
    await page.getByText('Use color', { exact: true }).click();
    assert.equal(await page.locator('#outside-threshold-color').isVisible(), true);
    await fallbackColor([1, 0, 0]);
    const red = await pixel();
    assert.ok(red[0] > 100 && red[1] === 0 && red[2] === 0 && red[3] > 0, 'out-of-range Gaussian uses the chosen RGB');
    assert.equal(await pick(), 0, 'fallback geometry remains pickable');

    await threshold('max-view-uncertainty', 1);
    const inside = await pixel();
    await outsideMode('hide');
    const original = await pixel();
    assert.deepEqual(inside, original, 'in-range appearance is unchanged by color mode');
    assert.equal(red[3], original[3], 'fallback retains original opacity');
    await threshold('max-view-uncertainty', 0.5);
    assert.equal((await pixel())[3], 0, 'Hide still removes out-of-range opacity');
    await outsideMode('color');
    await fallbackColor([0, 0, 0]);
    const black = await pixel();
    assert.deepEqual(black.slice(0, 3), [0, 0, 0], 'black fallback is valid');
    assert.equal(black[3], original[3], 'black geometry retains alpha');
    assert.equal(await pick(), 0, 'black fallback remains pickable');
    await fallbackColor([1, 1, 1]);
    const white = await pixel();
    assert.ok(white[0] > original[0], 'white fallback replaces learned appearance');
    assert.equal(white[3], original[3]);

    await fallbackColor([0.25, 0.5, 0.75]);
    const custom = await pixel();
    for (let channel = 0; channel < 3; channel++) {
        assert.ok(Math.abs(custom[channel] - custom[3] * [0.25, 0.5, 0.75][channel]) <= 2, 'chosen display RGB is preserved');
    }
    await page.evaluate(() => {
        const scene = window.scene;
        const splat = scene.events.invoke('selection');
        splat.brightness = 0.3;
        splat.saturation = 0;
        scene.events.fire('camera.setTonemapping', 'aces');
    });
    assert.deepEqual(await pixel(), custom, 'color grading and tone mapping cannot tint the fallback');
    await page.evaluate(() => { window.scene.events.invoke('selection').transparency = 0.5; });
    assert.ok(Math.abs((await pixel())[3] - original[3] * 0.5) <= 1, 'global transparency still applies');
    await page.evaluate(() => {
        const scene = window.scene;
        const splat = scene.events.invoke('selection');
        splat.transparency = 1;
        splat.brightness = 0;
        splat.saturation = 1;
        scene.events.fire('camera.setTonemapping', 'linear');
    });
    await page.getByText('Show all directions', { exact: true }).click();
    assert.equal(await page.evaluate(() => window.scene.events.invoke('selection').outsideThresholdMode), 'color', 'range reset keeps the display policy');
    const colorDocs = await page.evaluate(() => {
        const splat = window.scene.events.invoke('selection');
        const saved = JSON.parse(JSON.stringify(splat.docSerialize()));
        splat.outsideThresholdMode = 'hide';
        splat.outsideThresholdColor = new splat.outsideThresholdColor.constructor(1, 1, 1);
        splat.docDeserialize(saved);
        const restored = [splat.outsideThresholdMode, splat.outsideThresholdColor.toArray([], 0, false)];
        delete saved.outsideThresholdMode;
        delete saved.outsideThresholdColor;
        splat.docDeserialize(saved);
        return { restored, legacy: [splat.outsideThresholdMode, splat.outsideThresholdColor.toArray([], 0, false)] };
    });
    assert.deepEqual(colorDocs.restored, ['color', [0.25, 0.5, 0.75]], 'display policy survives project JSON');
    assert.deepEqual(colorDocs.legacy, ['hide', [1, 1, 1]], 'older projects keep Hide with a white default color');
    await page.getByText('Show all directions', { exact: true }).click();
    assert.equal(await visible(), true, 'reset restores the Gaussian');

    await pose(obs);
    await threshold('max-view-evidence', 2);
    assert.equal(await visible(), false, 'maximum evidence hides the strongly supported direction');
    assert.equal(await pick(), 0xffffffff, 'maximum evidence applies to picking');
    await threshold('max-view-evidence', 3.5);
    assert.equal(await visible(), true, 'evidence inside the upper bound remains visible');
    await threshold('min-view-uncertainty', 0.8);
    await threshold('max-view-uncertainty', 0.9);
    await threshold('min-view-evidence', 2.5);
    assert.equal(await visible(), true, 'both finite attribute ranges combine');
    await pose(obs.map(v => -v));
    assert.equal(await visible(), false, 'the opposite direction fails the ranges');

    await threshold('max-view-uncertainty', 0.2);
    assert.equal(await page.locator('#min-view-uncertainty input').inputValue(), '0.2');
    await threshold('min-view-uncertainty', 0.8);
    assert.equal(await page.locator('#max-view-uncertainty input').inputValue(), '0.8');
    await threshold('max-view-evidence', 2);
    assert.equal(await page.locator('#min-view-evidence input').inputValue(), '2');
    await threshold('min-view-evidence', 5);
    assert.equal(await page.locator('#max-view-evidence input').inputValue(), '5');

    const restored = await page.evaluate(() => {
        const splat = window.scene.events.invoke('selection');
        splat.minViewUncertainty = 0.6;
        splat.maxViewUncertainty = 0.9;
        splat.minViewEvidence = 1.5;
        splat.maxViewEvidence = 5.5;
        const saved = JSON.parse(JSON.stringify(splat.docSerialize()));
        splat.minViewUncertainty = 1;
        splat.minViewEvidence = 100;
        splat.docDeserialize(saved);
        const range = [splat.minViewUncertainty, splat.maxViewUncertainty, splat.minViewEvidence, splat.maxViewEvidence];
        delete saved.minViewUncertainty;
        delete saved.maxViewEvidence;
        splat.docDeserialize(saved);
        const legacy = [splat.minViewUncertainty, splat.maxViewUncertainty, splat.minViewEvidence, splat.maxViewEvidence];
        return { range, legacy };
    });
    assert.deepEqual(restored.range, [0.6, 0.9, 1.5, 5.5], 'all four limits survive project JSON');
    assert.deepEqual(restored.legacy, [0, 0.9, 1.5, null], 'older projects have unrestricted new bounds');
    await page.getByText('Show all directions', { exact: true }).click();
    assert.deepEqual(await page.evaluate(() => {
        const splat = window.scene.events.invoke('selection');
        return [splat.minViewUncertainty, splat.maxViewUncertainty, splat.minViewEvidence, splat.maxViewEvidence];
    }), [0, 1, 0, null], 'reset clears all four limits');

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
    assert.equal(await page.locator('#min-view-uncertainty input').isEditable(), false);
    assert.equal(await page.locator('#min-view-evidence input').isEditable(), false);
    assert.equal(await page.locator('#max-view-evidence input').isEditable(), false);
    assert.equal(await page.locator('#outside-threshold-mode').evaluate(el => el.ui.enabled), false);
    assert.equal(await page.locator('#outside-threshold-color').isVisible(), false);

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
    await threshold('max-view-uncertainty', 1);
    await threshold('max-view-evidence', 0);
    assert.equal(await visible(), true, 'zero evidence implies uncertainty one and remains included');
    await threshold('min-view-uncertainty', 1);
    await threshold('max-view-evidence', 4);
    await page.evaluate(() => {
        const scene = window.scene;
        const splat = scene.events.invoke('selection');
        const V = scene.camera.mainCamera.getPosition().constructor;
        const eye = splat.worldTransform.transformPoint(new V(4, 0, 5));
        const target = splat.worldTransform.transformPoint(new V(4, 0, 0));
        scene.camera.setPose(eye, target, 0);
        scene.camera.onUpdate(0);
        scene.forceRender = true;
    });
    assert.equal(await visible(), true, 'uncertainty exactly one passes a minimum of one');
    await page.getByText('Show all directions', { exact: true }).click();
    await pose([0, 0, -1]);
    const distribution = await histogram(69);
    assert.ok(Math.abs(distribution.min - 0.0001) < 1e-10, 'float32 SH evaluation preserves the near-zero value');
    assert.deepEqual({ ...distribution, min: 0.0001 }, {
        min: 0.0001, max: 1, total: 5, zero: 0, one: 3,
        first: 1, last: 4, selectedFirst: 0, firstBinXs: [2]
    });
    const evidenceDistribution = await histogram(70);
    assert.equal(evidenceDistribution.zero, 2, 'exact evidence zeros');
    assert.equal(evidenceDistribution.first, 3, 'near-zero evidence is not an exact zero');
    const onScreen = await histogram(69, true);
    assert.ok(onScreen.total < 5 && onScreen.total > 0, 'on-screen filter applies');
    await page.evaluate(() => {
        const splat = window.scene.events.invoke('selection');
        splat.minViewUncertainty = 0.1;
        splat.maxViewUncertainty = 0.25;
        splat.minViewEvidence = 2;
        splat.maxViewEvidence = 2.5;
        splat.outsideThresholdMode = 'color';
    });
    assert.deepEqual(await histogram(69), distribution, 'distribution is independent of opacity thresholds');

    await page.evaluate(() => window.scene.events.fire('statusBar.panelChanged', 'splatData'));
    await page.locator('[data-property="view-uncertainty"]').click();
    await page.waitForFunction(() => document.querySelector('#histogram-exact-one').textContent === 'Exactly 1: 3 (60.0%)');
    assert.equal(await page.locator('#histogram-value-total').textContent(), 'Total: 5');
    assert.equal(await page.locator('#histogram-exact-zero').textContent(), 'Exactly 0: 0 (0.0%)');
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
    // Near-grazing observations must not leak across the local tangent plane,
    // even when the query direction is still close to the training direction.
    const grazing = [0.984807753, 0, 0.173648178];
    await importPly(makeSidedPly([0, 4], grazing));
    for (const rotate of [false, true]) {
        await pose(grazing, rotate);
        await threshold('min-view-evidence', 1);
        assert.equal(await visible(), true, 'grazing training view retains its full evidence');
        await pose([0, 0, 1], rotate);
        assert.equal(await visible(), false, 'novel normal direction has less evidence');
        await pose([grazing[0], 0, -grazing[2]], rotate);
        assert.equal(await visible(), false, 'opposite surface side has zero evidence');
        const backside = await histogram(70);
        assert.equal(backside.max, 0);
        assert.equal(backside.zero, 2);
        assert.equal((await histogram(69)).min, 1, 'unobserved side has maximum uncertainty');
    }
    await importPly(makeSidedPly([0, 4], grazing, [0, 0, 1], 2));
    await pose(grazing.map(v => -v));
    await threshold('min-view-evidence', 1.9);
    assert.equal(await visible(), true, 'observations on the second side retain independent evidence');
    assert.ok(Math.abs((await histogram(69)).max - 0.8) < 1e-6, 'opposite uncertainty bank is selected');
    assert.deepEqual(errors, [], 'browser/GPU errors');
    console.log('Browser checks passed: Hide/color display modes, RGB/opacity preservation, project compatibility, picking, four ranges, histograms, camera/rotation/orthographic views, ordinary PLY.');
} finally {
    await browser.close();
}

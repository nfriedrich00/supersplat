import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryFileSystem, MemoryReadFileSystem } from '@playcanvas/splat-transform';
import { Color, Mat4, Vec3 } from 'playcanvas';

import { loadGSplatData } from '../src/io/read/loader.ts';
import { writeSplatFile } from '../src/splat-serialize.ts';
import { coefficientNames, packViewDependent, viewDependentPrefixes } from '../src/view-dependent.ts';
import { makePly, basis, kernelSH, evaluate } from './view-dependent-fixture.mjs';

const read = async (bytes, reorder = true) => {
    const fs = new MemoryReadFileSystem();
    fs.set('fixture.ply', bytes);
    return (await loadGSplatData('fixture.ply', fs, !reorder)).gsplatData;
};

test('PLY reordering retains the scalar fields on their original Gaussians', async () => {
    const data = await read(makePly([2, -1, 0]));
    const packed = packViewDependent(data, 4);
    assert.equal(packed.layers.length, 8);
    for (let i = 0; i < data.numSplats; i++) {
        const weight = data.getProp('x')[i] + 3;
        const sh = Array.from({ length: 16 }, (_, c) => packed.layers[4 + (c >> 2)][i * 4 + (c & 3)]);
        for (const d of [[1, 0, 0], [0, 0, -1], [0.6, 0.8, 0]]) {
            const expected = weight * ((1 + d[2]) / 2) ** 3;
            assert.ok(Math.abs(evaluate(sh, d) - expected) < 1e-6);
            assert.ok(expected <= packed.evidenceMax);
        }
    }
    for (const layer of packed.layers) assert.deepEqual(Array.from(layer.slice(12)), [0, 0, 0, 0]);
});

test('ordinary PLYs, independent fields, incomplete fields, and non-finite SH', async () => {
    const ordinary = await read(makePly([0], []));
    assert.equal(packViewDependent(ordinary, 1).layers.length, 0);
    for (const prefix of viewDependentPrefixes) {
        const one = await read(makePly([0], [prefix]));
        assert.equal(packViewDependent(one, 1).layers.length, 4);
        one.getProp(`${prefix}1`)[0] = NaN;
        assert.throws(() => packViewDependent(one, 1), /Non-finite/);
    }
    ordinary.addProp('appearance_uncertainty_sh_0', new Float32Array(1));
    assert.throws(() => packViewDependent(ordinary, 1), /all 16/);
});

test('uncompressed PLY export preserves and rotates both scalar SH fields', async () => {
    const data = await read(makePly([0]));
    data.addProp('state', new Uint8Array(1));
    const turn = new Mat4().setFromEulerAngles(23, 51, -17);
    const loadFlip = new Mat4().setFromEulerAngles(0, 0, 180);
    const world = new Mat4().mul2(loadFlip, turn);
    const splat = {
        splatData: data,
        entity: { getWorldTransform: () => world },
        transformTexture: { getSource: () => new Uint16Array(1) },
        tintClr: new Color(1, 1, 1), temperature: 0, saturation: 1,
        brightness: 0, blackPoint: 0, whitePoint: 1, transparency: 1
    };
    for (const settings of [{}, { keepWorldTransform: true, keepColorTint: true }]) {
        const fs = new MemoryFileSystem();
        await writeSplatFile([splat], settings, 'ply', 'output.ply', {}, fs);
        const out = await read(fs.results.get('output.ply'));
        for (const prefix of viewDependentPrefixes) {
            const inputSH = coefficientNames(prefix).map(name => data.getProp(name)[0]);
            const outputSH = coefficientNames(prefix).map(name => out.getProp(name)[0]);
            for (const d of [[1, 0, 0], [0, 0, 1], [0.6, 0.8, 0]]) {
                const transformed = settings.keepWorldTransform ? d : Object.values(turn.transformVector(new Vec3(d))).slice(0, 3);
                assert.ok(Math.abs(evaluate(outputSH, transformed) - evaluate(inputSH, d)) < 2e-6);
            }
        }
    }
});

test('degree-3 coefficients reproduce the observation kernel for oblique views', () => {
    const obs = [0.3, -0.4, Math.sqrt(0.75)];
    const sh = kernelSH(obs, 10);
    for (let i = 0; i < 50; i++) {
        const z = 1 - 2 * (i + 0.5) / 50;
        const r = Math.sqrt(1 - z * z);
        const d = [r * Math.cos(i * 2.4), r * Math.sin(i * 2.4), z];
        const dot = d.reduce((sum, v, c) => sum + v * obs[c], 0);
        assert.ok(Math.abs(evaluate(sh, d) - 10 * ((1 + dot) / 2) ** 3) < 1e-12);
    }
    assert.equal(basis([0, 0, 1]).length, 16);
});

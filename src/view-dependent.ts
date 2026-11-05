import {
    ADDRESS_CLAMP_TO_EDGE, FILTER_NEAREST, GraphicsDevice, GSplatData, PIXELFORMAT_RGBA32F,
    ShaderMaterial, Texture
} from 'playcanvas';

const uncertaintyPrefix = 'appearance_uncertainty_sh_';
const evidencePrefix = 'observation_evidence_sh_';
const viewDependentPrefixes = [uncertaintyPrefix, evidencePrefix];
const coefficientNames = (prefix: string) => Array.from({ length: 16 }, (_, i) => `${prefix}${i}`);

// Four RGBA32F array layers per scalar SH field. Array layers keep the same
// per-Gaussian UV as the renderer, without consuming eight texture samplers or
// increasing the maximum 2D texture dimensions.
const packViewDependent = (data: GSplatData, capacity: number) => {
    const layers: Float32Array[] = [];
    const offsets = [-1, -1];
    let evidenceMax = 0;
    viewDependentPrefixes.forEach((prefix, field) => {
        const names = coefficientNames(prefix);
        const columns = names.map(name => data.getProp(name) as Float32Array);
        const present = columns.filter(Boolean).length;
        if (present === 0) return;
        if (present !== 16) {
            throw new Error(`Incomplete degree-3 SH field ${prefix}: expected all 16 coefficients.`);
        }
        offsets[field] = layers.length;
        const packed = Array.from({ length: 4 }, () => new Float32Array(capacity * 4));
        for (let i = 0; i < data.numSplats; i++) {
            let bound = 0;
            for (let l = 0; l <= 3; l++) {
                let normSquared = 0;
                for (let c = l * l; c < (l + 1) * (l + 1); c++) {
                    const value = columns[c][i];
                    if (!Number.isFinite(value)) {
                        throw new Error(`Non-finite ${names[c]} at Gaussian ${i}.`);
                    }
                    packed[c >> 2][i * 4 + (c & 3)] = value;
                    normSquared += value * value;
                }
                // Addition theorem + Cauchy-Schwarz: an upper bound over ALL
                // directions, not just the current camera or a sampled sphere.
                bound += Math.sqrt(normSquared * (2 * l + 1) / (4 * Math.PI));
            }
            if (field === 1) evidenceMax = Math.max(evidenceMax, bound);
        }
        layers.push(...packed);
    });
    return { layers, uncertaintyLayer: offsets[0], evidenceLayer: offsets[1], evidenceMax: Math.max(1, Math.ceil(evidenceMax)) };
};

class ViewDependentData {
    texture: Texture;
    uncertaintyLayer: number;
    evidenceLayer: number;
    evidenceMax: number;

    constructor(device: GraphicsDevice, data: GSplatData, width: number, height: number) {
        const packed = packViewDependent(data, width * height);
        this.uncertaintyLayer = packed.uncertaintyLayer;
        this.evidenceLayer = packed.evidenceLayer;
        this.evidenceMax = packed.evidenceMax;
        if (packed.layers.length) {
            this.texture = new Texture(device, {
                name: 'viewDependentSH',
                width,
                height,
                arrayLength: packed.layers.length,
                format: PIXELFORMAT_RGBA32F,
                // The engine supports typed array layers; its public levels
                // type currently only lists Uint8Array[][] for array textures.
                levels: [packed.layers] as any,
                mipmaps: false,
                minFilter: FILTER_NEAREST,
                magFilter: FILTER_NEAREST,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });
        }
    }

    get shaderKey() {
        return `${this.uncertaintyLayer}_${this.evidenceLayer}`;
    }

    getShaderDefines() {
        return new Map([
            ['VIEW_UNCERTAINTY_LAYER', `${this.uncertaintyLayer}`],
            ['VIEW_EVIDENCE_LAYER', `${this.evidenceLayer}`]
        ]);
    }

    configureMaterial(material: ShaderMaterial) {
        this.getShaderDefines().forEach((value, key) => material.setDefine(key, value));
        if (this.texture) material.setParameter('viewDependentSH', this.texture);
    }

    destroy() {
        this.texture?.destroy();
    }
}

export { ViewDependentData, coefficientNames, packViewDependent, viewDependentPrefixes };

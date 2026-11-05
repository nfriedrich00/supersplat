// Exporter's real SH basis; independent closed-form cubic kernels are used as
// the oracle in the browser tests (rather than comparing two SH evaluators).
export const basis = ([x, y, z]) => [
    0.28209479177387814, -0.4886025119029199 * y, 0.4886025119029199 * z, -0.4886025119029199 * x,
    1.0925484305920792 * x * y, -1.0925484305920792 * y * z, 0.31539156525252005 * (2 * z * z - x * x - y * y),
    -1.0925484305920792 * x * z, 0.5462742152960396 * (x * x - y * y),
    -0.5900435899266435 * y * (3 * x * x - y * y), 2.890611442640554 * x * y * z,
    -0.4570457994644658 * y * (4 * z * z - x * x - y * y), 0.3731763325901154 * z * (2 * z * z - 3 * x * x - 3 * y * y),
    -0.4570457994644658 * x * (4 * z * z - x * x - y * y), 1.445305721320277 * z * (x * x - y * y),
    -0.5900435899266435 * x * (x * x - 3 * y * y)
];
export const evaluate = (sh, direction) => basis(direction).reduce((v, b, i) => v + b * sh[i], 0);
export const kernelSH = (observation, weight) => basis(observation).map((b, i) =>
    weight * b * Math.PI * (i === 0 ? 1 : i < 4 ? 3 / 5 : i < 9 ? 1 / 5 : 1 / 35));

export const makePly = (xs = [0], prefixes = ['appearance_uncertainty_sh_', 'observation_evidence_sh_'], observation = [0, 0, 1]) => {
    const standard = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    const names = [...standard, ...prefixes.flatMap(prefix => Array.from({ length: 16 }, (_, i) => `${prefix}${i}`))];
    const header = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${xs.length}\n${names.map(name => `property float ${name}\n`).join('')}end_header\n`);
    const bytes = new Uint8Array(header.length + xs.length * names.length * 4);
    bytes.set(header);
    const view = new DataView(bytes.buffer);
    xs.forEach((x, row) => {
        const values = [x, 0, 0, 1, 1, 1, 4, -1.2, -0.8, -1.5, Math.cos(0.2), 0, 0, Math.sin(0.2)];
        prefixes.forEach(prefix => {
            const sh = prefix.startsWith('appearance') ? Array(16).fill(0) : kernelSH(observation, x + 3);
            if (prefix.startsWith('appearance')) {
                sh[0] = 0.5 / 0.28209479177387814;
                sh[2] = 0.4 / 0.4886025119029199;
            }
            values.push(...sh);
        });
        values.forEach((value, col) => view.setFloat32(header.length + (row * names.length + col) * 4, value, true));
    });
    return bytes;
};

// Near-endpoint values share histogram bins with the exact endpoints. The
// summary must count only the clamped zeros/ones, not the entire edge bins.
export const makeHistogramPly = () => {
    const uncertainty = [-0.2, 0, 0.0001, 0.9999, 1.2, 0, 1.2];
    const evidence = [-0.2, 0, 0.0001, 2, 3, 0, 3];
    const bytes = makePly(uncertainty.map((_, i) => i));
    const end = Buffer.from(bytes).indexOf('end_header\n') + 'end_header\n'.length;
    const names = new TextDecoder().decode(bytes.subarray(0, end)).split('\n')
    .filter(line => line.startsWith('property ')).map(line => line.split(' ').at(-1));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < uncertainty.length; i++) {
        for (const [prefix, values] of [['appearance_uncertainty_sh_', uncertainty], ['observation_evidence_sh_', evidence]]) {
            for (let c = 0; c < 16; c++) {
                const value = c === 0 ? values[i] / 0.28209479177387814 : 0;
                view.setFloat32(end + (i * names.length + names.indexOf(`${prefix}${c}`)) * 4, value, true);
            }
        }
    }
    return bytes;
};

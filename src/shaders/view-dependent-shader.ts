// Same real SH basis/order as gaussian-lic's real_sh_basis_degree_three.
// These are scalar values: no RGB DC offset (+0.5), sigmoid or SH quantization.
const viewDependentShader = /* glsl */`
#if VIEW_UNCERTAINTY_LAYER >= 0 || VIEW_EVIDENCE_LAYER >= 0
uniform highp sampler2DArray viewDependentSH;
uniform float maxViewUncertainty;
uniform float minViewEvidence;

float evaluateViewSH(ivec2 uv, int layer, vec3 d) {
    float x = d.x, y = d.y, z = d.z;
    float xx = x*x, yy = y*y, zz = z*z;
    vec4 b0 = vec4(0.28209479177387814, -0.4886025119029199*y,
                  0.4886025119029199*z, -0.4886025119029199*x);
    vec4 b1 = vec4(1.0925484305920792*x*y, -1.0925484305920792*y*z,
                  0.31539156525252005*(2.0*zz-xx-yy), -1.0925484305920792*x*z);
    vec4 b2 = vec4(0.5462742152960396*(xx-yy), -0.5900435899266435*y*(3.0*xx-yy),
                  2.890611442640554*x*y*z, -0.4570457994644658*y*(4.0*zz-xx-yy));
    vec4 b3 = vec4(0.3731763325901154*z*(2.0*zz-3.0*xx-3.0*yy),
                  -0.4570457994644658*x*(4.0*zz-xx-yy),
                  1.445305721320277*z*(xx-yy), -0.5900435899266435*x*(xx-3.0*yy));
    return dot(texelFetch(viewDependentSH, ivec3(uv, layer), 0), b0) +
           dot(texelFetch(viewDependentSH, ivec3(uv, layer+1), 0), b1) +
           dot(texelFetch(viewDependentSH, ivec3(uv, layer+2), 0), b2) +
           dot(texelFetch(viewDependentSH, ivec3(uv, layer+3), 0), b3);
}
#endif

bool viewDependentVisible(ivec2 uv, vec3 viewCenter, mat4 modelView, bool isOrtho) {
    #if VIEW_UNCERTAINTY_LAYER >= 0 || VIEW_EVIDENCE_LAYER >= 0
        if (maxViewUncertainty >= 1.0 && minViewEvidence <= 0.0) return true;
        // gaussian minus camera, in the ORIGINAL PLY coordinate frame. The
        // inverse also handles nonuniform entity/palette scales correctly.
        vec3 ray = inverse(mat3(modelView)) * (isOrtho ? vec3(0.0, 0.0, -1.0) : viewCenter);
        vec3 direction = ray / max(length(ray), 1e-8);
        #if VIEW_UNCERTAINTY_LAYER >= 0
            if (maxViewUncertainty < 1.0 &&
                clamp(evaluateViewSH(uv, VIEW_UNCERTAINTY_LAYER, direction), 0.0, 1.0) > maxViewUncertainty) return false;
        #endif
        #if VIEW_EVIDENCE_LAYER >= 0
            if (minViewEvidence > 0.0 &&
                max(evaluateViewSH(uv, VIEW_EVIDENCE_LAYER, direction), 0.0) < minViewEvidence) return false;
        #endif
    #endif
    return true;
}
`;

export { viewDependentShader };

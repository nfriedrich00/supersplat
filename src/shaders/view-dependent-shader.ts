// Same real SH basis/order as gaussian-lic's real_sh_basis_degree_three.
// These are scalar values: no RGB DC offset (+0.5), sigmoid or SH quantization.
const viewDependentShader = /* glsl */`
#ifndef VIEW_UNCERTAINTY_LAYER
#define VIEW_UNCERTAINTY_LAYER -1
#endif
#ifndef VIEW_EVIDENCE_LAYER
#define VIEW_EVIDENCE_LAYER -1
#endif
#ifndef VIEW_OPPOSITE_UNCERTAINTY_LAYER
#define VIEW_OPPOSITE_UNCERTAINTY_LAYER -1
#endif
#ifndef VIEW_OPPOSITE_EVIDENCE_LAYER
#define VIEW_OPPOSITE_EVIDENCE_LAYER -1
#endif
#ifndef VIEW_EVIDENCE_NORMAL_LAYER
#define VIEW_EVIDENCE_NORMAL_LAYER -1
#endif

// Display policy is separate from the appearance confidence test. The color
// mode preserves the existing Gaussian geometry and opacity when it fails.
uniform int outsideThresholdMode;    // 0: hide, 1: fallback color
uniform vec3 outsideThresholdColor;

#if VIEW_UNCERTAINTY_LAYER >= 0 || VIEW_EVIDENCE_LAYER >= 0
uniform highp sampler2DArray viewDependentSH;
uniform float minViewUncertainty;
uniform float maxViewUncertainty;
uniform float minViewEvidence;
uniform float maxViewEvidence;

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

bool useOppositeViewSide(ivec2 uv, vec3 direction) {
    #if VIEW_EVIDENCE_NORMAL_LAYER >= 0
        vec3 normal = texelFetch(viewDependentSH, ivec3(uv, VIEW_EVIDENCE_NORMAL_LAYER), 0).xyz;
        return dot(normal, direction) < 0.0;
    #else
        return false;
    #endif
}

float evaluateViewEvidence(ivec2 uv, vec3 direction) {
    #if VIEW_EVIDENCE_LAYER >= 0
        int layer = VIEW_EVIDENCE_LAYER;
        #if VIEW_OPPOSITE_EVIDENCE_LAYER >= 0
            if (useOppositeViewSide(uv, direction)) layer = VIEW_OPPOSITE_EVIDENCE_LAYER;
        #endif
        return max(evaluateViewSH(uv, layer, direction), 0.0);
    #else
        return 0.0;
    #endif
}

float evaluateViewUncertainty(ivec2 uv, vec3 direction) {
    #if VIEW_UNCERTAINTY_LAYER >= 0
        int layer = VIEW_UNCERTAINTY_LAYER;
        #if VIEW_OPPOSITE_UNCERTAINTY_LAYER >= 0
            if (useOppositeViewSide(uv, direction)) layer = VIEW_OPPOSITE_UNCERTAINTY_LAYER;
        #endif
        float uncertainty = clamp(evaluateViewSH(uv, layer, direction), 0.0, 1.0);
        #if VIEW_EVIDENCE_LAYER >= 0
            // The defining equation gives U=1 exactly when N=0. Independent
            // degree-three fits of U and N can violate that endpoint near a
            // sharp observed/unobserved boundary, so preserve it explicitly.
            if (evaluateViewEvidence(uv, direction) <= 0.0) uncertainty = 1.0;
        #endif
        return uncertainty;
    #else
        return 1.0;
    #endif
}

vec3 viewDependentDirection(vec3 viewCenter, mat4 modelView, bool isOrtho) {
    // gaussian minus camera in the original PLY frame, including nonuniform
    // entity/palette scales. Orthographic cameras have parallel viewing rays.
    vec3 ray = inverse(mat3(modelView)) * (isOrtho ? vec3(0.0, 0.0, -1.0) : viewCenter);
    return ray / max(length(ray), 1e-8);
}
#endif

bool viewDependentVisible(ivec2 uv, vec3 viewCenter, mat4 modelView, bool isOrtho) {
    #if VIEW_UNCERTAINTY_LAYER >= 0 || VIEW_EVIDENCE_LAYER >= 0
        if (minViewUncertainty <= 0.0 && maxViewUncertainty >= 1.0 &&
            minViewEvidence <= 0.0 && maxViewEvidence < 0.0) return true;
        vec3 direction = viewDependentDirection(viewCenter, modelView, isOrtho);
        #if VIEW_UNCERTAINTY_LAYER >= 0
            if (minViewUncertainty > 0.0 || maxViewUncertainty < 1.0) {
                float uncertainty = evaluateViewUncertainty(uv, direction);
                if (uncertainty < minViewUncertainty || uncertainty > maxViewUncertainty) return false;
            }
        #endif
        #if VIEW_EVIDENCE_LAYER >= 0
            if (minViewEvidence > 0.0 || maxViewEvidence >= 0.0) {
                float evidence = evaluateViewEvidence(uv, direction);
                if (evidence < minViewEvidence || (maxViewEvidence >= 0.0 && evidence > maxViewEvidence)) return false;
            }
        #endif
    #endif
    return true;
}
`;

export { viewDependentShader };

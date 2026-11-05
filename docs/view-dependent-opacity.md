# View-dependent opacity

This fork adds four per-map viewing controls to the scene manager, below Transform.
Select a loaded PLY to show them:

- **Min uncertainty**: mark a Gaussian as out of range when its directional uncertainty is below this value.
  Range 0–1; raising it isolates more uncertain Gaussians.
- **Max uncertainty**: mark a Gaussian as out of range when its directional uncertainty exceeds this value.
  Range 0–1; lowering it is stricter.
- **Min evidence**: mark a Gaussian as out of range when its directional observation evidence is below this value.
  Raising it is stricter. The slider range adapts to the map; the numeric field also accepts larger values.
- **Max evidence**: mark a Gaussian as out of range when its directional evidence exceeds this value.
  Lowering it isolates weakly observed Gaussians. Both evidence sliders adapt to the map.
- **Show all directions** restores uncertainty 0–1 and evidence 0–unlimited.
  The unlimited evidence cap is displayed at a conservative upper bound for the map.

Both ranges include their endpoints. Moving one limit past the other moves the
opposite limit to match, so each range stays valid. All four limits are saved
in projects; older projects default to minimum uncertainty 0 and no evidence cap.

The two ranges combine with AND: a Gaussian must pass both to keep its normal
appearance. **Out of range** defaults to **Hide**, which culls failing Gaussians.
Choose **Use color** to retain those Gaussians and select their **Fallback color**
(white by default). White works against a black background; black works against
a white background. This replaces RGB only, preserving the existing opacity,
global transparency, shape, transforms, depth and sorting. Normal Gaussian
falloff still blends the color with the background. Editor selection/lock
highlights remain available. The fallback bypasses appearance SH, color grading
and tone mapping so the selected display color is used directly.

Color-mode Gaussians remain pickable and contribute to depth; their centers use
the same fallback color. **Show all directions** resets the ranges while keeping
the chosen display mode and color. These settings are saved per map in projects;
older projects retain the default Hide behavior. This is a SuperSplat display
choice: it separates uncertain appearance from geometry already present in the
map. It neither infers unseen geometry nor establishes geometric confidence;
those concern mapping and geometric evidence.

The SH values are evaluated on the GPU as the camera moves, including in
picking/depth passes and the centers overlay. The appearance “SH bands” setting does not reduce these
scalar fields: they always use all degree-3 coefficients. Missing fields disable
the corresponding control; ordinary PLY files continue to render normally.

## Run with Docker

From this checkout:

```sh
cd /home/nils241/Uni/MAI/MA/docker_ws/supersplat
docker compose up --build
```

Open <http://localhost:3000>. This Dockerfile copies and builds the local source.
The older Dockerfile in `/home/nils241/supersplat` clones upstream PlayCanvas and
therefore will not include these changes. The fork stays on the existing
v2.32.3 checkout and its locked dependencies; an upgrade is not needed for this feature.

After changing the renderer, rebuild **and recreate** the container; building
an image alone does not update the already running process. Save any open
project first, then run `docker compose up -d --build --force-recreate supersplat`.
Each build now has its own service-worker cache, even though the upstream
package version remains unchanged. Reload after the new worker activates;
existing open scenes are not reloaded automatically. If an older worker is
still controlling the page, clear this site's cached files or reopen the
viewer in a private window.

For a sided map, looking only at `observation_evidence_sh_*` is incorrect: the
opposite field may contain all observations of a Gaussian. For example,
`gz_0917_facade_2_4` has 38.904% empty primary fields but only 7.958% with no
observations in either field. A viewer that ignores the opposite fields makes
those two situations indistinguishable.

Import this **normal-color** map:

```text
/home/nils241/Uni/MAI/MA/docker_ws/coco/results_fg_1022_urz_ext_4_1/gaussian-lic/fg_1022_urz_ext_4_1.ply
```

For other runs, import the normal-color Gaussian map with the same SH fields.
The `_uncertainty.ply` also has the two fields, but its appearance was already
replaced with the exporter's uncertainty colors. `structure_classes.ply` and
`points3D.ply` are diagnostic point clouds rather than Gaussian maps for this UI.

Start with the defaults, then try uncertainty 0.95 or evidence 1. Move around the
map to see the direction dependence. Outside the observed trajectory, many
Gaussians will disappear under strict thresholds in Hide mode, or use the fallback
color in Use color mode. Press **F** to focus the map
if the initial camera is away from it.

## Field interpretation

The loader preserves `appearance_uncertainty_sh_0` through `_15` and
`observation_evidence_sh_0` through `_15`, including during Morton reordering.
Version-4 maps additionally contain `appearance_uncertainty_opposite_sh_0`
through `_15`, `observation_evidence_opposite_sh_0` through `_15`, and
`evidence_normal_x`, `_y`, `_z`. A nonzero normal identifies a planar Gaussian:
queries with `dot(normal, direction) >= 0` use the primary SH fields; other
queries use the opposite fields. Zero normals always use the primary fields.
Both banks and the normals are required together. Earlier maps without them
retain their original single-field behavior.
Both use the real SH basis and ordering in Gaussian-LIC's
`real_sh_basis_degree_three`, including Y00. There is no color DC offset,
sigmoid, or RGB quantization. The evaluation direction is
`normalize(gaussian_center - camera_center)` in the original PLY frame, with
entity and per-Gaussian transforms accounted for. Orthographic views use parallel rays.

Uncertainty is clamped to [0, 1] after evaluation to handle ringing from the
degree-3 fit. The defining equation gives uncertainty one exactly when evidence
is zero. The viewer preserves that endpoint after evaluating the two
independently fitted SH fields, preventing low-order uncertainty leakage from
making a direction with no evidence appear confident.

Evidence is clamped to at least zero and is a directional weighted observation
count, **not** a probability. Every observation uses the nonnegative kernel
`((1 + dot(view_direction, observation_direction)) / 2)^3`, with unit maximum
at its actual observation direction. For planar Gaussians, observations are
accumulated separately on each side of the immutable PCA normal. Query-time
selection ensures an observation contributes exactly zero on the other surface
side; observations from both sides cannot cancel or contaminate one another.
The normal selects a side, but never multiplies evidence by incidence angle.

The smooth kernel is represented exactly by degree-three SH. The discontinuous
side gate is evaluated explicitly, rather than fitted into SH, so increasing SH
degree is unnecessary to prevent cross-side evidence leakage. Evidence is smooth
within each hemisphere but can jump at the tangent plane. Normal errors matter
most for grazing observations. Uncertainty still uses an approximate SH fit in
each bank; the zero-evidence endpoint remains exact in the viewer.

The total accepted observation count is
`(observation_evidence_sh_0 + observation_evidence_opposite_sh_0) / (pi * Y00)`.
This works for planar and non-planar Gaussians; non-planar opposite evidence is
zero. The additional bank and normal cost 35 floats (140 bytes) per Gaussian.
Regenerate the map and rebuild this viewer to use the new fields. An older
viewer sees only the primary bank and cannot enforce surface-side selection.
The conventional `_uncertainty.ply` RGB-SH preview approximates the complete
sided uncertainty with a single SH field; use the scalar-field controls on the
normal-color map for exact side selection.

Inspection of this run found:

- 1,801,420 Gaussians, 94 float properties, and all 32 scalar SH coefficients finite.
- 1,451,736 observed Gaussians in `view_uncertainty.json`; 349,684 unobserved.
- Total observation-count median 5, 95th percentile approximately 30, maximum approximately 40.
- On a 20,016-Gaussian sample evaluated along the six coordinate axes, raw fitted
  uncertainty ranged approximately -0.0010–1.0483; evidence approximately
  -0.0000013–35.43. These are sampled directional ranges, not global extrema.

## Distributions in Splat Data

Open **SPLAT DATA** at the bottom and select **Uncertainty (view)** or
**Evidence (view)**. These entries appear in the default property list when
the loaded map has the corresponding field; “All Properties” is not required.
Their histograms refresh after the camera settles and use the same degree-3 SH
evaluation, coordinate transforms and clamping as the opacity sliders.

Above the histogram, **Exactly 0** and **Exactly 1** show counts and percentages
for uncertainty; evidence shows **Exactly 0**. These are exact comparisons after
clamping, with no epsilon or rounding. They are counted separately from the
first/last histogram bins, which can also contain nearby non-endpoint values.
The total and endpoint counts exclude locked/deleted Gaussians, as do the other
property histograms. “On Screen Only” additionally limits them to the camera's
frustum. Opacity thresholds do not restrict the distributions, so filtered-out
Gaussians remain available for inspection.

The existing log scale, selected/unselected breakdown, bucket hover counts,
and click/drag bucket selection also work for these properties. A bucket
selection includes all values in the bucket, including nearby values; the exact
endpoint readouts are separate statistics.

## Saving and limits

Project saves retain the fields, viewing thresholds, out-of-range mode and fallback color.
Uncompressed PLY exports retain both complete scalar fields, rotating their SH
coefficients when transforms are baked, independently of the appearance SH export
degree. For sided maps they also retain and rotate the opposite fields and
transform the evidence normals. The current camera's visibility filter is not baked into geometry or
base opacity: it remains a viewing setting. The fallback is also display-only;
source appearance properties, Splat Data histograms and PLY exports keep the
original appearance. When merging multiple maps into one
PLY, only fields present in every input are retained. Export separate maps if
their attribute schemas differ.

For investigating uncertain object silhouettes, raise **Min uncertainty** while
leaving **Max uncertainty** at 1. Pair that with **Min evidence** to inspect
well-observed but uncertain regions, or lower **Max evidence** to inspect
uncertainty in weakly observed regions. The filters inspect the existing map;
they do not change the training observations or recompute uncertainty.

Compressed PLY, SOG, SPZ, SPLAT and standalone viewer exports do not preserve
these custom viewing controls. Use `.ssproj` or uncompressed `.ply` to keep them.
Original result files are not modified by moving the sliders.

The two fields require one extra RGBA32F texture array (eight layers), adding
128 bytes of GPU data per Gaussian, plus texture padding: approximately 220 MiB
for this map. The browser also retains CPU arrays. Files without the fields
allocate no additional SH texture. Filtering avoids sampling the extra texture
at the default thresholds.

## Validation

```sh
npm run build
npx tsc --noEmit
npm run lint
npm run lint:locales
npm run test:view-dependent
```

The regression tests cover binary PLY loading/reordering, missing/invalid fields,
and preservation and rotation on uncompressed export/project saves. An optional
real-browser test compares rendered visibility with the analytic observation
kernel from multiple camera directions and after entity rotation. It also checks
GPU histograms, exact endpoint counts versus nearby values, bucket selection,
locked/deleted and on-screen filtering, and orthographic evaluation. Fallback
tests cover RGB replacement, preserved opacity/transparency, picking, color
grading independence and backward-compatible project settings:

```sh
# With Playwright available and the built editor served on port 3100:
node tests/view-dependent.browser.mjs
# Override SUPERSPLAT_URL or PLAYWRIGHT_MODULE to use another server/install.
```

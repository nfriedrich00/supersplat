# View-dependent opacity

This fork adds two per-map viewing controls to the scene manager, below Transform.
Select a loaded PLY to show them:

- **Max uncertainty**: hide a Gaussian when its directional uncertainty exceeds this value.
  Range 0–1; lowering it is stricter.
- **Min evidence**: hide a Gaussian when its directional observation evidence is below this value.
  Raising it is stricter. The slider range adapts to the map; the numeric field also accepts larger values.
- **Show all directions** restores maximum uncertainty 1 and minimum evidence 0.

The two conditions combine with AND: a Gaussian must pass both. Passing Gaussians
keep their normal color and opacity; failing Gaussians are culled. The SH values
are evaluated on the GPU as the camera moves, including in picking/depth passes
and the centers overlay. The appearance “SH bands” setting does not reduce these
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
Gaussians will disappear under strict thresholds. Press **F** to focus the map
if the initial camera is away from it.

## Field interpretation

The loader preserves `appearance_uncertainty_sh_0` through `_15` and
`observation_evidence_sh_0` through `_15`, including during Morton reordering.
Both use the real SH basis and ordering in Gaussian-LIC's
`real_sh_basis_degree_three`, including Y00. There is no color DC offset,
sigmoid, or RGB quantization. The evaluation direction is
`normalize(gaussian_center - camera_center)` in the original PLY frame, with
entity and per-Gaussian transforms accounted for. Orthographic views use parallel rays.

Uncertainty is clamped to [0, 1] after evaluation to handle ringing from the
degree-3 fit. Evidence is clamped to at least zero. Evidence is a directional
weighted observation count, **not** a probability: each observation contributes
`((1 + dot(view_direction, observation_direction)) / 2)^3`. A threshold of 1
therefore means one effective directional observation. It differs from the
total observation count, which is `observation_evidence_sh_0 / (pi * Y00)`.

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

Project saves retain both the fields and the chosen viewing thresholds.
Uncompressed PLY exports retain both complete scalar fields, rotating their SH
coefficients when transforms are baked, independently of the appearance SH export
degree. The current camera's visibility filter is not baked into geometry or
base opacity: it remains a viewing setting. When merging multiple maps into one
PLY, only fields present in every input are retained. Export separate maps if
their attribute schemas differ.

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
locked/deleted and on-screen filtering, and orthographic evaluation:

```sh
# With Playwright available and the built editor served on port 3100:
node tests/view-dependent.browser.mjs
# Override SUPERSPLAT_URL or PLAYWRIGHT_MODULE to use another server/install.
```

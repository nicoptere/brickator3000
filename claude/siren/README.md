# claude/siren — the GPU side of the implicit field

`fit_siren.py` fits a SIREN signed-distance field to a GLB and writes a grid (`<out>.sdf.json` + `.sdf.bin`, model units, glTF
world frame) that the engine loads with `field: 'sdf'` + `sdfGrid` (`claude/app/tools/sdf_grid.mjs`). Design, measurements and the
reasons in `docs/IMPLICIT.md`; the papers in `docs/papers/IMPLICIT_FIELDS_AND_MESH_DENOISING.md`.

```
pip install torch scipy numpy                     # a CUDA torch on the 4090; the script falls back to CPU (slow)
python fit_siren.py ../app/models/duck.glb --omega0 30 --steps 3000 --res 128 --out out/duck
python fit_siren.py ../app/models/duck.glb --omega0 15 --steps 3000 --res 128 --out out/duck_smooth   # half the bandwidth = a smoother duck
python fit_siren.py ../app/models/duck.glb --loss sdf --out out/duck_sdfloss                         # clamped-L1 against sampled distances (robust on open meshes)
python fit_siren.py ../app/models/duck.glb --fit none --res 96 --out out/duck_raw                     # no network: the raw sampled SDF, same format

cd ../app
GRID=../siren/out/duck.sdf.json VARIANTS=rays,align,external node test/field_bench.mjs 24 models/duck.glb
```
Knobs: `--omega0` (bandwidth: lower = smoother, the denoising knob), `--width/--layers` (5 x 256 default), `--steps`, `--res`
(grid cells along the longest axis; the engine resamples trilinearly, 96-160 is plenty for 24-48 studs), `--pad`.
Validated here on CPU: both losses train, the grid round-trips into the engine (duck raw SDF: 1400 pieces / IoU .866 vs 1377 / .859
for the rays); a 400-step CPU fit is undertrained (37 % inside vs 28 %) - the quality is the GPU budget's.

# claude/paper — the illustrated write-up

`paper.tex` (+ `rounds.tex`, the curved-surface / bugs / resolution sections; `rounds2.tex`, the sideways skin, the MOC corpus, the speed work and the booklet) is the state-of-the-method document (field, kernel,
phases, post-process, motifs, SNOT, implicit fields, curved surfaces, resolution, results); the built PDF is
`docs/BRICKAGEN3000.pdf` (`-mobile`: the same with JPEG renders, a third of the size). Everything in it is generated:

```
cd claude/app && node ../paper/export_scenes.mjs <work>/data            # meshes, LDR solutions, fields, templates, motif LDRs, stats (~3 min)
cd ../paper
mkdir -p <work> && (cd <work> && npm i three)                          # three.js for the renderer
python3 figures.py <work> /path/to/ldraw /path/to/docs/omr_gallery     # plots (matplotlib) + 55 renders (render.html through Playwright/Chromium) -> <work>/fig
cd ../app && node ../paper/export_rounds.mjs <work>/data                # rounds 4-8 scenes: skins by kind, bridges, SNOT boss box, resolution pairs (~10 min)
STUDS=8,12,16,20,24,28,32,40,48 OUT=<work>/data/rd_a.json node test/resolution_bench.mjs synth:sphere synth:boxRoundEdge models/duck.glb models/dolphin.glb
STUDS=8,12,16,20,24,28,32,40,48 OUT=<work>/data/rd_b.json node test/resolution_bench.mjs models/table_baked.glb models/bieder_chair.glb   # ~25 min together
node ../paper/auto_candidates.mjs <work>/data/auto_candidates.json      # the automatic stud count on every test model
cd ../paper && python3 figures_rounds.py <work> /path/to/ldraw          # the rate-distortion plot + 21 renders
cd ../app && node ../paper/export_mocs.mjs <work>/data                  # rounds 10-13: the sideways-skin pair + the library stats (~1 min)
cd ../app && OUT=<work>/data/hen16.json node test/run.mjs models/hen.glb 16          # a piece list for the booklet figure
cd ../app && node test/booklet_shoot.mjs <work>/data/hen16.json 18,16,64 Hen <work>/data/booklet 16
cd <work>/data/booklet && for p in 1 5 18 19; do pdftoppm -f $p -l $p -r 110 -png -singlefile booklet.pdf pg$p; done
cd claude/paper && python3 figures_mocs.py <work> /path/to/ldraw        # 2 renders, 2 plots, the 4 booklet pages
cp paper.tex rounds.tex rounds2.tex <work> && cd <work> && pdflatex paper.tex && pdflatex paper.tex
```
`ldraw_mesh.py` is a small LDraw (.dat/.ldr/.mpd) -> triangle-soup reader with LDConfig and direct colours; `render.html` + `shoot.py`
render any scene JSON (triangle soups, engine frame) with flat shading, feature edges and a soft shadow. Needs: node, python3 with
numpy / matplotlib / playwright (+ `playwright install chromium`), pdflatex with mathpazo, tikz, booktabs, subcaption.

# claude/paper — the illustrated write-up

`paper.tex` is the state-of-the-method document (field, kernel, phases, post-process, motifs, SNOT, implicit fields, results);
the built PDF is `docs/BRICKATOR.pdf`. Everything in it is generated:

```
cd claude/app && node ../paper/export_scenes.mjs <work>/data            # meshes, LDR solutions, fields, templates, motif LDRs, stats (~3 min)
cd ../paper
mkdir -p <work> && (cd <work> && npm i three)                          # three.js for the renderer
python3 figures.py <work> /path/to/ldraw /path/to/docs/omr_gallery     # plots (matplotlib) + 55 renders (render.html through Playwright/Chromium) -> <work>/fig
cp paper.tex <work> && cd <work> && pdflatex paper.tex && pdflatex paper.tex
```
`ldraw_mesh.py` is a small LDraw (.dat/.ldr/.mpd) -> triangle-soup reader with LDConfig and direct colours; `render.html` + `shoot.py`
render any scene JSON (triangle soups, engine frame) with flat shading, feature edges and a soft shadow. Needs: node, python3 with
numpy / matplotlib / playwright (+ `playwright install chromium`), pdflatex with mathpazo, tikz, booktabs, subcaption.

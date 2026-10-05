// The build booklet: a model -> steps -> a printable instruction leaflet.
//
// What real LEGO instructions do, and what is copied here (bricknerd.com's survey of 1988 vs 2022 booklets, and the LDraw
// community's own conventions):
//  - the build is LAYERED, rising at the same rate from bottom to top. A voxel model already is, so the steps follow the levels;
//  - every step carries a step inventory call-out - the parts that step adds, with their count (introduced in 2003 sets);
//  - the parts a step adds are HIGHLIGHTED on the drawing (red in modern sets), the rest stays in the model's own colours;
//  - the camera never moves, so the builder can track the model from step to step;
//  - official sets place 1-4 pieces per step, which for a 1,300-piece sculpture would be 400 pages. The step size here is chosen
//    from a TARGET STEP COUNT instead (default 60) and clamped, so the leaflet stays a leaflet; the highlight and the per-step
//    inventory are what keep a 20-piece step followable.
// A step never spans more than `maxLevels` levels, and the pieces inside one step are taken in a serpentine order across the
// layer, so a step is always a contiguous run rather than a scatter.
const KIND_LABEL = { plate: 'plate', brick: 'brick', tile: 'tile', slope: 'slope', inverted: 'inverted slope', curved: 'curved slope', cheese: 'cheese slope', round: 'round', technic: 'technic', shaped: 'shaped', support: 'support' };
const hex = (rgb) => '#' + (rgb || [200, 200, 200]).map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');

/** pieces in build order: by level, then serpentine across the layer (so one step is a contiguous run, not a scatter) */
export function buildOrder(pieces) {
  return pieces.map((p, n) => n).sort((a, b) => {
    const p = pieces[a], q = pieces[b];
    if (p.b !== q.b) return p.b - q.b;
    if (p.j !== q.j) return p.j - q.j;
    return (p.j % 2 ? -1 : 1) * (p.i - q.i);                       // serpentine: alternate rows run the other way
  });
}

/**
 * Steps: runs of the build order that stay inside `maxLevels` levels and hold at most `perStep` pieces, where `perStep` comes
 * from the target step count. Returns [{ from, to, idx, levels: [lo, hi] }].
 */
export function planSteps(pieces, o = {}) {
  const order = buildOrder(pieces);
  const target = o.stepTarget ?? 60, maxLevels = o.stepLevels ?? 2;
  const perStep = Math.max(o.stepMin ?? 3, Math.min(o.stepMax ?? 40, Math.ceil(pieces.length / Math.max(1, target))));
  const steps = []; let cur = [], lo = null, hi = null;
  const flush = () => { if (cur.length) steps.push({ idx: cur, levels: [lo, hi] }); cur = []; lo = hi = null; };
  for (const n of order) {
    const b = pieces[n].b;
    if (cur.length && (cur.length >= perStep || b - lo >= maxLevels)) flush();
    if (!cur.length) lo = b;
    hi = Math.max(hi ?? b, b); cur.push(n);
  }
  flush();
  return { steps, perStep, order };
}

/** the parts a step adds, grouped by part and colour: [{ id, name, kind, w, d, h, rgb, n }] */
export function stepParts(pieces, idx, by) {
  const m = new Map();
  for (const n of idx) {
    const p = pieces[n], k = `${p.id}|${hex(p.rgb)}`;
    let e = m.get(k);
    if (!e) m.set(k, e = { id: p.id, name: (by[p.id] && by[p.id].name) || p.id, kind: p.kind, w: p.w, d: p.d, h: p.h, rgb: p.rgb, n: 0 });
    e.n++;
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
}
/**
 * The whole model's bill of materials, grouped by PART (not by part and colour): a photo-coloured model gives almost every
 * piece its own shade, so a colour-wise list would be hundreds of lines of "1x". Each row carries the colours it covers.
 */
export function billOfMaterials(pieces, by) {
  const m = new Map();
  for (const p of pieces) {
    let e = m.get(p.id);
    if (!e) m.set(p.id, e = { id: p.id, name: (by[p.id] && by[p.id].name) || p.id, kind: p.kind, w: p.w, d: p.d, h: p.h, rgb: p.rgb, n: 0, cols: new Map() });
    e.n++; const k = hex(p.rgb); e.cols.set(k, (e.cols.get(k) || 0) + 1);
  }
  return [...m.values()].map((e) => ({ ...e, colours: [...e.cols.entries()].sort((a, b) => b[1] - a[1]) })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
}

/** a small isometric icon of a part: footprint w x d, height h plates, studs on top unless it is a tile */
export function partIcon(part, px = 34) {
  const { w, d, h, kind } = part, S = 7, PL = 2.6, studs = kind !== 'tile' && kind !== 'slope' && kind !== 'curved' && kind !== 'cheese';
  const cx = (x, z) => (x - z) * S * 0.866, cy = (x, z, y) => (x + z) * S * 0.5 - y;      // isometric
  const H = h * PL, c = hex(part.rgb), dark = shade(part.rgb, 0.62), mid = shade(part.rgb, 0.82);
  const P = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const top = [[cx(0, 0), cy(0, 0, H)], [cx(w, 0), cy(w, 0, H)], [cx(w, d), cy(w, d, H)], [cx(0, d), cy(0, d, H)]];
  const left = [[cx(0, 0), cy(0, 0, H)], [cx(0, d), cy(0, d, H)], [cx(0, d), cy(0, d, 0)], [cx(0, 0), cy(0, 0, 0)]];
  const right = [[cx(w, d), cy(w, d, H)], [cx(0, d), cy(0, d, H)], [cx(0, d), cy(0, d, 0)], [cx(w, d), cy(w, d, 0)]];
  let g = `<polygon points="${P(left)}" fill="${mid}"/><polygon points="${P(right)}" fill="${dark}"/><polygon points="${P(top)}" fill="${c}"/>`;
  if (studs) for (let a = 0; a < w; a++) for (let b = 0; b < d; b++)
    g += `<ellipse cx="${cx(a + 0.5, b + 0.5).toFixed(1)}" cy="${cy(a + 0.5, b + 0.5, H + 1.4).toFixed(1)}" rx="${(S * 0.38).toFixed(1)}" ry="${(S * 0.22).toFixed(1)}" fill="${c}" stroke="${dark}" stroke-width="0.7"/>`;
  const xs = [...top, ...left, ...right].map((q) => q[0]), ys = [...top, ...left, ...right].map((q) => q[1]);
  const x0 = Math.min(...xs) - 3, y0 = Math.min(...ys) - 4, vw = Math.max(...xs) - x0 + 3, vh = Math.max(...ys) - y0 + 4;
  return `<svg class="ic" viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" width="${px}" height="${Math.round(px * vh / vw)}" aria-hidden="true">${g}</svg>`;
}
const shade = (rgb, f) => hex((rgb || [200, 200, 200]).map((x) => x * f));

/**
 * The booklet, as one self-contained HTML file: cover, how-to-read, the steps (image + inventory), and the parts list.
 * `images[k]` is a data URI for step k (the model built up to and including that step); `cover` one for the title page.
 * Print CSS is set up for A4 portrait, so the browser's "Save as PDF" produces the leaflet directly.
 */
export function bookletHTML({ title = 'model', cover = null, steps = [], images = [], bom = [], meta = {}, perPage = 4 }) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const pages = []; for (let k = 0; k < steps.length; k += perPage) pages.push(steps.slice(k, k + perPage).map((s, q) => ({ s, n: k + q })));
  const stepCard = ({ s, n }) => `<figure class="step">
      <div class="shot">${images[n] ? `<img src="${images[n]}" alt="step ${n + 1}">` : '<div class="miss">no image</div>'}<span class="num">${n + 1}</span></div>
      <figcaption class="inv">${s.parts.map((p) => `<span class="pi" title="${esc(p.name)}">${partIcon(p, 30)}<b>${p.n}&times;</b></span>`).join('')}</figcaption>
    </figure>`;
  const bomRow = (p) => `<li>${partIcon(p, 32)}<span class="bn">${esc(p.name)}${p.colours && p.colours.length > 1 ? `<i> ${p.colours.length} colours</i>` : ''}</span>` +
    `<span class="sw">${(p.colours || []).slice(0, 6).map(([c]) => `<em style="background:${c}"></em>`).join('')}</span><b>${p.n}&times;</b></li>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)} - building instructions</title>
<style>
  :root { --ink: #16181d; --ink2: #6b7280; --line: #d9dbe0; --soft: #f4f5f7; --hot: #e8402a; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.45 "Helvetica Neue", Arial, sans-serif; color: var(--ink); background: #e9eaee; }
  .sheet { width: 210mm; min-height: 297mm; margin: 8mm auto; padding: 14mm 13mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.18); }
  .bar { position: sticky; top: 0; z-index: 9; background: #16181d; color: #fff; padding: 8px 14px; display: flex; gap: 14px; align-items: center; font-size: 12px; }
  .bar button { font: inherit; padding: 4px 12px; border: 0; border-radius: 4px; background: #fff; color: #16181d; cursor: pointer; font-weight: 600; }
  h1 { font-size: 30px; margin: 0 0 2px; letter-spacing: -.01em; }
  h2 { font-size: 13px; margin: 0 0 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--ink2); }
  .cover { display: flex; flex-direction: column; height: 269mm; }
  .cover img { width: 100%; max-height: 132mm; object-fit: contain; border-radius: 3px; background: var(--soft); }
  .sub { color: var(--ink2); margin: 0 0 14px; }
  .facts { display: flex; gap: 26px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line); }
  .facts div b { display: block; font-size: 22px; line-height: 1.1; }
  .facts div span { color: var(--ink2); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
  .read { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; margin-top: 6px; font-size: 12px; }
  .read p { margin: 0 0 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9mm 8mm; }
  .step { margin: 0; break-inside: avoid; }
  .shot { position: relative; border: 1px solid var(--line); border-radius: 3px; background: var(--soft); overflow: hidden; }
  .shot img { display: block; width: 100%; }
  .num { position: absolute; top: 0; left: 0; background: var(--ink); color: #fff; font-weight: 700; font-size: 15px; padding: 2px 9px; border-radius: 0 0 3px 0; }
  .inv { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin-top: 5px; padding: 5px 7px; background: var(--soft); border-radius: 3px; }
  .pi { display: inline-flex; align-items: center; gap: 3px; }
  .ic { vertical-align: middle; }
  .bom { list-style: none; padding: 0; margin: 0; columns: 2; column-gap: 20px; }
  .bom li { display: flex; align-items: center; gap: 8px; padding: 2px 0; break-inside: avoid; border-bottom: 1px solid var(--soft); }
  .bn { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ink2); }
  .bn i { font-style: normal; opacity: .65; }
  .sw { display: inline-flex; gap: 1px; flex: none; }
  .sw em { width: 7px; height: 11px; border-radius: 1px; display: block; }
  .foot { margin-top: 8mm; padding-top: 4px; border-top: 1px solid var(--line); color: var(--ink2); font-size: 10px; display: flex; justify-content: space-between; }
  .hot { color: var(--hot); font-weight: 600; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; break-after: page; }
    .cover { height: auto; min-height: 240mm; }
    .sheet:last-child { break-after: auto; }
    @page { size: A4 portrait; margin: 13mm; }
  }
</style></head><body>
<div class="bar"><b>${esc(title)}</b> building instructions &mdash; ${steps.length} steps, ${pages.length + 2} pages
  <button onclick="window.print()">Print / Save as PDF</button></div>

<section class="sheet cover">
  <h1>${esc(title)}</h1>
  <p class="sub">Building instructions &mdash; ${meta.pieces || 0} pieces, ${meta.levels || 0} layers, ${steps.length} steps</p>
  ${cover ? `<img src="${cover}" alt="the finished model">` : ''}
  <h2 style="margin-top:14px">How to read this booklet</h2>
  <div class="read">
    <p>Each picture shows the model <b>after</b> the step. The pieces that step adds are drawn in <span class="hot">red</span>; everything already built keeps its own colour.</p>
    <p>Under each picture is that step's parts, with how many of each. Collect them first, then place them.</p>
    <p>The build rises layer by layer, so a piece is always placed on top of what is already there. The view never turns.</p>
    <p>The full parts list is on the last page. ${meta.weld ? 'Pieces marked as welds hold separate parts of the model together and may not follow the surface.' : ''}</p>
  </div>
  <div class="facts">
    <div><b>${meta.pieces || 0}</b><span>pieces</span></div>
    <div><b>${bom.length}</b><span>different parts</span></div>
    <div><b>${meta.levels || 0}</b><span>layers</span></div>
    <div><b>${steps.length}</b><span>steps</span></div>
    ${meta.studs ? `<div><b>${meta.studs}</b><span>studs across</span></div>` : ''}
  </div>
</section>

${pages.map((pg, k) => `<section class="sheet"><div class="grid">${pg.map(stepCard).join('')}</div>
  <div class="foot"><span>${esc(title)}</span><span>page ${k + 1} of ${pages.length}</span></div></section>`).join('\n')}

<section class="sheet"><h2>Parts list &mdash; ${meta.pieces || 0} pieces</h2>
  <ul class="bom">${bom.map(bomRow).join('')}</ul>
  <div class="foot"><span>${esc(title)}</span><span>parts list</span></div></section>
</body></html>`;
}

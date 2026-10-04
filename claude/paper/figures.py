#!/usr/bin/env python3
"""Build every figure of the paper: 3-D renders (render.html via shoot.py) and matplotlib plots, from the exports of export_scenes.mjs.

    cd claude/app && node ../paper/export_scenes.mjs <work>/data
    cd ../paper && python3 figures.py <work>            # <work> holds node_modules/three (npm i three), data/, writes fig/
"""
import json, sys, re
from pathlib import Path
from collections import Counter
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import colors as mcolors
sys.path.insert(0, str(Path(__file__).parent))
from ldraw_mesh import Library, to_engine
from shoot import Shooter, soup_group

WORK = Path(sys.argv[1]); D = WORK / 'data'; F = WORK / 'fig'; F.mkdir(exist_ok=True)
LDRAW = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/ldraw/ldraw'
OMR = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parents[2] / 'docs' / 'omr_gallery'
lib = Library(LDRAW)

# ------------------------------------------------------------------------------------------------------------- chart style
C = {'blue': '#2a78d6', 'orange': '#eb6834', 'aqua': '#1baf7a', 'yellow': '#eda100', 'magenta': '#e87ba4', 'green': '#008300', 'violet': '#4a3aa7', 'red': '#e34948'}
SERIES = [C['blue'], C['orange'], C['aqua'], C['yellow'], C['violet'], C['magenta']]
INK, INK2, GRID = '#0b0b0b', '#52514e', '#e4e3df'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 9, 'axes.edgecolor': INK2, 'axes.labelcolor': INK, 'xtick.color': INK2, 'ytick.color': INK2,
                     'axes.spines.top': False, 'axes.spines.right': False, 'axes.grid': True, 'grid.color': GRID, 'grid.linewidth': 0.6, 'axes.axisbelow': True,
                     'legend.frameon': False, 'figure.dpi': 150, 'savefig.dpi': 200, 'pdf.fonttype': 42})
BLUES = mcolors.LinearSegmentedColormap.from_list('blues', ['#f4f6fa', '#9fc0ea', '#2a78d6', '#0b2d5c'])
DIV = mcolors.LinearSegmentedColormap.from_list('div', ['#eb6834', '#f6b793', '#e8e8e6', '#9fc0ea', '#2a78d6'])
def save(fig, name):
    fig.savefig(F / f'{name}.pdf', bbox_inches='tight'); fig.savefig(F / f'{name}.png', bbox_inches='tight'); plt.close(fig); print('fig', name)

def field(name):
    j = json.load(open(D / name)); return np.array(j['data'], np.float32).reshape(j['nl'], j['nz'], j['nx'])

# ============================================================================================================== 3-D renders
def renders():
    with Shooter(WORK) as sh:
        def ldr(name, view='iso', zoom=1, w=1200, h=900, edge=0.45, **kw):
            t, c = lib.mesh_of_text(open(D / f'{name}.ldr').read())
            sh.scene(name, groups=[soup_group(to_engine(t), c, edgeOpacity=edge)], view=view, zoom=zoom, **kw)
            sh.shoot(name, w=w, h=h, out=F / f'r_{name}.png'); print('render', name, len(t))
        def part(id_, color=4, view='iso', w=600, h=500):
            t, c = lib.mesh_of_file(f'{id_}.dat', color=color)
            sh.scene(f'part_{id_}', groups=[soup_group(to_engine(t), c, edgeOpacity=0.5)], view=view, grid=False)
            sh.shoot(f'part_{id_}', w=w, h=h, out=F / f'r_part_{id_}.png'); print('render part', id_)
        def src(name, view='iso', w=1200, h=900):
            j = json.load(open(D / f'{name}.json')); pos = np.array(j['pos'], np.float32)
            col = np.array(j.get('col', [0.72] * len(pos)), np.float32) if 'col' in j else np.full(len(pos), 0.72, np.float32)
            if col.max() <= 1.0 and 'col' in j: col = np.clip(col, 0, 1) ** (1 / 2.2)                      # linear -> sRGB-ish for display
            sh.scene(name, groups=[{'pos': pos.tolist(), 'col': col.tolist(), 'edgeOpacity': 0.0, 'noEdges': True}], view=view)
            sh.shoot(name, w=w, h=h, out=F / f'r_{name}.png'); print('render src', name)
        for m in ['duck', 'bieder_chair', 'be2', 'table_baked', 'dolphin', 'rafs5']:
            ldr(f'sol_{m}', view='iso' if m != 'be2' else 'iso2'); src(f'src_{m}', view='iso' if m != 'be2' else 'iso2')
        for m in ['duck', 'bieder_chair']: ldr(f'kind_{m}')
        for k in ['clean', 'noisy_rays', 'noisy_align', 'noisy_sdf_align']: ldr(f'house_{k}', view='iso', w=900, h=720)
        src('house_clean_src', w=900, h=720); src('house_noisy_rays_src', w=900, h=720)
        for k in range(12): ldr(f'motif_{k}', view='iso', w=520, h=400, edge=0.6)
        for k in range(8): ldr(f'snot_{k}', view='iso', w=520, h=400, edge=0.6)
        for k in ['old', 'new']: ldr(f'poles_{k}', view='front', w=1200, h=800)
        for pid in ['3039', '3005', '54200', '3062b', '4070', '11211', '3665', '3040', '87087', '44728']: part(pid)
        # three OMR sets
        for f, name in [('10158-1.mpd', 'omr_10158'), ('10013-1.mpd', 'omr_10013'), ('6973-1.mpd', 'omr_6973')]:
            p = OMR / f
            if not p.exists(): continue
            t, c = lib.mesh_of_text(p.read_text(errors='ignore'))
            sh.scene(name, groups=[soup_group(to_engine(t), c, edgeOpacity=0.3)], view='iso'); sh.shoot(name, w=1200, h=900, out=F / f'r_{name}.png'); print('render', name, len(t))

# ============================================================================================================== plots
def fig_field_slices():
    M = field('field_duck.json'); nl = M.shape[0]
    levels = [int(nl * f) for f in (0.08, 0.3, 0.55, 0.8)]
    fig, axs = plt.subplots(1, 4, figsize=(10, 2.9))
    for ax, l in zip(axs, levels):
        ax.imshow(M[l], cmap=BLUES, vmin=0, vmax=1, origin='lower', interpolation='nearest'); ax.set_title(f'plate level {l} of {nl}', fontsize=9, color=INK2)
        ax.set_xticks([]); ax.set_yticks([]); ax.grid(False)
        for s in ax.spines.values(): s.set_visible(False)
    fig.suptitle('The volume field M[level][z][x] of the duck at 24 studs: fractional fill per 4-LDU cell, one plate per level', fontsize=9.5, color=INK)
    save(fig, 'field_slices')

def fig_template():
    T = json.load(open(D / 'templates.json'))
    ids = ['3039', '54200', '3062b']
    fig, axs = plt.subplots(1, 3 + 3, figsize=(11, 2.6), gridspec_kw={'width_ratios': [1.3, 1, 1, 1, 1, 1]})
    axs = list(axs)
    # 3039: all three levels; 54200: its two levels; 3062b: one level
    t = T['3039']; V = np.array(t['V']).reshape(t['h'], t['d'] * 5, t['w'] * 5)
    for k in range(3): axs[k].imshow(V[k], cmap=BLUES, vmin=0, vmax=1, origin='lower', interpolation='nearest'); axs[k].set_title(f'3039 slope, level {k}', fontsize=8.5, color=INK2)
    t = T['54200']; V = np.array(t['V']).reshape(t['h'], t['d'] * 5, t['w'] * 5)
    for k in range(2): axs[3 + k].imshow(V[k], cmap=BLUES, vmin=0, vmax=1, origin='lower', interpolation='nearest'); axs[3 + k].set_title(f'54200 cheese, level {k}', fontsize=8.5, color=INK2)
    t = T['3062b']; V = np.array(t['V']).reshape(t['h'], t['d'] * 5, t['w'] * 5)
    axs[5].imshow(V[0], cmap=BLUES, vmin=0, vmax=1, origin='lower', interpolation='nearest'); axs[5].set_title('3062b round', fontsize=8.5, color=INK2)
    for ax in axs:
        ax.set_xticks([]); ax.set_yticks([]); ax.grid(False)
        for s in ax.spines.values(): s.set_visible(False)
    fig.tight_layout(); save(fig, 'templates')

def fig_house_fields():
    H = json.load(open(D / 'house.json'))
    names = [('clean', 'clean, own frame'), ('noisy_rays', 'σ=2, rays, bbox frame'), ('noisy_align', 'σ=2, rays, lattice fit'), ('noisy_sdf_align', 'σ=2, SDF+median, lattice fit')]
    fig, axs = plt.subplots(1, 4, figsize=(11, 3.0))
    for ax, (k, title) in zip(axs, names):
        M = field(f'house_field_{k}.json'); x = M.shape[2] // 2
        sl = M[:, :, x]                              # levels x z
        ax.imshow(sl, cmap=BLUES, vmin=0, vmax=1, origin='lower', interpolation='nearest', aspect='auto')
        ax.set_title(f'{title}\n{H["cases"][k]["pieces"]} solver pieces', fontsize=8.5, color=INK2)
        ax.set_xlabel('z (4-LDU cells)'); ax.set_ylabel('plate level') if k == 'clean' else None
        ax.grid(False)
    fig.tight_layout(); save(fig, 'house_fields')

def fig_lattice_curve():
    H = json.load(open(D / 'house.json')); c = np.array(H['curve'])
    fig, ax = plt.subplots(figsize=(5.2, 2.8))
    ax.plot(c[:, 0], c[:, 1], color=C['blue'], lw=2)
    ax.axvline(1.0, color=INK2, lw=0.8, ls='--'); ax.text(1.0, c[:, 1].max() * 0.98, ' bbox scale', color=INK2, fontsize=8, va='top')
    best = c[np.argmax(c[:, 1])]; ax.plot(best[0], best[1], 'o', color=C['orange'], ms=7); ax.text(best[0], best[1], f'  best: x{best[0]:.3f}', color=INK, fontsize=8.5, va='center')
    ax.set_xlabel('scale factor relative to "longest side = 12 studs"'); ax.set_ylabel('lattice score (sum of 3 resultants)')
    ax.set_title('The lattice fit on the noisy house: planar face area on stud / plate boundaries vs scale', fontsize=9, color=INK)
    save(fig, 'lattice_curve')

def fig_noise_bench():
    # the consolidated table of docs/IMPLICIT.md §1 (merged pieces / IoU against the clean field, same frame)
    sig = [0, 1, 2, 4]
    series = {'rays': ([93, 179, 246, 266], [.919, .852, .776, .769]), 'rays + lattice fit': ([93, 131, 170, 164], [.919, .898, .914, .848]),
              'Taubin 10 it.': ([117, 147, 212, 225], [.871, .887, .857, .851]), 'SDF + median': ([98, 138, 241, 229], [.917, .856, .784, .780]),
              'SDF + median + lattice': ([98, 110, 183, 145], [.917, .897, .918, .859])}
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.2))
    for (k, (p, i)), col in zip(series.items(), SERIES):
        a1.plot(sig, p, '-o', color=col, lw=2, ms=5, label=k); a2.plot(sig, i, '-o', color=col, lw=2, ms=5, label=k)
    a1.set_xlabel('grain σ (LDU; a plate is 8, a cell 4)'); a1.set_ylabel('merged pieces'); a1.set_title('Pieces (clean mesh needs 93)', fontsize=9, color=INK)
    a2.set_xlabel('grain σ (LDU)'); a2.set_ylabel('IoU against the clean field'); a2.set_title('Fidelity to the clean shape', fontsize=9, color=INK)
    a1.legend(fontsize=7.5, loc='upper left'); a2.legend(fontsize=7.5, loc='lower left')
    save(fig, 'noise_bench')

def fig_phases():
    H = json.load(open(D / 'house.json'))
    order = ['M', 'A0', 'A', 'A2', 'B', 'B2', 'C', 'D', 'E', 'F']; names = {'M': 'motif', 'A0': 'round', 'A': 'skin', 'A2': 'skin ext', 'B': 'fill', 'B2': 'fill 2', 'C': 'relaxed', 'D': 'fallback', 'E': 'thin', 'F': 'tube'}
    cases = [('clean', 'clean'), ('noisy_rays', 'grain σ=2, rays'), ('noisy_align', 'grain σ=2 + lattice fit')]
    fig, ax = plt.subplots(figsize=(8, 2.8)); w = 0.26
    for q, ((k, lab), col) in enumerate(zip(cases, SERIES)):
        ph = H['cases'][k]['phases']; vals = [ph.get(o, 0) for o in order]
        ax.bar(np.arange(len(order)) + (q - 1) * w, vals, w * 0.92, color=col, label=f'{lab} ({sum(vals)} pieces)')
    ax.set_xticks(np.arange(len(order))); ax.set_xticklabels([f'{o}\n{names[o]}' for o in order], fontsize=8)
    ax.set_ylabel('solver pieces'); ax.legend(fontsize=8); ax.set_title('Which phase places the pieces: grain pushes the work into the mop-up phases, the lattice fit brings it back', fontsize=9, color=INK)
    save(fig, 'phases')

def omr_scan():
    """part counts per model and part-id frequencies by a text scan of the gallery (sub-models counted with their multiplicity)"""
    per_model, parts = [], Counter(); nmodels = 0
    for p in sorted(OMR.glob('*.mpd')) + sorted(OMR.glob('*.ldr')):
        try: files = Library.parse(p.read_text(errors='ignore'))
        except Exception: continue
        main = next((k for k, v in files.items() if v), None)
        if main is None: continue
        memo = {}
        def count(fn, depth=0):
            if depth > 30: return 0
            if fn in memo: return memo[fn]
            n = 0
            for typ, col, v, sub in files.get(fn, []):
                if typ != '1': continue
                if sub in files: n += count(sub, depth + 1)
                elif sub.endswith('.dat'): n += 1; parts[sub[:-4]] += 1
            memo[fn] = n; return n
        per_model.append(count(main)); nmodels += 1
    return per_model, parts, nmodels

def fig_dataset(per_model, parts, nmodels):
    fig, (a1, a2, a3) = plt.subplots(1, 3, figsize=(12, 3.0), gridspec_kw={'width_ratios': [1, 1.4, 1]})
    pm = np.array(per_model); a1.hist(np.clip(pm, 1, 3000), bins=np.geomspace(1, 3000, 30), color=C['blue']); a1.set_xscale('log')
    a1.set_xlabel('parts per model'); a1.set_ylabel('models'); a1.set_title(f'{nmodels} OMR models, median {int(np.median(pm))} parts', fontsize=9, color=INK)
    real = [(pid, n) for pid, n in parts.most_common(60) if ('parts/' + pid + '.dat') in lib.index][:18]
    top = real[::-1]; names = []
    for pid, n in top:
        t = lib.read(pid + '.dat'); desc = (t.splitlines()[0][2:].strip() if t else pid)
        m = re.match(r'~Moved to (\S+)', desc)
        if m: t2 = lib.read(m.group(1) + '.dat'); desc = (t2.splitlines()[0][2:].strip() if t2 else desc)
        names.append(f'{pid}  {desc[:28]}')
    a2.barh(range(len(top)), [n for _, n in top], color=C['blue']); a2.set_yticks(range(len(top))); a2.set_yticklabels(names, fontsize=7); a2.set_xlabel('placements in the gallery')
    a2.set_title('The 18 most used parts', fontsize=9, color=INK)
    cov = [('upright, exact', 32.1), ('upright, aliased', 11.4), ('sideways (SNOT)', 5.7), ('sideways off-grid', 5.0), ('off the stud grid', 8.0), ('tilted / hinged', 17.1), ('part not in catalogue', 31.5)]
    cols = [C['blue'], '#9fc0ea', C['aqua'], '#8fd6b9', C['yellow'], C['orange'], '#b5b3ad']
    a3.barh(range(len(cov)), [v for _, v in cov], color=cols); a3.set_yticks(range(len(cov))); a3.set_yticklabels([k for k, _ in cov], fontsize=8); a3.invert_yaxis()
    for i, (_, v) in enumerate(cov): a3.text(v + 0.5, i, f'{v:.1f} %', va='center', fontsize=8, color=INK)
    a3.set_xlabel('% of 343k placements'); a3.set_title('What the engine can express', fontsize=9, color=INK); a3.set_xlim(0, 40)
    fig.subplots_adjust(wspace=0.95); save(fig, 'dataset')

def fig_motif_stats():
    J = json.load(open(D / 'motifs.json'))
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(9, 2.8))
    bp = {int(k): v for k, v in J['byParts'].items()}; ks = sorted(bp)
    a1.bar(ks, [bp[k] for k in ks], color=C['blue']); a1.set_xlabel('parts per motif'); a1.set_ylabel('motifs'); a1.set_title(f'{J["total"]:,} motifs kept ({J["snot"]} with a sideways part)', fontsize=9, color=INK)
    cnt = np.array(J['countHist']); a2.hist(cnt, bins=np.geomspace(2, cnt.max(), 40), color=C['orange']); a2.set_xscale('log'); a2.set_yscale('log')
    a2.set_xlabel('occurrences in the gallery'); a2.set_ylabel('motifs'); a2.set_title('Occurrence counts (Zipf-like)', fontsize=9, color=INK)
    save(fig, 'motif_stats')

def fig_results():
    rows = [('be2 @48', 750, .400, 770, .385), ('duck @24', 1415, .852, 1377, .859), ('chair @32', 1506, .872, 1369, .922), ('table @32', 610, .690, 660, .789), ('dolphin @32', 285, .660, 272, .672), ('rafs5 @48', 1135, .630, 1042, .661)]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.0)); x = np.arange(len(rows)); w = 0.38
    a1.bar(x - w / 2, [r[1] for r in rows], w, color='#b5b3ad', label='bounding-box frame'); a1.bar(x + w / 2, [r[3] for r in rows], w, color=C['blue'], label='lattice fit')
    a1.set_xticks(x); a1.set_xticklabels([r[0] for r in rows], fontsize=8); a1.set_ylabel('pieces'); a1.legend(fontsize=8); a1.set_title('Pieces', fontsize=9, color=INK)
    a2.bar(x - w / 2, [r[2] for r in rows], w, color='#b5b3ad'); a2.bar(x + w / 2, [r[4] for r in rows], w, color=C['blue'])
    for i, r in enumerate(rows): a2.text(i + w / 2, r[4] + 0.01, f'{r[4] - r[2]:+.3f}', ha='center', fontsize=7.5, color=INK)
    a2.set_xticks(x); a2.set_xticklabels([r[0] for r in rows], fontsize=8); a2.set_ylabel('IoU'); a2.set_ylim(0.3, 1.0); a2.set_title('IoU against each run\'s own field', fontsize=9, color=INK)
    save(fig, 'results_align')

def fig_motif_results():
    # docs/MOTIFS.md round 3 three-way table, 24 studs, extended
    rows = [('chair', (524, .864), (564, .878), (676, .888)), ('dolphin', (133, .575), (128, .578), (134, .571)), ('duck', (1136, .849), (1257, .845), (1355, .854)), ('rafs5', (294, .490), (307, .495), (316, .496)), ('table', (270, .618), (270, .618), (283, .618))]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.0)); x = np.arange(len(rows)); w = 0.26; labs = ['motifs off', 'motifs, upright only', 'motifs incl. sideways']
    for q, col in enumerate(['#b5b3ad', C['blue'], C['aqua']]):
        a1.bar(x + (q - 1) * w, [r[1 + q][0] for r in rows], w * 0.92, color=col, label=labs[q]); a2.bar(x + (q - 1) * w, [r[1 + q][1] for r in rows], w * 0.92, color=col)
    a1.set_xticks(x); a1.set_xticklabels([r[0] for r in rows]); a1.set_ylabel('pieces'); a1.legend(fontsize=8); a1.set_title('Pieces (24 studs, extended set)', fontsize=9, color=INK)
    a2.set_xticks(x); a2.set_xticklabels([r[0] for r in rows]); a2.set_ylabel('IoU'); a2.set_ylim(0.4, 0.95); a2.set_title('IoU: motifs buy fidelity with pieces', fontsize=9, color=INK)
    save(fig, 'motif_results')

def fig_poles_numbers():
    rows = [('be2 @48', 30, 85, 49, 83), ('rafs5 @48', 9, 20, 11, 16), ('table @32', 4, 15, 0, 0), ('chair @32', 29, 36, 0, 5)]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(8, 2.6)); x = np.arange(len(rows)); w = 0.38
    a1.bar(x - w / 2, [r[1] for r in rows], w, color='#b5b3ad', label='ring veto (before)'); a1.bar(x + w / 2, [r[2] for r in rows], w, color=C['orange'], label='split + thin neighbours')
    a1.set_xticks(x); a1.set_xticklabels([r[0] for r in rows], fontsize=8); a1.set_ylabel('round pieces'); a1.legend(fontsize=8); a1.set_title('Round bricks placed by pillars()', fontsize=9, color=INK)
    a2.bar(x - w / 2, [r[3] for r in rows], w, color='#b5b3ad'); a2.bar(x + w / 2, [r[4] for r in rows], w, color=C['orange'])
    a2.set_xticks(x); a2.set_xticklabels([r[0] for r in rows], fontsize=8); a2.set_ylabel('% of tall 1x1 columns fully round'); a2.set_title('Pole completion, symmetry off', fontsize=9, color=INK)
    save(fig, 'poles_numbers')

def fig_sdf_slice():
    # the house SDF is not exported as a distance grid; show the occupancy-level effect of the filters on the σ=2 house instead:
    # difference maps against the clean field for the rays frame vs the aligned frames
    Mc = field('house_field_clean.json'); x = Mc.shape[2] // 2
    fig, axs = plt.subplots(1, 3, figsize=(10, 3.0))
    for ax, (k, title) in zip(axs, [('noisy_rays', 'rays, bbox frame'), ('noisy_align', 'rays, lattice-fitted frame'), ('noisy_sdf_align', 'SDF + median, lattice-fitted')]):
        M = field(f'house_field_{k}.json')
        if M.shape != Mc.shape: ax.set_title(f'{title}\n(different frame: {M.shape} vs {Mc.shape})', fontsize=8); ax.axis('off'); continue
        ax.imshow((M - Mc)[:, :, x], cmap=DIV, vmin=-1, vmax=1, origin='lower', interpolation='nearest', aspect='auto'); ax.set_title(title, fontsize=9, color=INK2); ax.grid(False); ax.set_xlabel('z'); ax.set_ylabel('level')
    fig.suptitle('Field minus clean field (same frame): orange = missing, blue = spurious', fontsize=9.5, color=INK)
    save(fig, 'house_diff')

if __name__ == '__main__':
    what = sys.argv[4] if len(sys.argv) > 4 else 'all'
    if what in ('all', 'plots'):
        fig_field_slices(); fig_template(); fig_house_fields(); fig_lattice_curve(); fig_noise_bench(); fig_phases(); fig_motif_stats(); fig_results(); fig_motif_results(); fig_poles_numbers(); fig_sdf_slice()
        pm, parts, nm = omr_scan(); fig_dataset(pm, parts, nm)
        json.dump({'models': nm, 'median_parts': float(np.median(pm)), 'total_parts': int(sum(pm)), 'top': parts.most_common(30)}, open(F / 'dataset_stats.json', 'w'))
    if what in ('all', 'renders'):
        renders()

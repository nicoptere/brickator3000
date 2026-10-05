#!/usr/bin/env python3
"""Figures of the curved-surface and resolution sections (rounds 4-8): renders of export_rounds.mjs scenes + the rate-distortion plots.

    cd claude/app && node ../paper/export_rounds.mjs <work>/data                      # scenes
    STUDS=8,12,16,20,24,28,32,40,48 OUT=<work>/data/rd_a.json node test/resolution_bench.mjs synth:sphere synth:boxRoundEdge models/duck.glb models/dolphin.glb
    STUDS=8,12,16,20,24,28,32,40,48 OUT=<work>/data/rd_b.json node test/resolution_bench.mjs models/table_baked.glb models/bieder_chair.glb
    node ../paper/auto_candidates.mjs <work>/data/auto_candidates.json              # autoStuds candidate tables
    cd ../paper && python3 figures_rounds.py <work> [/path/to/ldraw] [renders|plots|all]
"""
import json, sys, shutil
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
sys.path.insert(0, str(Path(__file__).parent))
from ldraw_mesh import Library, to_engine
from shoot import Shooter, soup_group

WORK = Path(sys.argv[1]); D = WORK / 'data'; F = WORK / 'fig'; F.mkdir(exist_ok=True)
LDRAW = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/ldraw/ldraw'
WHAT = sys.argv[3] if len(sys.argv) > 3 else 'all'
C = {'blue': '#2a78d6', 'orange': '#eb6834', 'aqua': '#1baf7a', 'yellow': '#eda100', 'magenta': '#e87ba4', 'violet': '#4a3aa7', 'red': '#e34948', 'grey': '#b5b3ad'}
INK, INK2, GRID = '#0b0b0b', '#52514e', '#e4e3df'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 9, 'axes.edgecolor': INK2, 'axes.labelcolor': INK, 'xtick.color': INK2, 'ytick.color': INK2,
                     'axes.spines.top': False, 'axes.spines.right': False, 'axes.grid': True, 'grid.color': GRID, 'grid.linewidth': 0.6, 'axes.axisbelow': True,
                     'legend.frameon': False, 'figure.dpi': 150, 'savefig.dpi': 200, 'pdf.fonttype': 42})
def save(fig, name):
    fig.savefig(F / f'{name}.pdf', bbox_inches='tight'); fig.savefig(F / f'{name}.png', bbox_inches='tight'); plt.close(fig); print('fig', name)

def renders():
    lib = Library(LDRAW)
    with Shooter(WORK) as sh:
        def ldr(name, view='iso', w=1000, h=760, edge=0.45, **kw):
            p = D / f'{name}.ldr'
            if not p.exists(): print('missing', name); return
            t, c = lib.mesh_of_text(p.read_text())
            sh.scene(name, groups=[soup_group(to_engine(t), c, edgeOpacity=edge)], view=view, **kw)
            sh.shoot(name, w=w, h=h, out=F / f'r_{name}.png'); print('render', name, len(t))
        for m in ['duck', 'dome', 'sphere', 'dolphin']:
            for t in ['round4', 'round5']: ldr(f'kd_{m}_{t}', w=800, h=640)
        for k in ['outside', 'inside']: ldr(f'br_dome_{k}', view='front', w=900, h=600); ldr(f'br_duck_{k}', view='low', w=900, h=700)
        for k in ['off', 'snot']: ldr(f'sn_boxBoss_{k}', view='low', w=800, h=640)
        for n in ['table_35', 'table_43', 'chair_32', 'chair_37', 'sphere_14', 'sphere_32']: ldr(f'res_{n}', w=900, h=700)
        for m in ['duck', 'table_baked', 'bieder_chair', 'dolphin', 'boxRoundEdge']: ldr(f'auto_{m}', w=900, h=700)
    # the two JPEG sheets of docs/images are figures too
    for j in ['curves_before_after.jpg', 'curves_round5.jpg']:
        src = Path(__file__).resolve().parents[2] / 'docs' / 'images' / j
        if src.exists(): shutil.copy(src, F / j)

def fig_resolution():
    rd = {}
    for f in ['rd_a.json', 'rd_b.json']:
        if (D / f).exists(): rd.update(json.load(open(D / f)))
    order = [('sphere', 'sphere', C['blue']), ('duck', 'duck', C['orange']), ('bieder_chair', 'chair', C['aqua']), ('table_baked', 'table', C['yellow']), ('dolphin', 'dolphin', C['violet']), ('boxRoundEdge', 'rounded box', C['grey'])]
    fig, ax = plt.subplots(1, 3, figsize=(11, 3.4))
    for key, label, col in order:
        if key not in rd: continue
        rows = rd[key]['rows']; p = [r['pieces'] for r in rows]; n = [r['n'] for r in rows]
        ax[0].plot(p, [r['iou'] for r in rows], '-o', color=col, ms=3, lw=1.4, label=label)
        ax[0].plot(p, [r['fieldIou'] for r in rows], ':', color=col, lw=1)
        ax[1].plot(p, [r['band'] for r in rows], '-o', color=col, ms=3, lw=1.4, label=label)
        ax[1].plot(p, [r['fieldBand'] for r in rows], ':', color=col, lw=1)
        a = rd[key]['auto']['studs']                                   # the automatic choice, interpolated in log(studs) onto the curve
        if n[0] <= a <= n[-1]:
            ln = np.log(n); pa = np.exp(np.interp(np.log(a), ln, np.log(p))); ia = np.interp(np.log(a), ln, [r['iou'] for r in rows]); ba = np.interp(np.log(a), ln, [r['band'] for r in rows])
            ax[0].plot([pa], [ia], 'o', ms=9, mfc='none', mec=col, mew=1.5); ax[1].plot([pa], [ba], 'o', ms=9, mfc='none', mec=col, mew=1.5)
    for a in ax[:2]:
        a.set_xscale('log'); a.set_xlabel('pieces (log)'); a.set_ylim(0.2, 1.0)
    ax[0].set_ylabel('IoU against the 96-stud reference (hollow filled)'); ax[0].set_title('solid fidelity: solution (solid), field alone (dotted)', fontsize=9, loc='left')
    ax[1].set_ylabel('IoU within half a stud of the surface'); ax[1].set_title('surface-band fidelity', fontsize=9, loc='left')
    ax[0].legend(fontsize=8, loc='lower right', ncol=2)
    # the lattice effect: the field's IoU at every stud count of the dense sweep (auto_candidates.json) for the furniture
    cand = json.load(open(D / 'auto_candidates.json')) if (D / 'auto_candidates.json').exists() else {}
    for key, label, col in [('table_baked', 'table', C['yellow']), ('bieder_chair', 'chair', C['aqua']), ('boxRoundEdge', 'rounded box', C['grey'])]:
        if key not in cand: continue
        rows = cand[key]['candidates']; ax[2].plot([r['studs'] for r in rows], [r['iou'] for r in rows], '-o', color=col, ms=4, lw=1.4, label=label)
        ch = cand[key]['studs']; r = next(q for q in rows if q['studs'] == ch); ax[2].plot([ch], [r['iou']], 'o', ms=10, mfc='none', mec=col, mew=1.5)
    ax[2].set_xlabel('stud count'); ax[2].set_ylabel('IoU of the field against the reference'); ax[2].set_title('the lattice: the same mesh at neighbouring counts', fontsize=9, loc='left'); ax[2].legend(fontsize=8, loc='lower left')
    fig.tight_layout(); save(fig, 'resolution_curves')

def fig_resolution_sweep():
    """the dense chair sweep, if present (rd_dense.json): fidelity and pieces vs stud count"""
    p = D / 'rd_dense.json'
    if not p.exists(): return
    rd = json.load(open(p)); fig, ax = plt.subplots(1, len(rd), figsize=(5 * len(rd), 3))
    ax = np.atleast_1d(ax)
    for a, (key, v) in zip(ax, rd.items()):
        rows = v['rows']; n = [r['n'] for r in rows]
        a.plot(n, [r['iou'] for r in rows], '-o', color=C['blue'], ms=3, label='solution IoU'); a.plot(n, [r['fieldIou'] for r in rows], ':', color=C['blue'], label='field IoU')
        a.plot(n, [r['band'] for r in rows], '-o', color=C['orange'], ms=3, label='solution band IoU'); a.plot(n, [r['fieldBand'] for r in rows], ':', color=C['orange'], label='field band IoU')
        b = a.twinx(); b.plot(n, [r['pieces'] for r in rows], '-', color=C['grey'], lw=1); b.set_ylabel('pieces', color=INK2); b.grid(False)
        a.set_xlabel('stud count'); a.set_ylabel('IoU'); a.set_title(key, fontsize=9, loc='left'); a.legend(fontsize=7, loc='lower right')
    fig.tight_layout(); save(fig, 'resolution_sweep')

if __name__ == '__main__':
    if WHAT in ('all', 'plots'): fig_resolution(); fig_resolution_sweep()
    if WHAT in ('all', 'renders'): renders()

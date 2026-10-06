#!/usr/bin/env python3
"""Figures of the sideways-skin / MOC-corpus / engineering sections (rounds 10-13): the renders of export_mocs.mjs, the
composition of the shipped motif library, the cost of a run before and after the packing round, and the booklet pages.

    cd claude/app && node ../paper/export_mocs.mjs <work>/data                         # two solves + the library stats (~1 min)
    cd claude/app && OUT=<work>/data/hen16.json node test/run.mjs models/hen.glb 16    # a piece list for the booklet
    cd claude/app && node test/booklet_shoot.mjs <work>/data/hen16.json 18,16,64 Hen <work>/data/booklet 16
    cd <work>/data/booklet && for p in 1 5 18 19; do pdftoppm -f $p -l $p -r 110 -png -singlefile booklet.pdf pg$p; done
    cd claude/paper && python3 figures_mocs.py <work> [/path/to/ldraw] [renders|plots|booklet|all]

The booklet step is optional (it needs playwright and ~7 min of software WebGL); without it the booklet figures are skipped.
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

WORK = Path(sys.argv[1]); D = WORK / 'data'; F = WORK / 'fig'; F.mkdir(parents=True, exist_ok=True)
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
        for name, view in [('wall_teapot_off', 'iso'), ('wall_teapot_on', 'iso')]:
            p = D / f'{name}.ldr'
            if not p.exists(): print('missing', name); continue
            t, c = lib.mesh_of_text(p.read_text())
            sh.scene(name, groups=[soup_group(to_engine(t), c, edgeOpacity=0.45)], view=view, zoom=1.3)
            sh.shoot(name, w=900, h=760, out=F / f'r_{name}.png'); print('render', name, len(t))

def fig_library():
    """What the 20,313 mined motifs become on disk, and what the engine's default settings keep of the 10,669 shipped."""
    s = json.load(open(D / 'mocs.json'))['library']
    cl = s['classes']
    order = [('kept', 'placed as compound parts', C['aqua']),
             ('flatOnly', 'no shaped part (mosaics, tilings)', C['grey']),
             ('tooManyParts', 'more than 12 parts', C['yellow']),
             ('snotNoHost', 'sideways, host clipped out', C['orange']),
             ('unknownPart', 'a part the catalogue lacks', C['red'])]
    fig, ax = plt.subplots(1, 2, figsize=(10, 2.5), gridspec_kw={'width_ratios': [1.45, 1]})
    # left: the library, by what the defaults do with it - the same two rows normalised to 100 %, labelled with the real values
    for row, (field, fmt) in enumerate([('bytes', lambda v: f'{v/1e3:.0f} KB'), ('motifs', lambda v: f'{int(v):,}')]):
        left, tot = 0.0, float(s[field])
        for k, lab, col in order:
            v = cl[k][field]
            if v <= 0: continue
            ax[0].barh(row, 100 * v / tot, left=left, color=col, height=0.5, edgecolor='white', lw=0.8, label=lab if row == 0 else None)
            if v > 0.08 * tot:
                ax[0].text(left + 50 * v / tot, row, fmt(v), ha='center', va='center', fontsize=8,
                           color='white' if k != 'flatOnly' else INK)
            left += 100 * v / tot
    ax[0].set_yticks([0, 1]); ax[0].set_yticklabels(['size', 'count'], fontsize=8.5); ax[0].set_xlim(0, 100)
    ax[0].set_title(f'the shipped library: {s["motifs"]:,} motifs, {s["bytes"]/1e6:.2f} MB, and what the defaults keep of it',
                    fontsize=9, loc='left')
    ax[0].legend(fontsize=7.5, loc='upper center', bbox_to_anchor=(0.5, -0.12), ncol=2)
    ax[0].grid(False); ax[0].set_xticks([])
    for sp in ('left', 'bottom'): ax[0].spines[sp].set_visible(False)
    # right: the library through the rounds, as mined and as shipped
    names = ['OMR only', 'MOC only', 'merged', 'shipped\n(packed)']
    mined = [14087, 9223, 20313, 10669]
    mb = [5.0, 3.9, 8.09, 0.83]
    x = np.arange(len(names))
    a2 = ax[1]; a2.bar(x, mined, color=[C['blue'], C['orange'], C['violet'], C['aqua']], width=0.6)
    for i, (m, s_) in enumerate(zip(mined, mb)): a2.text(i, m + 500, f'{m:,}\n{s_} MB', ha='center', fontsize=7.5, color=INK2)
    a2.set_xticks(x); a2.set_xticklabels(names, fontsize=8); a2.set_ylim(0, 26000); a2.set_yticks([])
    a2.grid(False); a2.spines['left'].set_visible(False)
    a2.set_title('mined, merged, and what ships', fontsize=9, loc='left')
    save(fig, 'moc_library')

def fig_fast():
    """The four numbers the packing round moved, on the same eight benchmark models."""
    panels = [
        ('data modules imported\nby every worker (MB)', ['before', 'after'], [12.03, 1.01], '{:.2f}'),
        ('engine import (ms)', ['round 11', 'round 12', 'round 13'], [659, 265, 38], '{:.0f}'),
        ('heap per worker\nafter import (MB)', ['before', 'after'], [49, 7], '{:.0f}'),
        ('8 models @16 studs,\nmotifs on (s)', ['before', 'after'], [82, 46], '{:.0f}'),
    ]
    fig, ax = plt.subplots(1, 4, figsize=(11, 2.5))
    for a, (title, labels, vals, fmt) in zip(ax, panels):
        cols = [C['grey']] * (len(vals) - 1) + [C['aqua']]
        a.bar(np.arange(len(vals)), vals, color=cols, width=0.6)
        for i, v in enumerate(vals): a.text(i, v, '  ' + fmt.format(v), ha='center', va='bottom', fontsize=8, color=INK2)
        a.set_xticks(np.arange(len(vals))); a.set_xticklabels(labels, fontsize=8)
        a.set_title(title, fontsize=8.5, loc='left'); a.set_ylim(0, max(vals) * 1.25); a.set_yticks([])
        a.grid(False); a.spines['left'].set_visible(False)
    save(fig, 'round13_fast')

def booklet():
    src = D / 'booklet'
    for p, name in [('pg1', 'bk_cover'), ('pg5', 'bk_steps'), ('pg18', 'bk_final'), ('pg19', 'bk_parts')]:
        f = src / f'{p}.png'
        if f.exists(): shutil.copy(f, F / f'{name}.png'); print('fig', name)
        else: print('missing', f)

if __name__ == '__main__':
    if WHAT in ('all', 'renders'): renders()
    if WHAT in ('all', 'plots'): fig_library(); fig_fast()
    if WHAT in ('all', 'booklet'): booklet()

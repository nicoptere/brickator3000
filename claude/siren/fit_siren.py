#!/usr/bin/env python3
"""Fit a SIREN signed-distance field to a GLB mesh and export it as a grid the brickgen engine can consume (`field: 'sdf'` +
`sdfGrid`), so the shape reaches the solver as a *band-limited* function whose smoothness is set by omega_0 and the network width -
not by a voxel resolution, and not by a filter applied after voxelisation.

    python fit_siren.py models/duck.glb --omega0 30 --steps 3000 --res 128 --out out/duck            # on the 4090: ~1-2 min
    python fit_siren.py models/duck.glb --fit none --res 96 --out out/duck_raw                        # no network: the raw sampled SDF, same format

Outputs <out>.sdf.json (header: nx ny nz origin step, model units, same frame as the engine's parseGLB = glTF world space, Y up)
and <out>.sdf.bin (float32 little-endian, index (k*ny + j)*nx + i for x = i, y = j, z = k). Load in Node with tools/sdf_grid.mjs.

Why SIREN (Sitzmann et al. 2020): sin(omega_0 W x + b) layers give a smooth, differentiable field whose spectrum starts at the
bandwidth omega_0 sets; the loss is the paper's eq. (6): eikonal |grad| = 1 everywhere, Phi = 0 and grad aligned with the normal on
the surface, exp(-alpha |Phi|) off the surface (no ground-truth distances needed). `--loss sdf` instead supervises a clamped L1
against distances to the sampled surface (DeepSDF / BACON style), which is more robust on non-watertight meshes.
docs/papers/IMPLICIT_FIELDS_AND_MESH_DENOISING.md has the references; docs/IMPLICIT.md the design.
"""
import argparse, json, math, struct, sys, time
from pathlib import Path
import numpy as np

# ----------------------------------------------------------------------------------------------------------------- GLB -> triangles
_CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
_N = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def _accessor(g, binb, ai):
    a = g['accessors'][ai]; bv = g['bufferViews'][a['bufferView']]
    fmt, size = _CT[a['componentType']]; n = _N[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', size * n)
    out = np.empty((a['count'], n), dtype=np.float64)
    for i in range(a['count']):
        out[i] = struct.unpack_from('<' + fmt * n, binb, off + i * stride)
    return out

def _node_matrix(nd):
    if 'matrix' in nd: return np.array(nd['matrix'], dtype=np.float64).reshape(4, 4).T          # glTF stores column-major
    T = np.eye(4); t = nd.get('translation', [0, 0, 0]); r = nd.get('rotation', [0, 0, 0, 1]); s = nd.get('scale', [1, 1, 1])
    x, y, z, w = r
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    T[:3, :3] = R * np.array(s)[None, :]; T[:3, 3] = t
    return T

def load_glb(path):
    """world-space triangles (N, 3, 3), the same frame as claude/app/src/brickgen/mesh.js parseGLB"""
    b = Path(path).read_bytes()
    assert b[:4] == b'glTF', 'not a GLB'
    off, g, binb = 12, None, None
    while off < len(b):
        ln, typ = struct.unpack_from('<II', b, off); chunk = b[off + 8: off + 8 + ln]
        if typ == 0x4E4F534A: g = json.loads(chunk.decode())
        elif typ == 0x004E4942: binb = chunk
        off += 8 + ln
    tris = []
    def visit(ni, P):
        nd = g['nodes'][ni]; M = P @ _node_matrix(nd)
        if 'mesh' in nd:
            for pr in g['meshes'][nd['mesh']]['primitives']:
                if pr.get('mode', 4) != 4: continue
                pos = _accessor(g, binb, pr['attributes']['POSITION'])
                idx = _accessor(g, binb, pr['indices'])[:, 0].astype(np.int64) if 'indices' in pr else np.arange(len(pos))
                wp = pos @ M[:3, :3].T + M[:3, 3]
                tris.append(wp[idx].reshape(-1, 3, 3))
        for ch in nd.get('children', []): visit(ch, M)
    for r in g['scenes'][g.get('scene', 0)]['nodes']: visit(r, np.eye(4))
    return np.concatenate(tris, 0)

# ---------------------------------------------------------------------------------------------------------------------- sampling
def surface_samples(tris, n, rng):
    """area-weighted points on the surface with face normals"""
    u = tris[:, 1] - tris[:, 0]; v = tris[:, 2] - tris[:, 0]; nrm = np.cross(u, v); area = 0.5 * np.linalg.norm(nrm, axis=1)
    keep = area > 0; tris, nrm, area = tris[keep], nrm[keep], area[keep]; nrm /= (2 * area)[:, None]
    f = rng.choice(len(tris), size=n, p=area / area.sum())
    r1 = np.sqrt(rng.random(n)); r2 = rng.random(n)
    p = (1 - r1)[:, None] * tris[f, 0] + (r1 * (1 - r2))[:, None] * tris[f, 1] + (r1 * r2)[:, None] * tris[f, 2]
    return p, nrm[f]

def signed_distance_to_samples(q, p, nrm, k=1):
    """DeepSDF-style ground truth: distance to the nearest surface sample, sign from the side of its normal. Grid-bucketed brute force."""
    from scipy.spatial import cKDTree
    tree = cKDTree(p); d, i = tree.query(q, k=1)
    s = np.sign(np.einsum('ij,ij->i', q - p[i], nrm[i])); s[s == 0] = 1
    return d * s

# ------------------------------------------------------------------------------------------------------------------------- SIREN
def fit_siren(pts, nrm, lo, hi, args, log=print):
    import torch, torch.nn as nn
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    centre = (lo + hi) / 2; half = (hi - lo).max() / 2 * 1.1                    # model -> [-1, 1]^3 (uniform scale, so distances scale by 1/half)
    X = torch.tensor((pts - centre) / half, dtype=torch.float32, device=dev); N = torch.tensor(nrm, dtype=torch.float32, device=dev)

    class Sine(nn.Module):
        def __init__(self, i, o, w0, first):
            super().__init__(); self.l = nn.Linear(i, o); self.w0 = w0
            b = 1 / i if first else math.sqrt(6 / i) / w0                                  # SIREN init (paper, sec. 3.2)
            nn.init.uniform_(self.l.weight, -b, b)
        def forward(self, x): return torch.sin(self.w0 * self.l(x))
    layers = [Sine(3, args.width, args.omega0, True)] + [Sine(args.width, args.width, args.omega0, False) for _ in range(args.layers - 2)]
    net = nn.Sequential(*layers, nn.Linear(args.width, 1)).to(dev)
    with torch.no_grad():
        b = math.sqrt(6 / args.width) / args.omega0; nn.init.uniform_(net[-1].weight, -b, b)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)
    gt_tree = None
    if args.loss == 'sdf':
        from scipy.spatial import cKDTree; gt_tree = cKDTree(pts)
    t0 = time.time()
    for step in range(args.steps):
        i = torch.randint(0, len(X), (args.batch,), device=dev); xs = X[i]; ns = N[i]
        xo = torch.rand(args.batch, 3, device=dev) * 2 - 1                                # uniform off-surface
        xn = xs + torch.randn_like(xs) * args.near                                        # near-surface perturbations
        x = torch.cat([xs, xo, xn], 0).requires_grad_(True)
        y = net(x); g = torch.autograd.grad(y.sum(), x, create_graph=True)[0]
        ys, yo, yn = y[:args.batch, 0], y[args.batch:2 * args.batch, 0], y[2 * args.batch:, 0]
        eik = ((g.norm(dim=1) - 1).abs()).mean()
        if args.loss == 'siren':
            on = ys.abs().mean(); normal = (1 - torch.nn.functional.cosine_similarity(g[:args.batch], ns, dim=1)).mean()
            off = torch.exp(-args.alpha * torch.cat([yo, yn]).abs()).mean()
            loss = 3e3 * on + 5e1 * eik + 1e2 * normal + 1e2 * off                      # weights of the reference implementation
        else:
            q = torch.cat([xo, xn], 0).detach().cpu().numpy() * half + centre
            d, j = gt_tree.query(q, k=1); s = np.sign(np.einsum('ij,ij->i', q - pts[j], nrm[j])); s[s == 0] = 1
            tgt = torch.tensor(d * s / half, dtype=torch.float32, device=dev)
            delta = args.clamp / half
            loss = (torch.clamp(torch.cat([yo, yn]), -delta, delta) - torch.clamp(tgt, -delta, delta)).abs().mean() + 1e-1 * ys.abs().mean() + 1e-1 * eik
        opt.zero_grad(); loss.backward(); opt.step()
        if step % max(1, args.steps // 10) == 0 or step == args.steps - 1:
            log(f'  step {step:5d}  loss {loss.item():.4f}  eikonal {eik.item():.3f}  {time.time() - t0:.0f}s')
    def evaluate(q):                                                                    # q: (M, 3) model units -> signed distance, model units
        out = []
        with torch.no_grad():
            for k in range(0, len(q), 65536):
                xq = torch.tensor((q[k:k + 65536] - centre) / half, dtype=torch.float32, device=dev)
                out.append(net(xq)[:, 0].cpu().numpy() * half)
        return np.concatenate(out)
    return evaluate

# --------------------------------------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('glb'); ap.add_argument('--out', required=True, help='output prefix (writes <out>.sdf.json + <out>.sdf.bin)')
    ap.add_argument('--fit', default='siren', choices=['siren', 'none'], help="'none' exports the raw sampled SDF (no network) - tests the engine side")
    ap.add_argument('--loss', default='siren', choices=['siren', 'sdf'])
    ap.add_argument('--omega0', type=float, default=30.0, help='first-layer frequency = the bandwidth of the representation (lower = smoother)')
    ap.add_argument('--width', type=int, default=256); ap.add_argument('--layers', type=int, default=5)
    ap.add_argument('--steps', type=int, default=3000); ap.add_argument('--batch', type=int, default=8192); ap.add_argument('--lr', type=float, default=1e-4)
    ap.add_argument('--near', type=float, default=0.02, help='sigma of near-surface samples, in the [-1,1] frame'); ap.add_argument('--alpha', type=float, default=100.0)
    ap.add_argument('--clamp', type=float, default=None, help='--loss sdf: clamp distance (model units); default 5 %% of the bbox')
    ap.add_argument('--samples', type=int, default=400000); ap.add_argument('--res', type=int, default=128, help='grid cells along the longest axis')
    ap.add_argument('--pad', type=float, default=0.05, help='grid padding as a fraction of the bbox'); ap.add_argument('--seed', type=int, default=1)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)
    tris = load_glb(args.glb); lo, hi = tris.reshape(-1, 3).min(0), tris.reshape(-1, 3).max(0)
    if args.clamp is None: args.clamp = 0.05 * (hi - lo).max()
    print(f'{args.glb}: {len(tris)} triangles, bbox {lo.round(3)} .. {hi.round(3)}')
    pts, nrm = surface_samples(tris, args.samples, rng)
    # the grid: padded bbox, isotropic step
    pad = args.pad * (hi - lo).max(); glo = lo - pad; ghi = hi + pad; step = (ghi - glo).max() / args.res
    n = np.ceil((ghi - glo) / step).astype(int) + 1
    gx, gy, gz = [glo[a] + step * np.arange(n[a]) for a in range(3)]
    Q = np.stack(np.meshgrid(gx, gy, gz, indexing='ij'), -1).reshape(-1, 3)          # (i, j, k) order ...
    if args.fit == 'siren':
        print(f'fitting SIREN {args.layers}x{args.width}, omega0 {args.omega0}, loss {args.loss}, {args.steps} steps')
        sdf = fit_siren(pts, nrm, lo, hi, args)(Q)
    else:
        print('exporting the raw sampled SDF (nearest surface sample, sign from its normal)')
        sdf = signed_distance_to_samples(Q, pts, nrm)
    D = sdf.reshape(n[0], n[1], n[2]).transpose(2, 1, 0)                                # ... -> data[(k*ny + j)*nx + i]
    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True)
    (out.parent / (out.name + '.sdf.bin')).write_bytes(D.astype('<f4').tobytes())
    hdr = {'nx': int(n[0]), 'ny': int(n[1]), 'nz': int(n[2]), 'origin': [float(v) for v in glo], 'step': float(step), 'units': 'model (glTF world space, Y up)',
           'source': str(args.glb), 'fit': args.fit, 'omega0': args.omega0 if args.fit == 'siren' else None, 'loss': args.loss if args.fit == 'siren' else None,
           'data': out.name + '.sdf.bin', 'layout': 'float32 LE, index (k*ny + j)*nx + i for x=i y=j z=k'}
    (out.parent / (out.name + '.sdf.json')).write_text(json.dumps(hdr, indent=1))
    inside = (sdf < 0).mean()
    print(f'wrote {out}.sdf.json/.bin: {n[0]}x{n[1]}x{n[2]} cells, step {step:.4f}, {inside * 100:.1f} % inside, |d| range {abs(sdf).min():.3f}..{abs(sdf).max():.3f}')

if __name__ == '__main__':
    main()

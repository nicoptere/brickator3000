#!/usr/bin/env python3
"""LDraw (.dat / .ldr / .mpd) -> coloured triangle soup, for the paper's figures (claude/paper/).

Recursive type-1 references with their 4x3 matrices, type 3 / 4 polygons (quads split), MPD `0 FILE` sections, colour 16 / 24
inheritance, LDConfig.ldr colours. Output is in LDraw coordinates (Y down, 1 stud = 20 LDU); `to_engine()` flips to the engine /
three.js frame (Y up) with D = diag(1, -1, -1), the same convention as claude/app/src/motifs/placements.js.

    from ldraw_mesh import Library
    lib = Library('/home/claude/ldraw/ldraw')
    tris, cols = lib.mesh_of_file('parts/3039.dat', color=4)          # (N,3,3) float32, (N,3) float32 rgb 0..1
    tris, cols = lib.mesh_of_text(open('model.mpd').read())            # a whole model
"""
import re
from functools import lru_cache
from pathlib import Path
import numpy as np

class Library:
    def __init__(self, root):
        self.root = Path(root)
        self.dirs = [self.root / 'parts', self.root / 'p', self.root / 'parts' / 's', self.root / 'p' / '48', self.root / 'p' / '8', self.root]
        self.index = {}
        for d in [self.root / 'parts', self.root / 'p', self.root / 'parts' / 's', self.root / 'p' / '48', self.root / 'p' / '8']:
            if d.exists():
                for f in d.iterdir():
                    if f.is_file(): self.index.setdefault(str(f.relative_to(self.root)).lower().replace('\\', '/'), f)
        self.colors = self._ldconfig()

    def _ldconfig(self):
        cols = {16: (0.8, 0.8, 0.8), 24: (0.2, 0.2, 0.2)}
        p = self.root / 'LDConfig.ldr'
        if p.exists():
            for line in p.read_text(errors='ignore').splitlines():
                m = re.search(r'!COLOUR\s+\S+\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})', line)
                if m: cols[int(m.group(1))] = tuple(int(m.group(2)[i:i + 2], 16) / 255 for i in (0, 2, 4))
        return cols

    def read(self, name):
        n = name.lower().replace('\\', '/')
        for pre in ('parts/', 'p/', 'parts/s/', 'p/48/', 'p/8/', ''):
            f = self.index.get(pre + n)
            if f: return f.read_text(errors='ignore')
        for d in self.dirs:
            f = d / name
            if f.exists(): return f.read_text(errors='ignore')
        return None

    @staticmethod
    def parse(text):
        """{ name: [lines] } for every `0 FILE` section ('' when the text has none); each line is a tuple (type, color, numbers/file)"""
        files, cur = {}, ''
        files[cur] = []
        for raw in text.splitlines():
            s = raw.strip()
            if not s: continue
            if s.upper().startswith('0 FILE '):
                cur = s[7:].strip().lower(); files.setdefault(cur, []); continue
            if s.upper().startswith('0 NOFILE'): cur = ''; files.setdefault(cur, []); continue
            t = s.split()
            if t[0] == '1' and len(t) >= 15:
                try: v = [float(x) for x in t[2:14]]
                except ValueError: continue
                files[cur].append(('1', int(t[1]), v, ' '.join(t[14:]).lower().replace('\\', '/')))
            elif t[0] in ('3', '4'):
                k = 3 if t[0] == '3' else 4
                if len(t) < 2 + 3 * k: continue
                try: v = [float(x) for x in t[2:2 + 3 * k]]
                except ValueError: continue
                files[cur].append((t[0], int(t[1]), v, None))
        return files

    @lru_cache(maxsize=None)
    def _part(self, name):
        text = self.read(name)
        return None if text is None else self.parse(text)

    def _emit(self, files, fname, M, color, out, depth, max_depth):
        if depth > max_depth: return
        lines = files.get(fname)
        if lines is None:
            part = self._part(fname)
            if part is None: return
            lines = part.get('') or next(iter(part.values()), [])
            files = part
        for typ, col, v, sub in lines:
            c = color if col in (16, 24) else col
            if typ == '1':
                T = np.array([[v[3], v[4], v[5], v[0]], [v[6], v[7], v[8], v[1]], [v[9], v[10], v[11], v[2]], [0, 0, 0, 1]])
                self._emit(files, sub, M @ T, c, out, depth + 1, max_depth)
            else:
                P = np.array(v).reshape(-1, 3); P = (M[:3, :3] @ P.T).T + M[:3, 3]
                rgb = ((c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255) if c >= 0x2000000 else self.colors.get(c, (0.6, 0.6, 0.6))   # 0x2RRGGBB = direct colour
                if len(P) == 3: out.append((P, rgb))
                else: out.append((P[[0, 1, 2]], rgb)); out.append((P[[0, 2, 3]], rgb))

    def mesh_of_text(self, text, color=16, max_depth=40):
        files = self.parse(text); main = next((k for k, v in files.items() if v), '')     # the first section that has content (an MPD starts with its own `0 FILE`)
        out = []
        self._emit(files, main, np.eye(4), color, out, 0, max_depth)
        return self._pack(out)

    def mesh_of_file(self, name, color=16, max_depth=40):
        out = []
        self._emit({}, name.lower(), np.eye(4), color, out, 0, max_depth)
        return self._pack(out)

    @staticmethod
    def _pack(out):
        if not out: return np.zeros((0, 3, 3), np.float32), np.zeros((0, 3), np.float32)
        tris = np.stack([p for p, _ in out]).astype(np.float32); cols = np.array([c for _, c in out], np.float32)
        return tris, cols

def to_engine(tris):
    """LDraw (Y down) -> engine / three.js (Y up): D = diag(1, -1, -1)"""
    t = tris.copy(); t[..., 1] *= -1; t[..., 2] *= -1
    return t

def placements_mesh(lib, placements, color_of=None):
    """[{ 'file': '3005.dat', 'color': 4, 't': [x,y,z], 'M': [9] }] (LDraw frame) -> triangle soup"""
    out = []
    for p in placements:
        M = np.eye(4); M[:3, :3] = np.array(p['M']).reshape(3, 3); M[:3, 3] = p['t']
        tris, cols = lib.mesh_of_file(p['file'], color=p.get('color', 16))
        if len(tris): out.append(((M[:3, :3] @ tris.reshape(-1, 3).T).T.reshape(-1, 3, 3) + M[:3, 3], cols if color_of is None else np.tile(color_of(p), (len(tris), 1))))
    if not out: return np.zeros((0, 3, 3), np.float32), np.zeros((0, 3), np.float32)
    return np.concatenate([o[0] for o in out]).astype(np.float32), np.concatenate([o[1] for o in out]).astype(np.float32)

if __name__ == '__main__':
    import sys
    lib = Library(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/ldraw/ldraw')
    t, c = lib.mesh_of_file('3039.dat', color=4)
    print('3039.dat:', len(t), 'triangles, bbox', t.reshape(-1, 3).min(0), t.reshape(-1, 3).max(0))

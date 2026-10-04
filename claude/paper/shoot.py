#!/usr/bin/env python3
"""Render scene JSONs to PNG with render.html through Playwright/Chromium (software WebGL is fine for stills).

    from shoot import Shooter
    with Shooter(workdir) as sh:            # workdir holds render.html, node_modules/three, scenes/, png/
        sh.scene('duck', groups=[{'pos': tris.ravel().tolist(), 'col': cols.ravel().tolist()}], view='iso')
        sh.shoot('duck', w=1400, h=1000)    # -> workdir/png/duck.png
"""
import json, shutil, subprocess, sys, time
from pathlib import Path

class Shooter:
    def __init__(self, workdir, port=8765, html=Path(__file__).with_name('render.html')):
        self.wd = Path(workdir); self.port = port
        (self.wd / 'scenes').mkdir(parents=True, exist_ok=True); (self.wd / 'png').mkdir(exist_ok=True)
        shutil.copy(html, self.wd / 'render.html')
        self.srv = None; self.pw = None; self.browser = None

    def __enter__(self):
        self.srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(self.port), '--bind', '127.0.0.1'], cwd=self.wd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
        time.sleep(0.5)
        return self

    def __exit__(self, *a):
        if self.browser: self.browser.close()
        if self.pw: self.pw.stop()
        if self.srv: self.srv.terminate()

    def scene(self, name, **scene):
        (self.wd / 'scenes' / f'{name}.json').write_text(json.dumps(scene))

    def shoot(self, name, w=1400, h=1000, out=None, timeout=120000):
        page = self.browser.new_page(viewport={'width': w, 'height': h})
        page.on('pageerror', lambda e: print('  page error:', e))
        page.goto(f'http://127.0.0.1:{self.port}/render.html?scene={name}.json&w={w}&h={h}', timeout=timeout)
        page.wait_for_function('window.__ready === true', timeout=timeout)
        out = Path(out) if out else self.wd / 'png' / f'{name}.png'
        page.screenshot(path=str(out), omit_background=True)
        page.close()
        return out

def soup_group(tris, cols, **kw):
    """(N,3,3) triangles + (N,3) per-triangle colours -> a scene group with per-vertex colours"""
    import numpy as np
    pos = np.asarray(tris, np.float32).reshape(-1).tolist()
    c = np.repeat(np.asarray(cols, np.float32), 3, axis=0).reshape(-1).tolist()
    return {'pos': pos, 'col': c, **kw}

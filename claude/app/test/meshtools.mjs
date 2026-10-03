import { fixWinding, meshIslands } from '../src/studio/meshtools.js';
// two cubes (separate islands), one triangle of the first reversed
const cube = (ox) => { const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map((p) => [p[0]+ox,p[1],p[2]]);
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,6,2],[3,7,6],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
  return f.flatMap((t) => t.flatMap((i) => v[i])); };
const A = cube(0), B = cube(3), tris = Float32Array.from([...A, ...B]);
const bad = Float32Array.from(tris); for (let k = 0; k < 3; k++) { const x = bad[3 + k]; bad[3 + k] = bad[6 + k]; bad[6 + k] = x; }
const vc = new Float32Array(tris.length).fill(0.5);
const ok = fixWinding(tris, vc), fx = fixWinding(bad, vc);
console.log('clean flipped', ok.flipped, '| one reversed ->', fx.flipped, 'restored', fx.tris.every((v, i) => Math.abs(v - tris[i]) < 1e-6));
const il = meshIslands(tris); console.log('islands', il.count, Array.from(il.labels).join(''));
import * as THREE from 'three';
const sp = new THREE.IcosahedronGeometry(1, 4).toNonIndexed(), S = Float32Array.from(sp.attributes.position.array);
const Sb = Float32Array.from(S); const nt = S.length / 9; let n = 0;
for (let t = 3; t < nt; t += 37) { n++; for (let k = 0; k < 3; k++) { const x = Sb[t * 9 + 3 + k]; Sb[t * 9 + 3 + k] = Sb[t * 9 + 6 + k]; Sb[t * 9 + 6 + k] = x; } }
const r = fixWinding(Sb, new Float32Array(S.length));
console.log('sphere: reversed', n, 'flipped', r.flipped, 'restored', r.tris.every((v, i) => Math.abs(v - S[i]) < 1e-6));

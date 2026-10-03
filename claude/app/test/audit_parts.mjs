import { template } from '../src/brickgen/export.js';
import CAT from '../src/brickgen/catalog.js';
import EXT from '../src/brickgen/catalog_ext.js';
const STUD=20, PLATE=8, G=5;
const rows=[];
for (const c of [...CAT.map(c=>({c,set:'core'})), ...EXT.map(c=>({c,set:'ext'}))]) {
  const p=c.c, t=template(p,0), pos=t.pos;
  const lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
  for(let i=0;i<pos.length;i+=3) for(let a=0;a<3;a++){ if(pos[i+a]<lo[a])lo[a]=pos[i+a]; if(pos[i+a]>hi[a])hi[a]=pos[i+a]; }
  const bw=hi[0]-lo[0], bh=hi[1]-lo[1], bd=hi[2]-lo[2];
  // declared
  const dw=p.w*STUD, dd=p.d*STUD, dh=p.h*PLATE;
  // top profile max
  let tmax=0; for(const r of p.top) for(const v of r) tmax=Math.max(tmax,v);
  // flat full-height cells (cells where the whole 5x5 block is at full height)
  let flat=0;
  for(let j=0;j<p.d;j++) for(let i=0;i<p.w;i++){ let ok=true;
    for(let b=0;b<G;b++) for(let a=0;a<G;a++) if(p.top[j*G+b][i*G+a] < tmax-0.6) ok=false;
    if(ok) flat++; }
  rows.push({ id:p.id, set:c.set, kind:p.kind, name:p.name, w:p.w, d:p.d, h:p.h,
    dxerr:+(bw-dw).toFixed(1), dzerr:+(bd-dd).toFixed(1), dyerr:+(bh-dh).toFixed(1),
    studs:(p.stud_cells||[]).length, flat, tris:t.idx.length/3 });
}
const bad=rows.filter(r=> Math.abs(r.dxerr)>2.5 || Math.abs(r.dzerr)>2.5 || Math.abs(r.dyerr)>2.5);
console.log('--- bbox mismatch (rendered vs declared), tolerance 2.5 LDU:', bad.length);
for(const r of bad) console.log(' ', r.set, r.id, r.kind, r.name, 'err x/y/z =', r.dxerr, r.dyerr, r.dzerr);
const studless=rows.filter(r=> r.kind!=='tile' && r.studs===0 && r.flat>0);
console.log('\n--- flat top but NO studs recorded:', studless.length);
for(const r of studless) console.log(' ', r.set, r.id, r.kind, r.name, 'flat cells', r.flat);
const under=rows.filter(r=> r.kind!=='tile' && r.studs>0 && r.flat>r.studs);
console.log('\n--- fewer studs than flat cells:', under.length);
for(const r of under) console.log(' ', r.set, r.id, r.kind, r.name, 'studs', r.studs, 'flat', r.flat);
const tiny=rows.filter(r=>r.tris<12);
console.log('\n--- suspiciously few triangles:', tiny.length, tiny.map(r=>r.set+':'+r.id).join(' '));

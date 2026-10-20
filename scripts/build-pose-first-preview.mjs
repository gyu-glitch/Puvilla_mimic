// Inspect operation order without changing the official model or live rig.
import {readFileSync,writeFileSync} from 'node:fs';
import {parseObj} from '../src/character/subdivide.ts';
import {socketCorrective} from './standing-socket-corrective.mjs';
const raw=readFileSync('public/models/pu_stand.obj','utf8');
const parts=parseObj(raw),body=parts.find(p=>p.name==='pu_body');
const rig=JSON.parse(readFileSync('public/models/stand_connected_rig.json','utf8'));
const P=body.positions,neighbors=P.map(()=>[]),edges=new Set();
for(const q of body.faces)for(let k=0;k<q.length;k++){
 const a=q[k],b=q[(k+1)%q.length],key=[a,b].sort((a,b)=>a-b).join(',');
 if(edges.has(key))continue;edges.add(key);
 const d=Math.hypot(...P[a].map((v,j)=>v-P[b][j]));
 neighbors[a].push([b,d]);neighbors[b].push([a,d]);
}
const result=socketCorrective(P,neighbors,rig.weights,rig.joints,true);
// Wave only on screen-left. All other source points remain exact.
const moved=P.map((p,i)=>p[0]<0?result.fair[i]:p);
let offset=1,uvOffset=1,out=[];
for(const part of parts){
 out.push('o '+part.name);
 const positions=part===body?moved:part.positions;
 for(const p of positions)out.push('v '+p.join(' '));
 for(const uv of part.uvs)out.push('vt '+uv.join(' '));
 part.faces.forEach((f,i)=>out.push('f '+f.map((v,k)=>part.faceUvs[i]?`${v+offset}/${part.faceUvs[i][k]+uvOffset}`:`${v+offset}`).join(' ')));
 offset+=positions.length;uvOffset+=part.uvs.length;
}
writeFileSync('dev/stand_pose_first_preview.obj',out.join('\n'));
console.log('Saved pose-first static preview; source OBJ and production rig untouched.');

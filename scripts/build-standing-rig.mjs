// Derive skin weights from the ORIGINAL connected quad topology. No mesh cuts or vertex moves.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseObj } from '../src/character/subdivide.ts';
import { socketCorrective } from './standing-socket-corrective.mjs';

const source = readFileSync('public/models/pu_stand.obj', 'utf8');
const socketWidth=Number(process.argv.find(a=>a.startsWith('--socket-width='))?.split('=')[1]??18);
const socketRise=Number(process.argv.find(a=>a.startsWith('--socket-rise='))?.split('=')[1]??1);
const socketWrap=process.argv.includes('--socket-wrap');
if(!Number.isFinite(socketRise)||socketRise<0||socketRise>15)throw new Error('Socket rise must be 0..15 cm');
if(!Number.isFinite(socketWidth)||socketWidth<6||socketWidth>30)throw new Error('Socket width must be 6..30 cm');
const mesh = parseObj(source).find(m => m.name === 'pu_body');
if (!mesh || mesh.faces.some(f => f.length !== 4)) throw new Error('Expected original quad body');
const P=mesh.positions,Q=mesh.faces;
const key=(a,b)=>a<b?`${a},${b}`:`${b},${a}`;
const edges=new Map(),neighbors=P.map(()=>[]);
Q.forEach((f,fi)=>f.forEach((a,k)=>{
 const b=f[(k+1)%4],id=key(a,b);
 if(!edges.has(id))edges.set(id,{a,b,faces:[]});edges.get(id).faces.push(fi);
}));
const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
for(const {a,b} of edges.values()){const d=distance(P[a],P[b]);neighbors[a].push([b,d]);neighbors[b].push([a,d]);}
const mean=ids=>[0,1,2].map(k=>ids.reduce((s,i)=>s+P[i][k],0)/ids.length);
function ring(start){let edge=start,previous=-1;const result=[];
 for(let n=0;n<400;n++){
  result.push(edge);const e=edges.get(edge),fi=e.faces.find(f=>f!==previous);if(fi===undefined)return null;
  const q=Q[fi],k=q.findIndex((a,i)=>key(a,q[(i+1)%4])===edge);
  const next=key(q[(k+2)%4],q[(k+3)%4]);if(next===start)return result;
  previous=fi;edge=next;
 }return null;
}
function distances(seeds,allowed){
 const d=new Float64Array(P.length).fill(Infinity),queue=[];for(const v of seeds){d[v]=0;queue.push(v);}
 // Small original cage: ordered Dijkstra queue is sufficient, no runtime solve.
 while(queue.length){queue.sort((a,b)=>d[b]-d[a]);const v=queue.pop();
  for(const [u,len] of neighbors[v])if(allowed.has(u)&&d[v]+len<d[u]){d[u]=d[v]+len;if(!queue.includes(u))queue.push(u);}
 }return d;
}
const smooth=(lo,hi,x)=>{const t=Math.min(1,Math.max(0,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
const weights=P.map(()=>[0,0,0]);const joints={},armInterior=new Set();
for(const side of [-1,1]){
 const visited=new Set(),rungs=[];
 for(const [id,e] of edges){
  if(visited.has(id)||![e.a,e.b].every(v=>P[v][0]*side>25&&P[v][1]<125))continue;
  const r=ring(id);if(!r)continue;for(const edge of r)visited.add(edge);
  if(r.length!==16)continue;
  const vertices=r.flatMap(id=>{const e=edges.get(id);return [e.a,e.b];}),c=mean(vertices);
  const radius=vertices.reduce((s,v)=>s+Math.hypot(P[v][0]-c[0],P[v][2]-c[2]),0)/vertices.length;
  if(c[0]*side>27&&radius>3)rungs.push({y:c[1],vertices:new Set(vertices)});
 }
 rungs.sort((a,b)=>a.y-b.y);if(rungs.length<3)throw new Error(`Arm rings not found: ${side}`);
 const base=[...rungs.at(-1).vertices].filter(v=>rungs.at(-2).vertices.has(v));
 const baseSet=new Set(base),barrier=new Set([...edges].filter(([,e])=>baseSet.has(e.a)&&baseSet.has(e.b)).map(([id])=>id));
 let start=0,best=-Infinity;Q.forEach((q,i)=>{const c=mean(q),score=c[0]*side-Math.abs(c[1]-58)*.5;if(score>best){best=score;start=i;}});
 const faces=new Set([start]),stack=[start];
 while(stack.length){const fi=stack.pop(),q=Q[fi];for(let k=0;k<4;k++){
  const id=key(q[k],q[(k+1)%4]);if(barrier.has(id))continue;
  for(const f of edges.get(id).faces)if(!faces.has(f)){faces.add(f);stack.push(f);}
 }}
 if(faces.size<100||faces.size>Q.length*.3)throw new Error(`Invalid arm region: ${faces.size}`);
 const arm=new Set([...faces].flatMap(f=>Q[f])),torso=new Set(P.map((_,i)=>i).filter(i=>!arm.has(i)||baseSet.has(i)));
 const da=distances(base,arm),dt=distances(base,torso),socket=mean(base);
 for(const i of arm)if(!baseSet.has(i))armInterior.add(i);
 const max=Math.max(...[...arm].map(i=>da[i]));
 const at=t=>mean([...arm].filter(i=>Math.abs(da[i]-max*t)<3));
 const shoulder=[socket[0]-side*2,socket[1],socket[2]],elbow=at(.50),hand=at(.90);
 joints[side>0?'L':'R']={shoulder,elbow,hand};
 for(let i=0;i<P.length;i++){
  // Torso vertices are anchors. Blend on the arm side of the socket only;
  // raising a hand must not pull the belly or flank into the shoulder.
  let w=arm.has(i)? smooth(0,socketWidth,da[i]) : 0;
  if(socketWrap)w=arm.has(i)?smooth(-8,8,da[i]):smooth(-8,8,-dt[i])*smooth(84,96,P[i][1]);
  if(!Number.isFinite(w))w=0;
  w*=smooth(15,22,Math.abs(P[i][0]))*(1-smooth(socketWrap?119:110,socketWrap?128:119,P[i][1]));
  weights[i][side>0?0:1]=w;
  if(arm.has(i))weights[i][2]=w*smooth(.34,.68,da[i]/max);
 }
 console.log({side,faces:faces.size,vertices:arm.size,socket,shoulder,elbow,hand,length:max});
}
// Use a symmetric neutral skeleton; sampling a different number of cage vertices per side
// must not place the two elbows at different heights.
for(const key of ['shoulder','hand']){
 const l=joints.L[key],r=joints.R[key],v=[(Math.abs(l[0])+Math.abs(r[0]))/2,(l[1]+r[1])/2,(l[2]+r[2])/2];
 joints.L[key]=v;joints.R[key]=[-v[0],v[1],v[2]];
}
for(const side of ['L','R'])joints[side].elbow=joints[side].shoulder.map((v,i)=>(v+joints[side].hand[i])/2);
const portrait=!process.argv.includes('--legacy')&&!process.argv.includes('--sections');
if(portrait)for(const side of ['L','R']){
 joints[side].shoulder[1]+=socketRise;
 joints[side].elbow=joints[side].shoulder.map((v,i)=>(v+joints[side].hand[i])/2);
}
// Experimental cross-section weights: every point on a plane normal to the
// neutral limb axis receives the same elbow blend, irrespective of surface path.
const sections=portrait||process.argv.includes('--sections');
if(sections){
 for(let i=0;i<P.length;i++){
  const side=P[i][0]>=0?'L':'R',j=joints[side];
  const axis=j.hand.map((v,k)=>v-j.shoulder[k]),length=Math.hypot(...axis);
  const along=P[i].reduce((s,v,k)=>s+(v-j.elbow[k])*axis[k]/length,0);
  weights[i][2]=(weights[i][0]+weights[i][1])*smooth(-6,6,along);
 }
}
const finishPasses=Number(process.argv.find(a=>a.startsWith('--fair-finish='))?.split('=')[1]??8);
if(!Number.isInteger(finishPasses)||finishPasses<0||finishPasses>40)throw new Error('Fair finish must be 0..40');
const corrective=socketCorrective(P,neighbors,weights,joints,false,finishPasses);
const torsoAnchors=P.map((_,i)=>i).filter(i=>socketWrap?weights[i][0]+weights[i][1]===0:!armInterior.has(i));
const data={version:1,sourceSha256:createHash('sha256').update(source).digest('hex'),body:mesh.name,rest:P,weights,joints,corrective,torsoAnchors};
if(socketWrap){
 data.deformation='pose-first-cage';
 data.shoulderSkin=P.map((_,i)=>i).filter(i=>!armInterior.has(i)&&weights[i][0]+weights[i][1]>0);
 data.buildOptions={socketWrap:true,finishPasses,socketRise};
}
const suffix=process.argv.includes('--portrait')?'_portrait':process.argv.includes('--sections')?'_sections':process.argv.includes('--legacy')?'_legacy':'';
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9)??`public/models/stand_connected_rig${suffix}.json`;
writeFileSync(output,JSON.stringify(data));
console.log(`Saved connected rig: ${P.length} cage vertices, original topology unchanged.`);

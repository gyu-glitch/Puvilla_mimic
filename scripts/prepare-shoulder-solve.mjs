import {readFileSync,writeFileSync} from 'node:fs';
import * as T from 'three';
import {parseObj} from '../src/character/subdivide.ts';
import {roundedElbowCenter} from '../src/character/standingBend.ts';
import {socketCorrective} from './standing-socket-corrective.mjs';
const rigPath=process.argv.find(a=>a.startsWith('--rig='))?.slice(6)??'public/models/stand_connected_rig.json';
const rig=JSON.parse(readFileSync(rigPath,'utf8'));
const body=parseObj(readFileSync('public/models/pu_stand.obj','utf8')).find(p=>p.name===rig.body);
const P=body.positions,neighbors=P.map(()=>[]),edges=new Set();
for(const q of body.faces)for(let k=0;k<q.length;k++){
 const a=q[k],b=q[(k+1)%q.length],key=[a,b].sort((a,b)=>a-b).join(',');
 if(edges.has(key))continue;edges.add(key);const d=Math.hypot(...P[a].map((x,j)=>x-P[b][j]));neighbors[a].push([b,d]);neighbors[b].push([a,d]);
}
const preview=socketCorrective(P,neighbors,rig.weights,rig.joints,true),smooth=(a,b,x)=>{let t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const along=[];
const posed=P.map((p,i)=>{
 const side=p[0]>=0?1:-1,j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),axis=new T.Vector3(...j.hand).sub(s),len=axis.length();axis.normalize();
 const polar=a=>new T.Vector3(side*Math.sin(a)*Math.cos(.08),-Math.cos(a),Math.sin(a)*Math.sin(.08)).normalize();
 const upper=polar(2.32),fore=polar(2.80),q=new T.Quaternion().setFromUnitVectors(axis,upper);
 const delta=new T.Vector3(...p).sub(s),distance=delta.dot(axis),mask=rig.weights[i][0]+rig.weights[i][1];along[i]=distance/len;
 const blend=smooth(.95,1,mask*(1-smooth(112,131,p[1])));if(!blend)return preview.posed[i];
 const radial=delta.addScaledVector(axis,-distance).applyAxisAngle(axis,side*(-Math.PI/2)*smooth(.3,.84,distance/len)*mask).applyQuaternion(q);
 const hinge=upper.clone().cross(fore).normalize(),theta=upper.angleTo(fore),width=Math.min(.6*len,Math.max(.36*len,theta*.32*len));
 const t=smooth(.5*len-.5*width,.5*len+.5*width,distance);
 const rounded=s.add(roundedElbowCenter(distance,len,upper,fore)).add(radial.applyAxisAngle(hinge,theta*t));
 return new T.Vector3(...preview.posed[i]).lerp(rounded,blend).toArray();
});
// Recover actual circumferential cage loops, so the solve can resist flattening
// a round arm into a ribbon while still retaining the connected source mesh.
const edgeFaces=new Map(),key=(a,b)=>a<b?`${a},${b}`:`${b},${a}`;
body.faces.forEach((q,fi)=>q.forEach((a,k)=>{const id=key(a,q[(k+1)%q.length]);const list=edgeFaces.get(id)??[];list.push(fi);edgeFaces.set(id,list);}));
const rings=[];
for(const side of [-1,1]){
 const seen=new Set(),rungs=[];
 for(const start of edgeFaces.keys()){
  if(seen.has(start)||!start.split(',').map(Number).every(i=>P[i][0]*side>25&&P[i][1]<125))continue;
  let e=start,previous=-1,r=[];
  for(let n=0;n<400;n++){
   r.push(e);const fi=edgeFaces.get(e).find(x=>x!==previous);if(fi===undefined)break;
   const q=body.faces[fi],k=q.findIndex((a,i)=>key(a,q[(i+1)%q.length])===e);if(q.length!==4)break;
   const next=key(q[(k+2)%4],q[(k+3)%4]);previous=fi;e=next;if(e===start)break;
  }
  if(e!==start||r.length!==16)continue;
  r.forEach(e=>seen.add(e));const ids=[...new Set(r.flatMap(e=>e.split(',').map(Number)))];
  rungs.push(ids);
 }
 const found=new Set();for(let a=0;a<rungs.length;a++)for(let b=a+1;b<rungs.length;b++){
  const ring=rungs[a].filter(i=>rungs[b].includes(i));if(ring.length!==16)continue;
  const id=ring.slice().sort((a,b)=>a-b).join(',');if(!found.has(id)){rings.push(ring);found.add(id);}
 }
}
writeFileSync('dev/shoulder-solve-input.json',JSON.stringify({rig,faces:body.faces,rings,posed,along,initial:posed.map((p,i)=>p.map((v,k)=>v+rig.corrective[i][k]))}));
console.log('Circumferential loops:',rings.length);

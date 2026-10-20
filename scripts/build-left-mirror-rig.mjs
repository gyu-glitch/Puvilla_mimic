import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');const {parseObj}=await import('../src/character/subdivide.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json'));const out=structuredClone(rig);
const part=parseObj(readFileSync('public/models/pu_stand.obj','utf8')).find(p=>p.name==='pu_body');
const triangles=[];
for(const face of part.faces)if(face.every(i=>rig.rest[i][0]>0))for(let k=1;k<face.length-1;k++){
 const ids=[face[0],face[k],face[k+1]];triangles.push({ids,t:new T.Triangle(...ids.map(i=>new T.Vector3(...rig.rest[i])))});
}
const q=new T.Vector3(),b=new T.Vector3(),near=new T.Vector3(),weights=new T.Vector3(),corr=new T.Vector3();let changed=0,maxDistance=0,maxWeight=0,maxCorrection=0;
for(let i=0;i<rig.rest.length;i++){
 const p=rig.rest[i];if(p[0]>=0||rig.weights[i][1]<=0)continue;
 q.set(-p[0],p[1],p[2]);let best=Infinity,chosen=null;
 for(const tri of triangles){tri.t.closestPointToPoint(q,near);const d=q.distanceToSquared(near);if(d<best){best=d;chosen=tri;tri.t.getBarycoord(near,b);weights.copy(b);}}
 if(!chosen)throw Error('source surface missing');maxDistance=Math.max(maxDistance,Math.sqrt(best));
 const weight=[0,0,0];corr.set(0,0,0);
 chosen.ids.forEach((id,k)=>{weight[1]+=rig.weights[id][0]*weights.getComponent(k);weight[2]+=rig.weights[id][2]*weights.getComponent(k);corr.addScaledVector(new T.Vector3(...rig.corrective[id]),weights.getComponent(k));});
 corr.x=-corr.x;
 // Existing torso anchors and protected head/forearm regions stay unchanged.
 const joint=rig.joints.R,s=new T.Vector3(...joint.shoulder),axis=new T.Vector3(...joint.hand).sub(s),along=new T.Vector3(...p).sub(s).dot(axis)/axis.lengthSq();
 if(p[1]>=119||along>=.48)corr.set(0,0,0);
 maxWeight=Math.max(maxWeight,...weight.map((v,k)=>Math.abs(v-rig.weights[i][k])));maxCorrection=Math.max(maxCorrection,corr.distanceTo(new T.Vector3(...rig.corrective[i])));
 out.weights[i]=weight;out.corrective[i]=corr.toArray();changed++;
}
for(let i=0;i<rig.rest.length;i++){
 assert.deepEqual(out.rest[i],rig.rest[i]);
 if(rig.rest[i][0]>=0||rig.weights[i][0]+rig.weights[i][1]===0){assert.deepEqual(out.weights[i],rig.weights[i]);assert.deepEqual(out.corrective[i],rig.corrective[i]);}
 assert.ok(out.weights[i].every(Number.isFinite)&&out.corrective[i].every(Number.isFinite));
 assert.ok(out.weights[i][2]<=out.weights[i][0]+out.weights[i][1]+1e-8);
}
out.review='v23 candidate: mirror screen-right weights/corrective onto existing screen-left surface only; original rest vertices untouched';
writeFileSync(process.argv[2]??'dev/stand_socket_mirrorleft.json',JSON.stringify(out));console.log({changed,maxDistance,maxWeight,maxCorrection});

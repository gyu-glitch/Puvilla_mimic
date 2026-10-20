import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {parseObj,subdivide,toBufferGeometry}=await import('../src/character/subdivide.ts');
const {StandingCageSurface}=await import('../src/character/standingCageSurface.ts');
const {StandingArmSurface}=await import('../src/character/standingArmSurface.ts');
const part=parseObj(readFileSync('public/models/pu_stand.obj','utf8')).find(p=>p.name==='pu_body');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json','utf8'));
const baselineRig=JSON.parse(readFileSync('public/models/stand_connected_rig.json','utf8'));
assert.deepEqual(rig.rest,part.positions,'cage source changed');
assert.equal(rig.shoulderSkin.length,80,'unexpected shoulder support expansion');
assert.equal(rig.torsoAnchors.length,1292);
const shoulderSkin=new Set(rig.shoulderSkin);
for(const i of baselineRig.torsoAnchors){
 const [x,y]=rig.rest[i];
 if(!shoulderSkin.has(i)){assert.deepEqual(rig.weights[i],[0,0,0]);assert.deepEqual(rig.corrective[i],[0,0,0]);}
 else assert.ok(Math.abs(x)>18 && Math.abs(x)<34 && y>87 && y<127,'shoulder influence escaped its local patch');
}
for(const i of rig.torsoAnchors){assert.deepEqual(rig.weights[i],[0,0,0]);assert.deepEqual(rig.corrective[i],[0,0,0]);}
rig.corrective.forEach((d,i)=>{assert.ok(d.every(Number.isFinite)&&Math.hypot(...d)<9);if(rig.rest[i][1]>=119)assert.deepEqual(d,[0,0,0]);});
const geo=toBufferGeometry(subdivide(part,2)),skin=new T.BufferGeometry();
const aw=toBufferGeometry(subdivide({...part,positions:rig.weights},2));
const cg=toBufferGeometry(subdivide({...part,positions:rig.corrective},2));
geo.setAttribute('connectedArmWeights',aw.getAttribute('position'));
geo.setAttribute('connectedArmCorrective',cg.getAttribute('position'));
const indices=[],weights=[];
for(const w of rig.weights){indices.push(0,1,0,0);weights.push(1-w[0]-w[1],w[0]+w[1],0,0);}
skin.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));skin.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
const surface=new StandingArmSurface(rig.joints),cage=new StandingCageSurface(part,2,rig,skin,geo,surface);
const root=new T.Group(),mesh=new T.SkinnedMesh(geo,new T.MeshBasicMaterial()),a=new T.Bone(),b=new T.Bone();
root.add(mesh,a);a.add(b);root.updateMatrixWorld(true);
const skeleton=new T.Skeleton([a,b]);mesh.bind(skeleton);cage.bind(mesh);
// Shader input is observable without a GPU. The neutral pose must reconstruct
// the exact original subdivision, including normals across UV seam duplicates.
cage.update();const pos=geo.getAttribute('position'),normal=geo.getAttribute('normal');
let maxPosition=0,maxNormal=0,active=0;
for(let i=0;i<pos.count;i++)if(cage.data[i*8+3]){active++;
 for(let k=0;k<3;k++){maxPosition=Math.max(maxPosition,Math.abs(cage.data[i*8+k]-pos.array[i*3+k]));maxNormal=Math.max(maxNormal,Math.abs(cage.data[i*8+4+k]-normal.array[i*3+k]));}
}
assert.ok(active>1000);assert.ok(maxPosition<2e-5);assert.ok(maxNormal<2e-6);
const original=cage.data.slice();
// Moving/rotating/scaling the entire character must not apply that transform
// twice inside its local-space pose texture.
root.position.set(3,4,5);root.rotation.set(.2,.7,-.3);root.scale.setScalar(.01);root.updateMatrixWorld(true);cage.update();
let transformError=0;original.forEach((v,i)=>transformError=Math.max(transformError,Math.abs(v-cage.data[i])));
assert.ok(transformError<2e-5,`parent transform leaked ${transformError}`);
const count=cage.evaluationCount;cage.update();assert.equal(cage.evaluationCount,count,'unchanged pose was reevaluated');
b.rotation.z=.8;cage.update();assert.ok(cage.data.every(Number.isFinite));
assert.equal(cage.evaluationCount,count+1,'changed pose was cached');
console.log({active,maxPosition,maxNormal,transformError,cpuMilliseconds:cage.lastMilliseconds});

// Exercise the rounded-elbow path with its actual eight-bone indices. Distal
// paw distances must survive a large bend and roll; no scale compensation.
root.remove(a);root.position.set(0,0,0);root.rotation.set(0,0,0);root.scale.setScalar(1);
const bones=Array.from({length:8},()=>new T.Bone());bones.forEach(b=>root.add(b));
for(const [side,upper,fore] of [['L',4,5],['R',6,7]]){
 bones[upper].position.fromArray(rig.joints[side].shoulder);
 bones[fore].position.fromArray(rig.joints[side].elbow);
}
root.updateMatrixWorld(true);mesh.bind(new T.Skeleton(bones));
for(let i=0;i<rig.weights.length;i++){
 const w=rig.weights[i],u=rig.rest[i][0]>0?4:6;
 skin.getAttribute('skinIndex').setXYZW(i,0,u,u+1,0);
 skin.getAttribute('skinWeight').setXYZW(i,1-w[0]-w[1],w[0]+w[1]-w[2],w[2],0);
}
cage.update();const rest=cage.data.slice(),handIds=[];
const origin=new T.Vector3().fromArray(rig.joints.L.shoulder),axis=new T.Vector3().fromArray(rig.joints.L.hand).sub(origin),length=axis.length();axis.normalize();
for(let i=0;i<pos.count;i++)if(cage.active[i] && pos.getX(i)>0 && pos.getY(i)>35 && new T.Vector3().fromBufferAttribute(pos,i).sub(origin).dot(axis)/length>.98)handIds.push(i);
assert.ok(handIds.length>20);
for(const angle of [.3,1.2,2.2]){
 bones[4].rotation.z=.6;bones[5].rotation.z=.6+angle;
 surface.turn.value.x=-Math.PI/2;cage.update();assert.ok(cage.data.every(Number.isFinite));
 let error=0;
 for(let k=0;k<handIds.length;k+=7){
  const a=handIds[k]*8,b=handIds[(k+37)%handIds.length]*8;
  const distance=d=>Math.hypot(d[a]-d[b],d[a+1]-d[b+1],d[a+2]-d[b+2]);
  error=Math.max(error,Math.abs(distance(cage.data)-distance(rest)));
 }
 assert.ok(error<.003,`paw changed size at bend ${angle}: ${error}cm`);
}
console.log('Rounded cage: large bend/roll finite, distal paw distances preserved.');
const posedReference=toBufferGeometry(subdivide({...part,positions:part.positions.map((_,i)=>Array.from(cage.points.slice(i*3,i*3+3)))},2));
for(let i=0;i<pos.count;i++)if(cage.active[i])for(let k=0;k<3;k++){
 assert.ok(Math.abs(cage.data[i*8+k]-posedReference.getAttribute('position').array[i*3+k])<2e-5);
 assert.ok(Math.abs(cage.data[i*8+4+k]-posedReference.getAttribute('normal').array[i*3+k])<2e-6,'partial normal pass differs from full posed surface');
}
posedReference.dispose();
for(const change of [
 ()=>surface.turn.value.set(.2,0),
 ()=>surface.wrist.value[0].set(0,0,.1),
 ()=>surface.socketActivation.value.set(.5,0),
 ()=>surface.correctiveRotation.value[0].setFromAxisAngle(new T.Vector3(0,1,0),.2),
]){
 const before=cage.data.slice(),revision=cage.evaluationCount;change();cage.update();
 assert.equal(cage.evaluationCount,revision+1,'surface-only input change was cached');
 assert.ok(before.some((v,i)=>Math.abs(v-cage.data[i])>1e-5),'surface input did not affect rendered data');
}
if(process.argv.includes('--benchmark')){
 const elapsed=[];
 for(let i=0;i<160;i++){
  bones[4].rotation.z=.6+Math.sin(i*.1)*.3;bones[5].rotation.z=1.4+Math.cos(i*.13)*.5;
  cage.update();if(i>=30)elapsed.push(cage.lastMilliseconds);
 }
 elapsed.sort((a,b)=>a-b);
 console.log({samples:elapsed.length,medianMs:elapsed[Math.floor(elapsed.length*.5)],p95Ms:elapsed[Math.floor(elapsed.length*.95)]});
}


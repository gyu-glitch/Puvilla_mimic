import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
assert.ok(readFileSync('src/character/standingCageSurface.ts','utf8').includes('private innerFold'),'Apply dev/inner-fold-candidate.patch before running this archived experiment.');
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

const candidate=new StandingCageSurface(part,2,rig,skin,geo,surface,true,true);candidate.bind(mesh);
const origin=new T.Vector3(...rig.joints.L.shoulder),axis=new T.Vector3(...rig.joints.L.hand).sub(origin),length=axis.length();axis.normalize();
const rows=[];
for(const plane of [0,Math.PI/2,Math.PI])for(const angle of [.48,1.2,1.8,2.2,2.4]){
 bones[4].rotation.z=.6;const u=axis.clone().applyQuaternion(bones[4].quaternion),hinge=u.clone().cross(new T.Vector3(0,0,1)).normalize().applyAxisAngle(u,plane);const f=u.clone().applyAxisAngle(hinge,angle);bones[5].quaternion.setFromUnitVectors(axis,f);
 surface.turn.value.set(0,0);surface.wrist.value.forEach(v=>v.set(0,0,0));surface.socketActivation.value.set(0,0);
 cage.update();candidate.update();let max=0,moved=0,body=0,paw=0,jacBefore=1,jacAfter=1;
 for(let i=0;i<part.positions.length;i++){
  const before=new T.Vector3().fromArray(cage.points,i*3),after=new T.Vector3().fromArray(candidate.points,i*3),d=before.distanceTo(after);max=Math.max(max,d);if(d>1e-7)moved++;
  if(rig.torsoAnchors.includes(i))body=Math.max(body,d);
  const p=new T.Vector3(...part.positions[i]),t=p.sub(origin).dot(axis)/length;
  if(part.positions[i][0]>0&&t>.84)paw=Math.max(paw,d);
  if(part.positions[i][0]>0&&rig.weights[i][0]+rig.weights[i][1]>.999){
    const width=Math.min(.6*length,Math.max(.36*length,angle*.32*length)),phase=Math.max(0,Math.min(1,(t*length-(length-width)/2)/width)),curvature=angle*6*phase*(1-phase)/width;
    if(curvature>1e-6){const inward=hinge.clone().cross(u).normalize(),depth=p.addScaledVector(axis,-t*length).applyQuaternion(bones[4].quaternion).dot(inward),radius=1/curvature,threshold=.9*radius,room=.08*radius,target=depth>threshold?threshold+room*(1-Math.exp(-(depth-threshold)/room)):depth;
     jacBefore=Math.min(jacBefore,1-curvature*depth);jacAfter=Math.min(jacAfter,1-curvature*target);}
  }
 }
 rows.push({plane,angle,max,moved,body,paw,jacBefore,jacAfter});assert.equal(body,0);assert.ok(paw<1e-7);if(angle===.48)assert.ok(max<1e-7);
}
writeFileSync('dev/inner-fold-probe.json',JSON.stringify(rows,null,2));
assert.ok(rows.every(r=>r.jacAfter>=.02&&r.max<3));
console.log('INNER FOLD CANDIDATE',rows);

import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');const {PuuvillaCharacter}=await import('../src/character/puuvilla.ts');
const {StandingElbowPlane}=await import('../src/character/standingElbowPlane.ts');
const {StandingTorsoContact}=await import('../src/character/standingTorsoClearance.ts');
const {StandingPawTracking}=await import('../src/character/standingPawTracking.ts');
const DEFAULT_CONFIG=JSON.parse(readFileSync('public/config.json'));
const rig=JSON.parse(readFileSync(process.argv[2]??'public/models/stand_connected_cage_rig.json'));
const cfg=structuredClone(DEFAULT_CONFIG),fake={cfg,connectedArms:true,armsFree:false,elbowPlanes:[new StandingElbowPlane(),new StandingElbowPlane()]};
const arms=[1,-1].map(side=>{const j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(s),len=rest.length();rest.normalize();return {side,s,len,restUpper:rest,restFore:rest,restPolar:Math.acos(-rest.y),q:new T.Quaternion(),f:new T.Quaternion(),contact:new StandingTorsoContact(),paw:new StandingPawTracking(),roll:0};});
const polar=(side,t,p)=>new T.Vector3(side*Math.sin(t)*Math.cos(p),-Math.cos(t),Math.sin(t)*Math.sin(p));
const {parseObj,subdivide,toBufferGeometry}=await import('../src/character/subdivide.ts');
const {StandingCageSurface}=await import('../src/character/standingCageSurface.ts');
const {StandingArmSurface}=await import('../src/character/standingArmSurface.ts');
const part=parseObj(readFileSync('public/models/pu_stand.obj','utf8')).find(p=>p.name==='pu_body');
const geo=toBufferGeometry(subdivide(part,2)),skin=new T.BufferGeometry();
for(const [name,values] of [['connectedArmWeights',rig.weights],['connectedArmCorrective',rig.corrective]])geo.setAttribute(name,toBufferGeometry(subdivide({...part,positions:values},2)).getAttribute('position'));
skin.setAttribute('position',new T.Float32BufferAttribute(part.positions.flat(),3));skin.setAttribute('connectedArmWeights',new T.Float32BufferAttribute(rig.weights.flat(),3));
PuuvillaCharacter.prototype.applySkinWeights.call(fake,skin,1,true);
const surface=new StandingArmSurface(rig.joints),cage=new StandingCageSurface(part,2,rig,skin,geo,surface),candidate=new StandingCageSurface(part,2,rig,skin,geo,surface,true,false,.30,true);
const root=new T.Group(),mesh=new T.SkinnedMesh(geo,new T.MeshBasicMaterial()),bones=Array.from({length:8},()=>new T.Bone());root.add(mesh,bones[0]);
for(const i of [1,2,3,4,6])bones[0].add(bones[i]);
for(const [name,u,f] of [['L',4,5],['R',6,7]]){bones[u].position.fromArray(rig.joints[name].shoulder);bones[u].add(bones[f]);bones[f].position.fromArray(rig.joints[name].elbow).sub(bones[u].position);}
root.updateMatrixWorld(true);mesh.bind(new T.Skeleton(bones));cage.bind(mesh);candidate.bind(mesh);
const edges=[],seen=new Set(),ts=part.positions.map(p=>{
 const a=arms[p[0]>=0?0:1];return new T.Vector3(...p).sub(a.s).dot(a.restUpper)/a.len;
});
for(const face of part.faces)for(let k=0;k<face.length;k++){
 const i=face[k],j=face[(k+1)%face.length],key=[i,j].sort((a,b)=>a-b).join(',');
 if(seen.has(key))continue;seen.add(key);
 if(Math.min(ts[i],ts[j])>.3&&Math.max(ts[i],ts[j])<.9&&Math.min(rig.weights[i][0]+rig.weights[i][1],rig.weights[j][0]+rig.weights[j][1])>.99)edges.push([i,j]);
}
const distance=(v,i,j)=>Math.hypot(v[i*3]-v[j*3],v[i*3+1]-v[j*3+1],v[i*3+2]-v[j*3+2]);
const rows=[];
for(const bend of [0,.48,1.2]){
 for(const [i,a] of arms.entries()){
  const u=i===0?4:6;bones[u].quaternion.setFromUnitVectors(a.restUpper,polar(a.side,2.32,.08));bones[u+1].quaternion.setFromAxisAngle(new T.Vector3(0,0,1),a.side*bend);
 }
 surface.turn.value.set(0,0);cage.update();candidate.update();
 assert.deepEqual(candidate.points,cage.points,'zero roll changed the shape');
 const base=cage.points.slice();
 for(const turn of [1.5,2.5]){
  surface.turn.value.set(-turn,turn);cage.update();candidate.update();
  let protectedError=0,pawError=0;
  for(let i=0;i<ts.length;i++){
   const delta=Math.hypot(...Array.from(candidate.points.slice(i*3,i*3+3),(v,k)=>v-cage.points[i*3+k]));
   if(rig.torsoAnchors.includes(i))protectedError=Math.max(protectedError,delta);
   if(ts[i]>=.84)pawError=Math.max(pawError,delta);
  }
  assert.ok(protectedError<1e-10&&pawError<1e-10,'protected body or rigid paw changed');
  const metric=points=>{
   const ratios=edges.map(([i,j])=>distance(points,i,j)/distance(base,i,j));
   const strain=ratios.map(r=>Math.abs(Math.log(r))).sort((a,b)=>a-b);
   return {min:Math.min(...ratios),max:Math.max(...ratios),p95LogStrain:strain[Math.floor(strain.length*.95)]};
  };
  rows.push({bend,turn,edges:edges.length,before:metric(cage.points),after:metric(candidate.points),protectedError,pawError});
 }
}
console.log(JSON.stringify(rows,null,2));

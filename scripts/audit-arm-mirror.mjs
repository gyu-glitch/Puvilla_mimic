import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');const {PuuvillaCharacter}=await import('../src/character/puuvilla.ts');
const {StandingElbowPlane}=await import('../src/character/standingElbowPlane.ts');
const {StandingTorsoContact}=await import('../src/character/standingTorsoClearance.ts');
const {StandingPawTracking}=await import('../src/character/standingPawTracking.ts');
const DEFAULT_CONFIG=JSON.parse(readFileSync('public/config.json'));
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_mirrorleft.json'));
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
const surface=new StandingArmSurface(rig.joints),cage=new StandingCageSurface(part,2,rig,skin,geo,surface,false),candidate=new StandingCageSurface(part,2,rig,skin,geo,surface,true,false,.30,false,Number(process.argv[2]??.45));
const root=new T.Group(),mesh=new T.SkinnedMesh(geo,new T.MeshBasicMaterial()),bones=Array.from({length:8},()=>new T.Bone());root.add(mesh,bones[0]);
for(const i of [1,2,3,4,6])bones[0].add(bones[i]);
for(const [name,u,f] of [['L',4,5],['R',6,7]]){bones[u].position.fromArray(rig.joints[name].shoulder);bones[u].add(bones[f]);bones[f].position.fromArray(rig.joints[name].elbow).sub(bones[u].position);}
root.updateMatrixWorld(true);mesh.bind(new T.Skeleton(bones));cage.bind(mesh);candidate.bind(mesh);

const index=skin.getAttribute('skinIndex'),weights=skin.getAttribute('skinWeight');
const reflectedBone=i=>i===4?6:i===5?7:i===6?4:i===7?5:i;
const boneWeights=i=>{const out=Array(8).fill(0);for(let k=0;k<4;k++)out[index.array[i*4+k]]=weights.array[i*4+k];return out;};
const pairs=[],regions={socket:[],forearm:[],paw:[]};
for(let i=0;i<rig.rest.length;i++){
 const p=rig.rest[i];if(p[0]<0||rig.weights[i][0]<.01)continue;
 let best=Infinity,jj=-1;
 rig.rest.forEach((q,j)=>{if(q[0]>=0)return;const d=Math.hypot(p[0]+q[0],p[1]-q[1],p[2]-q[2]);if(d<best){best=d;jj=j;}});
 const t=new T.Vector3(...p).sub(arms[0].s).dot(arms[0].restFore)/arms[0].len;
 const region=t>=.84?'paw':t>=.48?'forearm':'socket';
 const a=boneWeights(i),b=boneWeights(jj),weightError=Math.max(...a.map((v,k)=>Math.abs(v-b[reflectedBone(k)])));
 const row={i,j:jj,restCm:best,weightError,t};regions[region].push(row);if(best<.03)pairs.push({...row,region});
}
const poses=[];
for(const upper of [1.2,2.32])for(const bend of [.48,1.2,2.4])for(const turn of [0,.6,1.3,2.4]){
 for(const [i,a] of arms.entries()){const u=i===0?4:6;bones[u].quaternion.setFromUnitVectors(a.restUpper,polar(a.side,upper,.08));bones[u+1].quaternion.setFromAxisAngle(new T.Vector3(0,0,1),a.side*bend);surface.socketActivation.value.setComponent(i,1);surface.correctiveRotation.value[i].identity();}
 surface.turn.value.set(-turn,turn);candidate.update();
 const rows=pairs.map(p=>({...p,posedCm:Math.hypot(candidate.points[p.i*3]+candidate.points[p.j*3],candidate.points[p.i*3+1]-candidate.points[p.j*3+1],candidate.points[p.i*3+2]-candidate.points[p.j*3+2])}));
 poses.push({upper,bend,turn,...Object.fromEntries(Object.keys(regions).map(region=>[region,Math.max(0,...rows.filter(r=>r.region===region).map(r=>r.posedCm))]))});
}
const summary=Object.fromEntries(Object.entries(regions).map(([k,rows])=>[k,{count:rows.length,matched:rows.filter(r=>r.restCm<.03).length,maxRestNearestCm:Math.max(...rows.map(r=>r.restCm)),maxMatchedWeightError:Math.max(0,...rows.filter(r=>r.restCm<.03).map(r=>r.weightError)),worstRest:rows.sort((a,b)=>b.restCm-a.restCm).slice(0,3)}]));
console.log(JSON.stringify({purpose:'Actual final skin weights and paired cage positions. Unmatched topology is not proven symmetric.',summary,poses},null,2));

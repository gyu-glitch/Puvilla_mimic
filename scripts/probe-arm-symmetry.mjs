import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {stepStandingPawTwist}=await import('../src/character/standingPawTwist.ts');const {PuuvillaCharacter}=await import('../src/character/puuvilla.ts');
const {StandingElbowPlane}=await import('../src/character/standingElbowPlane.ts');
const {StandingTorsoContact}=await import('../src/character/standingTorsoClearance.ts');
const {standingFrontPawRoll,standingPawRoll}=await import('../src/character/standingPawFrame.ts');
const {StandingPawTracking}=await import('../src/character/standingPawTracking.ts');
const {BodyProcessor}=await import('../src/body.ts');const DEFAULT_CONFIG=JSON.parse(readFileSync('public/config.json'));
const rig=JSON.parse(readFileSync(process.argv[2]??'public/models/stand_connected_cage_rig.json'));
const cfg=structuredClone(DEFAULT_CONFIG),fake={cfg,connectedArms:true,armsFree:false,elbowPlanes:[new StandingElbowPlane(),new StandingElbowPlane()]};
const arms=[1,-1].map(side=>{const j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(s),len=rest.length();rest.normalize();return {side,s,len,restUpper:rest,restFore:rest,restPolar:Math.acos(-rest.y),q:new T.Quaternion(),f:new T.Quaternion(),contact:new StandingTorsoContact(),paw:new StandingPawTracking(),roll:0};});
const mirror=v=>new T.Vector3(-v.x,v.y,v.z),polar=(side,t,p)=>new T.Vector3(side*Math.sin(t)*Math.cos(p),-Math.cos(t),Math.sin(t)*Math.sin(p));
let upperError=0,foreError=0,pawError=0,processorError=0;
const bp=new BodyProcessor(cfg);
for(let frame=0;frame<1800;frame++){
 const t=frame/60,theta=1.6+1.5*Math.sin(t*.7),phi=1.4*Math.sin(t*.4),bend=1.1+1.1*Math.sin(t*1.1),pose={hipL:[.1,0,0],hipR:[-.1,0,0],armL:1,armR:1,hips:1};
 for(const side of [1,-1]){const name=side>0?'L':'R',s=new T.Vector3(side*.18,.48,0),u=polar(side,theta,phi),f=u.clone().applyAxisAngle(new T.Vector3(0,0,side),bend),e=s.clone().addScaledVector(u,.27);pose['shoulder'+name]=s.toArray();pose['elbow'+name]=e.toArray();pose['wrist'+name]=e.clone().addScaledVector(f,.25).toArray();pose['handAcross'+name]=f.clone().cross(new T.Vector3(0,0,1)).multiplyScalar(-side).normalize().toArray();}
 const raw={world:Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1})),nose:{x:.5,y:.3},shoulderW:.36};
 for(const [s,ids] of [['L',[12,14,16,24]],['R',[11,13,15,23]]])for(const [n,i] of ['shoulder','elbow','wrist','hip'].entries()){const p=pose[i+s];Object.assign(raw.world[ids[n]],{x:-p[0],y:-p[1],z:-p[2]});}
 const filtered=bp.update(raw,true,t*1000);
 for(const joint of ['shoulder','elbow','wrist'])processorError=Math.max(processorError,new T.Vector3(...filtered[joint+'L']).distanceTo(mirror(new T.Vector3(...filtered[joint+'R']))));
 const torso=new T.Quaternion();PuuvillaCharacter.prototype.solveTorso.call(fake,pose,torso);
 for(const a of arms){const u=new T.Quaternion(),f=new T.Quaternion();PuuvillaCharacter.prototype.solveArm.call(fake,a,pose,torso,u,f,1/60);a.contact.solveLift(a.s,a.len,a.restFore,u,f,1/60);a.q.slerp(u,1-Math.exp(-18/60));a.f.slerp(f,1-Math.exp(-18/60));
 const dir=a.restFore.clone().applyQuaternion(a.f).applyQuaternion(a.q),x=Math.max(0,Math.min(1,(dir.y+.35)/1)),raised=x*x*(3-2*x);let target=a.side*-Math.PI/2*raised;
 const front=standingFrontPawRoll(a.restFore,a.q,a.f,a.side,target);target+=Math.atan2(Math.sin(front-target),Math.cos(front-target))*raised;
 const name=a.side>0?'L':'R',human=new T.Vector3(...pose['wrist'+name]).sub(new T.Vector3(...pose['elbow'+name])).normalize(),across=new T.Vector3(...pose['handAcross'+name]);
 const roll=standingPawRoll(a.restFore,a.q,a.f,target,human,across);a.paw.update(frame%11<2?null:roll,null,t,1/60);target+=a.paw.roll*raised;
 a.roll=stepStandingPawTwist(a.roll,target,1-Math.exp(-18/60),1/60);
 }
 const [a,b]=arms,au=a.restUpper.clone().applyQuaternion(a.q),bu=b.restUpper.clone().applyQuaternion(b.q),af=a.restFore.clone().applyQuaternion(a.f).applyQuaternion(a.q),bf=b.restFore.clone().applyQuaternion(b.f).applyQuaternion(b.q);
 upperError=Math.max(upperError,au.distanceTo(mirror(bu)));foreError=Math.max(foreError,af.distanceTo(mirror(bf)));pawError=Math.max(pawError,Math.abs(Math.atan2(Math.sin(a.roll+b.roll),Math.cos(a.roll+b.roll))));
}
console.log({processorError,upperError,foreError,pawError});assert.ok(Math.max(processorError,upperError,foreError,pawError)<1e-6);


const {parseObj,subdivide,toBufferGeometry}=await import('../src/character/subdivide.ts');
const {StandingCageSurface}=await import('../src/character/standingCageSurface.ts');
const {StandingArmSurface}=await import('../src/character/standingArmSurface.ts');
const part=parseObj(readFileSync('public/models/pu_stand.obj','utf8')).find(p=>p.name==='pu_body');
const geo=toBufferGeometry(subdivide(part,2)),skin=new T.BufferGeometry();
for(const [name,values] of [['connectedArmWeights',rig.weights],['connectedArmCorrective',rig.corrective]])geo.setAttribute(name,toBufferGeometry(subdivide({...part,positions:values},2)).getAttribute('position'));
skin.setAttribute('position',new T.Float32BufferAttribute(part.positions.flat(),3));skin.setAttribute('connectedArmWeights',new T.Float32BufferAttribute(rig.weights.flat(),3));
PuuvillaCharacter.prototype.applySkinWeights.call(fake,skin,1,true);
const surface=new StandingArmSurface(rig.joints),cage=new StandingCageSurface(part,2,rig,skin,geo,surface);
const root=new T.Group(),mesh=new T.SkinnedMesh(geo,new T.MeshBasicMaterial()),bones=Array.from({length:8},()=>new T.Bone());root.add(mesh,bones[0]);
for(const i of [1,2,3,4,6])bones[0].add(bones[i]);
for(const [name,u,f] of [['L',4,5],['R',6,7]]){bones[u].position.fromArray(rig.joints[name].shoulder);bones[u].add(bones[f]);bones[f].position.fromArray(rig.joints[name].elbow).sub(bones[u].position);}
root.updateMatrixWorld(true);mesh.bind(new T.Skeleton(bones));cage.bind(mesh);
const pairs=[];
for(let i=0;i<rig.rest.length;i++){const p=rig.rest[i];if(p[0]<18||rig.weights[i][0]<.01)continue;let best=Infinity,jj=-1;rig.rest.forEach((q,j)=>{const d=Math.hypot(p[0]+q[0],p[1]-q[1],p[2]-q[2]);if(d<best){best=d;jj=j;}});if(best<.03)pairs.push([i,jj,best]);}
for(const turn of [0,.5,1.5,2.5]){
 for(const [i,a] of arms.entries()){const u=i===0?4:6;const dir=polar(a.side,2.32,.08);bones[u].quaternion.setFromUnitVectors(a.restUpper,dir);bones[u+1].quaternion.setFromAxisAngle(new T.Vector3(0,0,1),a.side*.48);surface.turn.value.setComponent(i,-a.side*turn);surface.socketActivation.value.setComponent(i,1);surface.correctiveRotation.value[i].identity();}
 cage.update();const rows=pairs.map(([i,j,d])=>({i,j,rest:d,posed:Math.hypot(cage.points[i*3]+cage.points[j*3],cage.points[i*3+1]-cage.points[j*3+1],cage.points[i*3+2]-cage.points[j*3+2])})).sort((a,b)=>b.posed-a.posed);
 console.log({turn,matched:pairs.length,worst:rows.slice(0,4)});
 if(rig.review?.startsWith('v23'))assert.ok(rows[0].posed<.06,'mirrored arm support lost its symmetry');
}

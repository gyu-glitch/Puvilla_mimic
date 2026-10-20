import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');const {PuuvillaCharacter}=await import('../src/character/puuvilla.ts');
const {StandingElbowPlane}=await import('../src/character/standingElbowPlane.ts');
const {StandingTorsoContact}=await import('../src/character/standingTorsoClearance.ts');
const {standingFrontPawRoll,standingPawRoll}=await import('../src/character/standingPawFrame.ts');
const {StandingPawTracking}=await import('../src/character/standingPawTracking.ts');
const {BodyProcessor}=await import('../src/body.ts');const DEFAULT_CONFIG=JSON.parse(readFileSync('public/config.json'));
const rig=JSON.parse(readFileSync(process.argv[2]??'public/models/stand_connected_cage_rig.json'));
const cfg=structuredClone(DEFAULT_CONFIG),fake={cfg,connectedArms:true,armsFree:false,elbowPlanes:[new StandingElbowPlane(),new StandingElbowPlane()]};
const arms=[1,-1].map(side=>{const j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(s),len=rest.length();rest.normalize();return {side,s,len,restUpper:rest,restFore:rest,restPolar:Math.acos(-rest.y),q:new T.Quaternion(),f:new T.Quaternion(),contact:new StandingTorsoContact(),paw:new StandingPawTracking(),roll:0};});
const mirror=v=>new T.Vector3(-v.x,v.y,v.z),polar=(side,t,p)=>new T.Vector3(side*Math.sin(t)*Math.cos(p),-Math.cos(t),Math.sin(t)*Math.sin(p));
let firstWinding=null;let maxTurn=0;let upperError=0,foreError=0,pawError=0,processorError=0;
const bp=new BodyProcessor(cfg);
for(let frame=0;frame<18000;frame++){
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
 const delta=Math.atan2(Math.sin(target-a.roll),Math.cos(target-a.roll));a.roll+=Math.max(-.1,Math.min(.1,delta*(1-Math.exp(-18/60))));
 }
 if(firstWinding===null&&arms.some(a=>Math.abs(a.roll)>Math.PI))firstWinding=t;
 maxTurn=Math.max(maxTurn,...arms.map(a=>Math.abs(a.roll)));
 const [a,b]=arms,au=a.restUpper.clone().applyQuaternion(a.q),bu=b.restUpper.clone().applyQuaternion(b.q),af=a.restFore.clone().applyQuaternion(a.f).applyQuaternion(a.q),bf=b.restFore.clone().applyQuaternion(b.f).applyQuaternion(b.q);
 upperError=Math.max(upperError,au.distanceTo(mirror(bu)));foreError=Math.max(foreError,af.distanceTo(mirror(bf)));pawError=Math.max(pawError,Math.abs(Math.atan2(Math.sin(a.roll+b.roll),Math.cos(a.roll+b.roll))));
}
console.log({processorError,upperError,foreError,pawError});assert.ok(Math.max(processorError,upperError,foreError,pawError)<1e-6);



console.log({firstWinding,maxTurn,maxTurns:maxTurn/(2*Math.PI),final:arms.map(a=>a.roll)});

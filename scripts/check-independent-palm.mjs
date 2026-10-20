import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyProcessor}=await import('../src/body.ts'),{BodyProcessor:Before}=await import('../dev/body-before-v28.ts');
const {armPalmFixture}=await import('../dev/arm-palm-fixture.ts');
const {standingPawRoll,standingFrontPawRoll}=await import('../src/character/standingPawFrame.ts');
const {standingPawRoll:oldRoll}=await import('../dev/paw-frame-before-v28.ts');
const {Vector3,Quaternion}=await import('three');
const cfg=JSON.parse(readFileSync('public/config.json')),rig=JSON.parse(readFileSync('public/models/stand_connected_cage_mirrorleft.json'));
let oldMax=0,newMax=0;const rows=[];
for(const time of [3,5,6,8,11])for(const side of [-1,1]){
 const after=new BodyProcessor(cfg),before=new Before(cfg),raw=armPalmFixture(time).raw;
 let a,b;for(let t=0;t<1500;t+=50){a=after.update(raw,true,t);b=before.update(raw,true,t);}
 const name=side===1?'L':'R',j=rig.joints[name];
 const rest=new Vector3(...j.hand).sub(new Vector3(...j.shoulder)).normalize();
 for(const [pose,isOld] of [[a,false],[b,true]]){
  const upperDir=new Vector3(...pose['elbow'+name]).sub(new Vector3(...pose['shoulder'+name])).normalize();
  const direction=new Vector3(...pose['wrist'+name]).sub(new Vector3(...pose['elbow'+name])).normalize();
  const u=new Quaternion().setFromUnitVectors(rest,upperDir);
  const f=new Quaternion().setFromUnitVectors(rest,direction.clone().applyQuaternion(u.clone().invert()));
  const base=standingFrontPawRoll(rest,u,f,side,-side*Math.PI/2);
  const across=new Vector3(...pose['handAcross'+name]),forward=new Vector3(...pose['handDirection'+name]);
  const offset=isOld?oldRoll(rest,u,f,base,direction,across):standingPawRoll(rest,u,f,base,direction,across,forward);
  assert.notEqual(offset,null);
  const normal=new Vector3(0,0,1).addScaledVector(rest,-rest.z).normalize().cross(rest)
   .applyAxisAngle(rest,base+Math.max(-1.3,Math.min(1.3,offset))).applyQuaternion(f).applyQuaternion(u).normalize();
  const expected=new Vector3(0,0,side===1?-1:1).addScaledVector(direction,-direction.z*(side===1?-1:1)).normalize();
  const error=normal.angleTo(expected);rows.push({time,side,legacy:isOld,errorDeg:error*180/Math.PI});
  if(isOld)oldMax=Math.max(oldMax,error);else newMax=Math.max(newMax,error);
 }
}
console.log(rows);
console.log({oldPalmPlaneErrorDeg:oldMax*180/Math.PI,newPalmPlaneErrorDeg:newMax*180/Math.PI});
assert.ok(oldMax>.10);assert.ok(newMax<1e-6);
// A real palm turn remains observable; no fixed front-facing lock.
const rest=new Vector3(0,1,0),id=new Quaternion(),across=new Vector3(1,0,0).applyAxisAngle(rest,.6);
const measured=standingPawRoll(rest,id,id,Math.PI/2,rest,across,rest);
assert.ok(Math.abs(measured-.6)<1e-6);
assert.equal(standingPawRoll(rest,id,id,0,rest,rest,rest),null);

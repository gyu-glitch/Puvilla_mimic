import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {clearStandingForearm,standingHeadClearance,resolveStandingHeadContact}=await import('../src/character/standingHeadClearance.ts');
const j=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json')).joints.R;
const s=new T.Vector3().fromArray(j.shoulder),rest=new T.Vector3().fromArray(j.hand).sub(s),length=rest.length();rest.normalize();
const dir=(theta)=>new T.Vector3(-Math.sin(theta)*Math.cos(.2),-Math.cos(theta),Math.sin(theta)*Math.sin(.2));
const upper=new T.Quaternion().setFromUnitVectors(rest,dir(2.65));
const desiredFore=new T.Quaternion().setFromUnitVectors(rest,dir(3.7).applyQuaternion(upper.clone().invert()));
function run(contact){
 const head=new T.Quaternion(),fore=desiredFore.clone();clearStandingForearm(s,length,rest,upper,fore,head);
 let minimum=2,maxStep=0;
 for(let i=0;i<900;i++){
  const t=i/60,targetHead=new T.Quaternion().setFromEuler(new T.Euler(.3*Math.sin(t*3),.65*Math.sin(t*4),.2*Math.sin(t*5),'YXZ'));
  head.slerp(targetHead,1-Math.exp(-12/60));
  const target=desiredFore.clone();clearStandingForearm(s,length,rest,upper,target,head);
  const before=fore.clone();fore.slerp(target,1-Math.exp(-12/60));
  if(contact)resolveStandingHeadContact(s,length,rest,upper,fore,head,1/60);
  const u=rest.clone().applyQuaternion(upper),f=rest.clone().applyQuaternion(fore).applyQuaternion(upper);
  minimum=Math.min(minimum,standingHeadClearance(s,length,u,f,head).distance);maxStep=Math.max(maxStep,before.angleTo(fore));
 }
 return {minimum,maxStep};
}
const targetOnly=run(false),contact=run(true);console.log({targetOnly,contact});
assert.ok(contact.minimum>=targetOnly.minimum);assert.ok(contact.maxStep<.12);

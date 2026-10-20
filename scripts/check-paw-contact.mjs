import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {StandingTorsoContact,standingTorsoClearance}=await import('../src/character/standingTorsoClearance.ts');
const {clearStandingForearm,standingHeadClearance,resolveStandingHeadContact}=await import('../src/character/standingHeadClearance.ts');
const {standingUpperDirection}=await import('../src/character/standingArmPose.ts');
const {separateStandingPaws,standingPawCenter}=await import('../src/character/standingPawContact.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json'));
for(const fps of [15,30,60]){
const arms=[-1,1].map(side=>{const j=rig.joints[side>0?'L':'R'],shoulder=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(shoulder),length=rest.length();return {side,shoulder,length,rest:rest.normalize(),upper:new T.Quaternion(),fore:new T.Quaternion(),contact:new StandingTorsoContact()};});
const chest=new T.Quaternion(),head=new T.Quaternion();let minimumBefore=Infinity,minimumAfter=Infinity,maxStep=0,previous=null,maxCorrection=0;
const rendered=arms.map(a=>({...a,upper:new T.Quaternion(),fore:new T.Quaternion()}));
for(let frame=0;frame<24*fps;frame++){
 const t=frame/fps,close=(1-Math.cos(t*Math.PI/3))/2;
 for(const a of arms){
  const theta=1.2,phi=1.3+.7*close,human=new T.Vector3(a.side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi));
  const hf=human.clone().lerp(new T.Vector3(-a.side,0,.3).normalize(),close).normalize();
  const u=standingUpperDirection(a.side,a.rest,human,3),axis=new T.Vector3().crossVectors(human,hf).normalize().applyQuaternion(new T.Quaternion().setFromUnitVectors(human,u)),f=u.clone().applyAxisAngle(axis,Math.min(2.4,human.angleTo(hf)));
  a.upper.setFromUnitVectors(a.rest,u);a.fore.setFromUnitVectors(a.rest,f.applyQuaternion(a.upper.clone().invert()));
  a.contact.solve(a.shoulder,a.length,a.rest,a.upper,a.fore,1/fps,chest);
  clearStandingForearm(a.shoulder,a.length,a.rest,a.upper,a.fore,head);
 }
 const before=arms.map(a=>standingPawCenter(a));minimumBefore=Math.min(minimumBefore,before[0].distanceTo(before[1]));
 const correction=separateStandingPaws(arms,chest,head);maxCorrection=Math.max(maxCorrection,correction);
 for(let i=0;i<2;i++){
  const a=arms[i],r=rendered[i],k=1-Math.exp(-18/fps);
  if(!frame){r.upper.copy(a.upper);r.fore.copy(a.fore);}else{r.upper.slerp(a.upper,k);r.fore.slerp(a.fore,k);}
  resolveStandingHeadContact(r.shoulder,r.length,r.rest,r.upper,r.fore,head,1/fps);
 }
 const after=rendered.map(a=>standingPawCenter(a));minimumAfter=Math.min(minimumAfter,after[0].distanceTo(after[1]));
 if(previous)for(let i=0;i<2;i++)maxStep=Math.max(maxStep,rendered[i].fore.angleTo(previous[i]));
 previous=rendered.map(a=>a.fore.clone());
 for(const a of arms){const u=a.rest.clone().applyQuaternion(a.upper),f=a.rest.clone().applyQuaternion(a.fore).applyQuaternion(a.upper);assert.ok(standingTorsoClearance(a.shoulder,a.length,u,f,chest).distance>1);assert.ok(standingHeadClearance(a.shoulder,a.length,u,f,head).distance>1);}
 assert.ok(Math.abs(after[0].x+after[1].x)<1e-7,'left-right correction asymmetry');
}
console.log({fps,minimumBefore,minimumAfter,maxStep,maxCorrection});
assert.ok(minimumAfter>17.5);assert.ok(maxStep<2/fps);
for(const a of arms){a.upper.identity();a.fore.identity();}
const original=arms.map(a=>a.fore.clone());assert.equal(separateStandingPaws(arms,chest,head),0);arms.forEach((a,i)=>assert.ok(a.fore.equals(original[i])));

}

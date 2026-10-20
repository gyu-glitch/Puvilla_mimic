import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {standingHeadClearance,clearStandingForearm,clearStandingUpper}=await import('../src/character/standingHeadClearance.ts');
const {standingUpperDirection}=await import('../src/character/standingArmPose.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json'));
let beforeMin=Infinity,afterMin=Infinity,maxCorrection=0,maxStep=0,worst=null,beforeWorst=null;
for(const side of [-1,1]){
 const j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(s),length=rest.length();rest.normalize();let previous=null;
 for(let i=0;i<2000;i++){
  const t=i/100,theta=2.3+.3*Math.sin(t*.8),phi=1.7+.3*Math.sin(t*.5);
  const human=new T.Vector3(side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi)),upper=standingUpperDirection(side,rest,human,3),uq=new T.Quaternion().setFromUnitVectors(rest,upper),fq=new T.Quaternion(),head=new T.Quaternion().setFromEuler(new T.Euler(.25*Math.sin(t*.7),.6*Math.sin(t*.9),.2*Math.sin(t*1.3),'YXZ'));
  clearStandingForearm(s,length,rest,uq,fq,head);
  const f=rest.clone().applyQuaternion(fq).applyQuaternion(uq),before=standingHeadClearance(s,length,upper,f,head,true).distance,originalFore=fq.clone();
  const correction=clearStandingUpper(s,length,rest,uq,fq,head),uAfter=rest.clone().applyQuaternion(uq),fAfter=rest.clone().applyQuaternion(fq).applyQuaternion(uq),after=standingHeadClearance(s,length,uAfter,fAfter,head,true).distance;
  assert.ok(after>=before-1e-7);assert.ok(fq.equals(originalFore),'relative elbow angle changed');assert.ok(Number.isFinite(after));
  if(before<beforeMin)beforeWorst={side,t,theta,phi,before,after};beforeMin=Math.min(beforeMin,before);if(after<afterMin){afterMin=after;worst={side,t,before,after,correction};}maxCorrection=Math.max(maxCorrection,correction);
  if(previous)maxStep=Math.max(maxStep,uq.angleTo(previous));previous=uq;
 }
 const theta=2.32,phi=.08,u=new T.Vector3(side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi)),f=new T.Vector3(side*Math.sin(theta+.48)*Math.cos(phi),-Math.cos(theta+.48),Math.sin(theta+.48)*Math.sin(phi)),uq=new T.Quaternion().setFromUnitVectors(rest,u),fq=new T.Quaternion().setFromUnitVectors(rest,f.applyQuaternion(uq.clone().invert()));
 assert.ok(clearStandingUpper(s,length,rest,uq,fq,new T.Quaternion())<1e-7,'ordinary greeting changed');
}
console.log({beforeMin,afterMin,maxCorrection,maxStep,worst,beforeWorst});
assert.ok(afterMin>.99);assert.ok(maxCorrection<=.650001);assert.ok(maxStep<.06);

import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {clearStandingForearm,standingHeadClearance}=await import('../src/character/standingHeadClearance.ts');
const {standingUpperDirection}=await import('../src/character/standingArmPose.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json'));
const polar=(side,t,p)=>new T.Vector3(side*Math.sin(t)*Math.cos(p),-Math.cos(t),Math.sin(t)*Math.sin(p));
let worstBefore=2,worstAfter=2,maxCorrection=0,maxStep=0,affected=0,worstCase=null;
for(const side of [-1,1]){
 const j=rig.joints[side>0?'L':'R'],s=new T.Vector3().fromArray(j.shoulder),rest=new T.Vector3().fromArray(j.hand).sub(s),length=rest.length();rest.normalize();
 const upperQ=new T.Quaternion(),foreQ=new T.Quaternion(),head=new T.Quaternion();let previous=null;
 const solve=(theta,bend,phi)=>{
  const human=polar(side,theta,phi),fore=human.clone().applyAxisAngle(new T.Vector3(0,0,side),bend);
  const upper=standingUpperDirection(side,rest,human,3),mapped=fore.applyQuaternion(new T.Quaternion().setFromUnitVectors(human,upper));
  upperQ.setFromUnitVectors(rest,upper);foreQ.setFromUnitVectors(rest,mapped.clone().applyQuaternion(upperQ.clone().invert()));
  return {upper,mapped};
 };
 solve(2.32,.48,.08);const wave=foreQ.clone();assert.equal(clearStandingForearm(s,length,rest,upperQ,foreQ,head),0);assert.ok(foreQ.angleTo(wave)<1e-7);
 for(let frame=0;frame<2400;frame++){
  const t=frame/100,{upper,mapped}=solve((Math.sin(t*.7+side*.4)+1)*1.4,(Math.sin(t*1.1)+1)*.65,(Math.sin(t*.4)+1)*.35);
  if(frame>=1200)head.setFromEuler(new T.Euler(.25*Math.sin(t*.7),.6*Math.sin(t*.9),.2*Math.sin(t*1.3),'YXZ'));
  if(frame===1200)previous=null;
  const before=standingHeadClearance(s,length,upper,mapped,head).distance;
  const correction=clearStandingForearm(s,length,rest,upperQ,foreQ,head);
  const actual=rest.clone().applyQuaternion(foreQ).applyQuaternion(upperQ);
  const after=standingHeadClearance(s,length,upper,actual,head).distance;
  assert.ok(Number.isFinite(after)&&Number.isFinite(correction));assert.ok(after>=before-1e-6,'avoidance worsened penetration');
  if(after<worstAfter)worstCase={side,time:t,before,after,correction};
  maxCorrection=Math.max(maxCorrection,correction);worstBefore=Math.min(worstBefore,before);worstAfter=Math.min(worstAfter,after);if(correction>1e-5)affected++;
  if(previous)maxStep=Math.max(maxStep,actual.angleTo(previous));previous=actual;
 }
}
console.log({worstBefore,worstAfter,maxCorrection,maxStep,affected,worstCase});
assert.ok(maxCorrection<=.650001);assert.ok(maxStep<.04,'abrupt direction change in smooth input');

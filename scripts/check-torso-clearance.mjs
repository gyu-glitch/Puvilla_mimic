import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {clearStandingTorso,standingTorsoClearance,StandingTorsoContact}=await import('../src/character/standingTorsoClearance.ts');
const {standingUpperDirection}=await import('../src/character/standingArmPose.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json'));
const polar=(side,t,p)=>new T.Vector3(side*Math.sin(t)*Math.cos(p),-Math.cos(t),Math.sin(t)*Math.sin(p));
let worstBefore=2,worstAfter=2,maxCorrection=0,maxStep=0,affected=0,worstCase=null,stepCase=null;
for(const side of [-1,1]){
 const j=rig.joints[side>0?'L':'R'],s=new T.Vector3().fromArray(j.shoulder),rest=new T.Vector3().fromArray(j.hand).sub(s),length=rest.length();rest.normalize();
 const contact=new StandingTorsoContact();
 const upperQ=new T.Quaternion(),foreQ=new T.Quaternion();let previous=null;
 const solve=(theta,bend,phi)=>{
  const human=polar(side,theta,phi),fore=human.clone().applyAxisAngle(new T.Vector3(0,0,side),bend);
  const upper=standingUpperDirection(side,rest,human,3),mapped=fore.applyQuaternion(new T.Quaternion().setFromUnitVectors(human,upper));
  upperQ.setFromUnitVectors(rest,upper);foreQ.setFromUnitVectors(rest,mapped.clone().applyQuaternion(upperQ.clone().invert()));
  return {upper,mapped};
 };
 solve(2.32,.48,.08);const wave=foreQ.clone();assert.equal(clearStandingTorso(s,length,rest,upperQ,foreQ),0);assert.ok(foreQ.angleTo(wave)<1e-7);
 for(let frame=0;frame<2400;frame++){
  const t=frame/100,{upper,mapped}=solve((Math.sin(t*.7+side*.4)+1)*.75,-(Math.sin(t*1.1)+1)*1.2,Math.sin(t*.4)*.35);
  const before=standingTorsoClearance(s,length,upper,mapped).distance;
  contact.solve(s,length,rest,upperQ,foreQ,1/100);
  const correction=mapped.angleTo(rest.clone().applyQuaternion(foreQ).applyQuaternion(upperQ));
  const actual=rest.clone().applyQuaternion(foreQ).applyQuaternion(upperQ);
  const after=standingTorsoClearance(s,length,upper,actual).distance;
  assert.ok(Number.isFinite(after)&&Number.isFinite(correction));
  if(after<worstAfter)worstCase={side,time:t,before,after,correction};
  maxCorrection=Math.max(maxCorrection,correction);worstBefore=Math.min(worstBefore,before);worstAfter=Math.min(worstAfter,after);if(correction>1e-5)affected++;
  if(previous&&actual.angleTo(previous)>maxStep){maxStep=actual.angleTo(previous);stepCase={side,t,upper:upper.toArray(),mapped:mapped.toArray(),before,after};}previous=actual;
 }
 for(let i=0;i<240;i++){
  const {mapped}=solve(2.32,.48+Math.sin(i*.05)*.06,.08);
  contact.solve(s,length,rest,upperQ,foreQ,1/60);
  if(i>180)assert.ok(rest.clone().applyQuaternion(foreQ).applyQuaternion(upperQ).angleTo(mapped)<1e-7,'contact never released for free greeting');
 }
}
console.log({worstBefore,worstAfter,maxCorrection,maxStep,affected,worstCase,stepCase});
assert.ok(worstAfter>.99);assert.ok(maxStep<.04,'abrupt direction change in smooth input');

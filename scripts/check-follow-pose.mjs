import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {standingFollowDirection}=await import('../src/character/standingArmPose.ts');

const {standingTorsoClearance,StandingTorsoContact}=await import('../src/character/standingTorsoClearance.ts');
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_rig.json'));
let maxElevationError=0,maxBendError=0,maxRaisedError=0,affected=0,unresolved=0,minBefore=Infinity,minAfter=Infinity,maxStep=0,dynamicMinimum=Infinity;
for(const side of [-1,1]){
 const j=rig.joints[side>0?'L':'R'],s=new T.Vector3(...j.shoulder),rest=new T.Vector3(...j.hand).sub(s),len=rest.length();rest.normalize();
 let contact=new StandingTorsoContact();
 const solve=(theta,phi,bend,chest)=>{
  const human=new T.Vector3(side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi));
  const upper=standingFollowDirection(side,rest,human);
  if(theta>2.5 && bend===0 && phi>=0 && phi<=1.57){
   const freeU=new T.Quaternion().setFromUnitVectors(rest,upper),freeF=new T.Quaternion();
   new StandingTorsoContact().solveLift(s,len,rest,freeU,freeF,1/60,chest);
   assert.ok(rest.clone().applyQuaternion(freeF).applyQuaternion(freeU).distanceTo(upper)<1e-7,'straight raised arm was bent');
  }
  if(theta>.8)maxRaisedError=Math.max(maxRaisedError,human.distanceTo(upper));
  const fore=human.clone().applyAxisAngle(new T.Vector3(0,0,side),bend).applyQuaternion(new T.Quaternion().setFromUnitVectors(human,upper));
  const u=new T.Quaternion().setFromUnitVectors(rest,upper),f=new T.Quaternion().setFromUnitVectors(rest,fore.clone().applyQuaternion(u.clone().invert()));
  const before=standingTorsoClearance(s,len,upper,fore,chest).distance;
  contact.solveLift(s,len,rest,u,f,1/60,chest);
  const correction=rest.clone().applyQuaternion(f).applyQuaternion(u).angleTo(fore);
  const actualU=rest.clone().applyQuaternion(u),actualF=rest.clone().applyQuaternion(f).applyQuaternion(u);
  const after=standingTorsoClearance(s,len,actualU,actualF,chest).distance;
  maxElevationError=Math.max(maxElevationError,Math.abs(actualU.y-upper.y),Math.max(0,fore.y-actualF.y));
  maxBendError=Math.max(maxBendError,Math.abs(actualU.dot(actualF)-upper.dot(fore)));
  minBefore=Math.min(minBefore,before);minAfter=Math.min(minAfter,after);
  if(correction>1e-7)affected++;
  if(after<1.0149)unresolved++;

  assert.ok(actualU.distanceTo(upper)<1e-7,'body correction changed shoulder direction');
  return actualF;
 };
 for(const theta of [.2,.6,1,1.5,2,2.7,Math.PI])for(const phi of [-.3,0,.8,1.57,2.2,3])for(const bend of [-2,-1,0,.5,1.8]){contact=new StandingTorsoContact();solve(theta,phi,bend,new T.Quaternion());}
 contact=new StandingTorsoContact();let previous=null;minAfter=Infinity;
 for(let i=0;i<1440;i++){
  const t=i/60,chest=new T.Quaternion().setFromEuler(new T.Euler(.15*Math.sin(t*.8),.25*Math.sin(t*.7),.18*Math.sin(t*1.1)));
  const actual=solve((Math.sin(t*.7+side*.4)+1)*.75,Math.sin(t*.4)*.35,-(Math.sin(t*1.1)+1)*1.2,chest);
  dynamicMinimum=Math.min(dynamicMinimum,minAfter);
  if(previous)maxStep=Math.max(maxStep,actual.angleTo(previous));previous=actual;
 }
}
assert.ok(maxRaisedError<1e-7,'raised input is not followed');
assert.ok(maxElevationError<1e-7,'body avoidance changed arm elevation');
assert.ok(dynamicMinimum>.98,'body protection regressed in the continuous belly sweep');
assert.ok(maxStep<.075,'body contact produced a discontinuity');
// Body avoidance may raise a buried forearm; it must never lower observed lift.
console.log({maxRaisedError,maxElevationError,maxBendError,affected,unresolved,minBefore,minAfter,maxStep,dynamicMinimum});

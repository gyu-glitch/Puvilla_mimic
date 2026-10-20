import assert from 'node:assert/strict';
import {StandingPawTracking} from '../src/character/standingPawTracking.ts';
import {StandingPawTracking as Before} from '../dev/paw-tracking-before-v31.ts';
const rows=[];
for(const fps of [15,30,60])for(const sign of [-1,1]){
 const before=new Before(),after=new StandingPawTracking(),other=new StandingPawTracking();
 let oldRecovery=0,newRecovery=0,maxNew=0;
 for(let frame=0;frame<fps*4;frame++){
  const t=frame/fps;
  const sample=t<1?0:t<1.2?sign*3.1:t<1.4?-sign*3.1:0;
  before.update(sample,null,t,1/fps);after.update(sample,null,t,1/fps);other.update(0,null,t,1/fps);
  maxNew=Math.max(maxNew,Math.abs(after.roll));
  if(t>=1.5){oldRecovery=Math.max(oldRecovery,Math.abs(before.roll));newRecovery=Math.max(newRecovery,Math.abs(after.roll));}
  assert.equal(other.roll,0,'unaffected hand moved');
 }
 assert.equal(oldRecovery,1.3,'fixture did not reproduce the persistent twist');
 assert.equal(newRecovery,0);assert.equal(maxNew,0,'rejected plane flip moved the hand');
 rows.push({fps,sign,beforeRecoveryDegrees:oldRecovery*180/Math.PI,afterRecoveryDegrees:newRecovery*180/Math.PI});
}
// Real supported rotations stay observable, independently and symmetrically.
for(const angle of [-1.3,-.9,-.6,0,.6,.9,1.3]){
 const left=new StandingPawTracking(),right=new StandingPawTracking();
 left.update(angle,null,0,1/60);right.update(-angle,null,0,1/60);
 assert.ok(Math.abs(left.roll-angle)<1e-12&&Math.abs(left.roll+right.roll)<1e-12);
}
const p=new StandingPawTracking();p.update(.8,null,0,1/60);
p.update(3.1,null,.1,1/60);assert.equal(p.roll,.8,'brief invalid plane discarded the last accepted pose');
for(let f=7;f<150;f++)p.update(f%2?3.1:-3.1,null,f/60,1/60);
assert.ok(Math.abs(p.roll)<.003,'persistent ambiguous plane failed to return to front');
p.update(.6,null,3,1/60);assert.ok(Math.abs(p.roll-.6)<1e-12);
console.log(JSON.stringify({rows,realTurnAndAmbiguousRelease:'pass'},null,2));

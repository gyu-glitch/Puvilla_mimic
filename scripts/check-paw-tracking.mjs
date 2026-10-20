import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {StandingPawTracking} from '../src/character/standingPawTracking.ts';
const p=new StandingPawTracking(),w=new Vector3(0,0,.12);
let old=0,stable=0,oldMin=10,oldMax=-10,newMin=10,newMax=-10;
for(let frame=0;frame<180;frame++){
 const t=frame/60,valid=Math.floor(t*15)%3!==0;
 p.update(valid?.8:null,valid?w:null,t,1/60);
 const k=1-Math.exp(-18/60);
 old+=( (valid?.8:0)-old)*k;stable+=(p.roll-stable)*k;
 if(t>1){oldMin=Math.min(oldMin,old);oldMax=Math.max(oldMax,old);newMin=Math.min(newMin,stable);newMax=Math.max(newMax,stable);}
}
assert.ok(oldMax-oldMin>.1,'fixture did not reproduce dropout wobble');assert.ok(newMax-newMin<.001);
assert.ok(Math.abs(p.wrist.z-.12)<1e-9);
for(let i=180;i<300;i++)p.update(null,null,i/60,1/60);
assert.ok(Math.abs(p.roll)<.01 && p.wrist.length()<.002,'sustained loss did not return to neutral');
p.reset();p.update(Math.PI-.01,w,0,1/60);p.update(-Math.PI+.01,w,.02,1/60);assert.equal(p.roll,0,'flipped plane created a saturated palm command');
p.reset();p.update(-Math.PI+.01,w,0,1/60);p.update(Math.PI-.01,w,.02,1/60);assert.equal(p.roll,0,'mirrored flipped plane created a saturated palm command');
p.update(0,new Vector3(0,0,10),2,1/60);assert.equal(p.roll,0);assert.ok(Math.abs(p.wrist.length()-.18)<1e-9);
p.update(NaN,new Vector3(NaN,0,0),2.1,1/60);assert.ok(Number.isFinite(p.roll)&&p.wrist.toArray().every(Number.isFinite));
p.reset();assert.equal(p.roll,0);assert.equal(p.wrist.length(),0);
console.log({dropoutRollRangeBefore:oldMax-oldMin,dropoutRollRangeAfter:newMax-newMin,wrapAndExpiry:'pass'});

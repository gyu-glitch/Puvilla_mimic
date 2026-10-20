import assert from 'node:assert/strict';
import {Vector3,Quaternion} from 'three';
import {roundedElbowCenter,RoundedElbowFrame} from '../src/character/standingBend.ts';
const out=new Vector3();let maxError=0,count=0;
const cases=[];
for(let i=0;i<120;i++){
 const q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),i*.071);
 const upper=new Vector3(.3,-.95,.08).normalize().applyQuaternion(q);
 const axis=new Vector3(0,0,1).applyQuaternion(q);
 const fore=upper.clone().applyAxisAngle(axis,i%3===0?0:i%3===1?2.4:i*.023);
 const length=48+i*.17,frame=new RoundedElbowFrame(length,upper,fore);
 const distances=Array.from({length:128},(_,j)=>length*(j/100-.08));
 for(const s of distances){
  maxError=Math.max(maxError,frame.center(s,out).distanceTo(roundedElbowCenter(s,length,upper,fore)));count++;
 }
 cases.push({length,upper,fore,distances});
}
assert.ok(maxError<1e-10,`bend center changed ${maxError}cm`);
// Matched workloads, alternating order after warmup; no renderer/fps claim.
const old=[],fast=[];let checksum=0;
function run(cached){const start=performance.now();for(const c of cases){
 const frame=cached?new RoundedElbowFrame(c.length,c.upper,c.fore):null;
 for(const s of c.distances)checksum+=(frame?frame.center(s,out):roundedElbowCenter(s,c.length,c.upper,c.fore)).x;
}return performance.now()-start;}
for(let i=0;i<22;i++){
 const order=i%2?[true,false]:[false,true];
 for(const cached of order){const ms=run(cached);if(i>=6)(cached?fast:old).push(ms);}
}
const percentile=(a,p)=>a.sort((a,b)=>a-b)[Math.floor(a.length*p)];
console.log({samples:count,maxErrorCm:maxError,oldMedianMs:percentile(old,.5),cachedMedianMs:percentile(fast,.5),oldP95Ms:percentile(old,.95),cachedP95Ms:percentile(fast,.95),checksumFinite:Number.isFinite(checksum)});

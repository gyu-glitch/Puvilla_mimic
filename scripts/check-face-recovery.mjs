import assert from 'node:assert/strict';
import {FaceRecovery,remapRecoveryFace} from '../src/faceRecovery.ts';
const face={bbox:{x:.4,y:.2,w:.2,h:.3,cx:.5,cy:.35},yaw:5,pitch:3,roll:2,
 blend:{jawOpen:.1},mouth:{open:.1,corner:0},eyes:{left:.2,right:.2}};
let draws=[];
globalThis.OffscreenCanvas=class{
 constructor(w,h){this.width=w;this.height=h;}
 getContext(){return {filter:'',drawImage(...args){draws.push(args);}};}
};
const source={width:1280,height:720};
const recovery=new FaceRecovery();
let calls=0,lastTs=-Infinity,full=false,found=true;
const detect=(input,ts)=>{
 assert.ok(ts>lastTs);lastTs=ts;calls++;
 return (input===source?full:found)?[face]:[];
};
const first=recovery.run(source,100,detect);
assert.equal(calls,2);
assert.equal(recovery.mode,'recovery');
assert.equal(first[0].bbox.cx,.5);
assert.equal(first[0].bbox.w,.1125);
assert.equal(first[0].bbox.h,.3);
assert.equal(first[0].yaw,5);
assert.equal(draws[0][1],280);
recovery.run(source,133,detect);
assert.equal(calls,3,'locked recovery should run at incoming cadence, not 4 Hz');
found=false;
assert.deepEqual(recovery.run(source,166,detect),[],'failed recovery must not return cached face');
const afterLoss=calls;
recovery.run(source,200,detect);
assert.equal(calls,afterLoss+1,'failed search is rate limited; full-frame remains active');
full=true;
assert.equal(recovery.run(source,250,detect)[0],face);
assert.equal(recovery.mode,'full');
recovery.reset();full=false;found=true;
recovery.run(source,260,detect);
assert.equal(draws.at(-1)[1],280,'reset starts from center');
const p=remapRecoveryFace(face,{x:0,y:280,size:720},720,1280);
assert.equal(p.bbox.cx,.5);
assert.equal(p.bbox.cy,(280+.35*720)/1280);
assert.equal(p.bbox.h,.16875);
assert.equal(p.blend,face.blend);
console.log('PASS: full-frame priority, recovery cadence, failure clearing, bounded search, timestamp monotonicity, portrait/landscape coordinates, reset');

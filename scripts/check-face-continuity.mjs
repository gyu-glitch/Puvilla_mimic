import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {FaceRecovery}=await import('../src/faceRecovery.ts');
const {FaceRecovery:Before}=await import('../dev/face-recovery-before-v45.ts');
const {SignalProcessor}=await import('../src/signals.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
cfg.presence.lockZone={x:0,y:0,w:1,h:1};
let cropX=0;
globalThis.OffscreenCanvas=class{constructor(w,h){this.width=w;this.height=h;}getContext(){return {filter:'',drawImage(_s,x){cropX=x;}}}};
const source={width:1280,height:720};
const face=()=>({bbox:{x:.4,y:.2,w:.2,h:.3,cx:.5,cy:.35},yaw:5,pitch:24,roll:0,blend:{},eyes:{left:.2,right:.2},mouth:{open:.1,corner:0}});
const rows=[];
for(const hz of [6,10,15,30])for(const [Recovery,fixed] of [[Before,false],[FaceRecovery,true]]){
 const r=new Recovery(),s=new SignalProcessor(structuredClone(cfg));let maxGap=0,lastGood=0,seen=0,missing=0;
 for(let i=0;i<hz*12;i++){
  const t=i*1000/hz;
  // A single failed frame each second. Only the center crop can see the face.
  const miss=i>=hz&&i%hz===0;
  const faces=r.run(source,t,input=>input!==source&&cropX===280&&!miss?[face()]:[]);
  const sig=s.update({faces,inferenceMs:1},t,1280/720);
  if(faces.length){maxGap=Math.max(maxGap,t-lastGood);lastGood=t;seen++;}else missing++;
  if(fixed)assert.ok(sig.present,'brief misses must not clear visitor');
 }
 rows.push({hz,fixed,maxGap:Math.round(maxGap),seen,missing});
 if(fixed)assert.ok(maxGap<=2000/hz+1,'retry must resume on the very next visible frame');
 if(fixed&&hz===30)assert.equal(s.neutralReady,true,'recurring misses must not reset visitor calibration');
 for(let t=13000;t<=16000;t+=100) s.update({faces:r.run(source,t,()=>[]),inferenceMs:1},t,1280/720);
 assert.equal(s.target,null,'actual sustained absence must still release');
 assert.equal(s.debugFaces.some(f=>f.held),false,'held UI must end with actual lock');
}
// Short hold settings expose real unlocks, not only a disappearing UI box.
for(const [Recovery,fixed] of [[Before,false],[FaceRecovery,true]]){
 const c=structuredClone(cfg);c.presence.faceLostHoldMs=600;
 const r=new Recovery(),s=new SignalProcessor(c);let lost=0;
 for(let i=0;i<72;i++){
  const faces=r.run(source,i*1000/6,input=>input!==source&&cropX===280&&(i<6||i%6!==0)?[face()]:[]);
  if(!s.update({faces,inferenceMs:1},i*1000/6,1280/720).present)lost++;
 }
 assert.equal(lost>0,!fixed,'600ms hold: reproduce old logical unlock and prevent it without changing timeout');
}
// A visitor really leaves the held crop; bounded retries must resume other tiles.
{
 const r=new FaceRecovery();r.run(source,0,input=>input===source?[]:[face()]);
 let recovered=false;
 for(let t=100;t<=1500;t+=100){
  const faces=r.run(source,t,input=>input!==source&&cropX===0?[face()]:[]);
  if(faces.length)recovered=true;
 }
 assert.ok(recovered,'recovery must not stay pinned to an empty crop indefinitely');
}
// Failed full-frame handoff: the old version throws away the reliable crop.
for(const [Recovery,fixed] of [[Before,false],[FaceRecovery,true]]){
 const r=new Recovery();r.run(source,100,input=>input===source?[]:[face()]);
 const b=face();b.bbox={x:.44375,y:.2,w:.1125,h:.3,cx:.5,cy:.35};
 r.run(source,1100,input=>input===source?[b]:[face()]);
 const faces=r.run(source,1133,input=>input!==source&&cropX===280?[face()]:[]);
 assert.equal(faces.length,fixed?1:0,'isolated successful full probe must not interrupt next frame');
}
for(const mirror of [true,false]){
 const c=structuredClone(cfg);c.camera.mirror=mirror;
 const s=new SignalProcessor(c);s.update({faces:[face()],inferenceMs:1},100);
 s.update({faces:[],inferenceMs:1},200);
 assert.equal(s.debugFaces.length,1);assert.equal(s.debugFaces[0].held,true);assert.equal(s.debugFaces[0].locked,false);
 s.update({faces:[face()],inferenceMs:1},233);
 assert.equal(s.debugFaces[0].locked,true);assert.equal(s.debugFaces.some(f=>f.held),false);
}
console.table(rows);
console.log('PASS: recurring brief loss, next-frame recovery, sustained absence, intermittent full probe, honest held/reacquired UI');

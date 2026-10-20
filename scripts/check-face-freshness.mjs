import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {SignalProcessor}=await import('../src/signals.ts');
const {SignalProcessor:Before}=await import('../dev/signals-before-v46.ts');
const {FaceTracker}=await import('../src/tracker.ts');
const {MimicStateMachine}=await import('../src/state.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
cfg.presence.mimicOnLock=true;cfg.presence.lockZone={x:0,y:0,w:1,h:1};
const f=()=>({bbox:{x:.43,y:.25,w:.14,h:.2,cx:.5,cy:.35},yaw:25,pitch:24,roll:0,blend:{},eyes:{left:.2,right:.2},mouth:{open:.1,corner:0}});
const rows=[];
for(const [Processor,fixed] of [[Before,false],[SignalProcessor,true]]){
 const s=new Processor(structuredClone(cfg)),fsm=new MimicStateMachine(cfg);let track,signal;
 for(let t=0;t<=2000;t+=50){track={faces:[f()],inferenceMs:10,observedAtMs:t};signal=s.update(track,t,16/9);fsm.update(signal,t);}
 assert.equal(fsm.current,'MIMIC');
 for(let t=2050;t<=6000;t+=50){signal=s.update(track,t,16/9);fsm.update(signal,t);}
 rows.push({fixed,present:signal.present,target:!!s.target,state:fsm.current});
 assert.equal(signal.present,!fixed,'frozen video must not refresh lastSeen each render');
 assert.equal(!!s.target,!fixed);
 assert.equal(fsm.current==='MIMIC',!fixed);
 if(fixed){assert.equal(s.debugFaces.length,0);assert.equal(s.update(track,7000).present,false,'stale cached face cannot reacquire');}
 // A real new observation resumes without needing to restart the app.
 const resumed=s.update({faces:[f()],inferenceMs:10,observedAtMs:7100},7150);
 assert.equal(resumed.present,true);
 // Delayed delivery counts age from capture, not arrival.
 assert.equal(s.update({faces:[f()],inferenceMs:10,observedAtMs:7200},10000).present,!fixed);
}
for(const fps of [6,15,30]){
 const s=new SignalProcessor(structuredClone(cfg));let track,misses=0;
 for(let i=0;i<360;i++){
  const t=i*1000/60;
  if(i%(60/fps)===0)track={faces:[f()],inferenceMs:10,observedAtMs:t};
  if(!s.update(track,t,16/9).present)misses++;
 }
 assert.equal(misses,0,`normal ${fps}Hz inference on 60Hz rendering must remain present`);
 const seen=s.target;
 // An old async response cannot rewind the current target.
 s.update({faces:[{...f(),bbox:{...f().bbox,cx:.6}}],inferenceMs:10,observedAtMs:5000},6000);
 assert.deepEqual(s.target,seen);
}
// Actual FaceTracker returns the same object when video.currentTime freezes.
const tracker=new FaceTracker({...cfg.tracker,inferenceEveryNFrames:1});
tracker.landmarker={detectForVideo(){return {faceLandmarks:[[{x:.4,y:.2,z:0},{x:.6,y:.5,z:0}]],faceBlendshapes:[],facialTransformationMatrixes:[]};}};
const video={readyState:4,currentTime:1,videoWidth:1280,videoHeight:720};
const first=tracker.update(video,100);
assert.equal(first.observedAtMs,100);
assert.equal(tracker.update(video,5000),first);
const s=new SignalProcessor(cfg);s.update(first,100);assert.equal(s.update(tracker.update(video,5000),5000).present,false);
// Repeated engine errors also cannot keep the previous sample alive.
tracker.landmarker.detectForVideo=()=>{throw new Error('injected inference failure');};video.currentTime=2;
assert.equal(tracker.update(video,6000).observedAtMs,100);
console.log(JSON.stringify(rows,null,2));
console.log('PASS: frozen main-video/cached result, late worker-style result, no stale reacquisition, short gaps, normal 6/15/30Hz, resume, inference exception');

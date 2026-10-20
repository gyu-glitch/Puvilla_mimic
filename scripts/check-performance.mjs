import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){
 const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);
}return next(s,c);}});
const {PaintCadence}=await import('../src/paintCadence.ts');
const gate=new PaintCadence();
let count=0;
for(let i=0;i<600;i++)if(gate.take(i/60,12,'1080',0))count++;
assert.equal(count,120);
assert.equal(gate.take(599/60,12,'1080',0),false);
assert.equal(gate.take(599/60,12,'resize',0),true);
assert.equal(gate.take(599/60,12,'resize',.5),true);
gate.reset();assert.equal(gate.take(599/60,12,'resize',0),true);
globalThis.location={href:'http://localhost/'};
globalThis.fetch=async()=>({ok:true});
let worker,submitted=[],closed=0;
globalThis.Worker=class {
 constructor(){worker=this;}
 postMessage(data){if(data.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready',delegate:'GPU'}}));else submitted.push(data);}
 terminate(){}
};
globalThis.createImageBitmap=async()=>({width:640,height:360,close(){closed++;}});
const {PoseTracker}=await import('../src/poseTracker.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
const tracker=new PoseTracker({...cfg.pose,useWorker:true,everyNFrames:1},'/wasm');
await tracker.init();
const video={readyState:4,currentTime:1},image={width:640,height:360};
const ts=performance.now();
tracker.update(video,ts,image);await Promise.resolve();
for(let i=0;i<100;i++){video.currentTime+=1/60;tracker.update(video,ts+1,image);}
assert.equal(submitted.length,1,'only one in-flight image, never queue video frames');
worker.onmessage({data:{type:'result',epoch:0,poses:[{id:1}],inferenceMs:10,ts}});
let result=tracker.update(video,performance.now(),image);await Promise.resolve();
assert.equal(result.fresh,true);assert.equal(result.observedAtMs,ts);
assert.equal(tracker.update(video,performance.now(),image).fresh,false,'deliver observation only once');
tracker.resetInput();
worker.onmessage({data:{type:'result',epoch:0,poses:[{id:'old'}],ts}});
assert.deepEqual(tracker.update(video,performance.now(),image).poses,[]);
await Promise.resolve();
worker.onmessage({data:{type:'result',epoch:1,poses:[{id:'late'}],ts:performance.now()-1000}});
assert.deepEqual(tracker.update(video,performance.now(),image).poses,[]);
await Promise.resolve();
tracker.resetInput();
worker.onmessage({data:{type:'result',epoch:1,poses:[],ts}});
tracker.update(video,performance.now(),image);
tracker.close();await Promise.resolve();
assert.ok(closed>0,'close bitmap created after tracker disposal');
console.log('PASS: 60→12 source cadence, resize/split/re-enable; pose backpressure, fresh-once, stale/rotation epochs, bitmap cleanup');

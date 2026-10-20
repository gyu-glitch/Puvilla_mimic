import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){
 if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){
  const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);
 }return next(s,c);
}});
const {FaceTracker}=await import('../src/tracker.ts');
const {PoseTracker}=await import('../src/poseTracker.ts');
const {quarterTurn}=await import('../src/cameraInput.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
assert.deepEqual([0,90,180,270,360,450,-90].map(quarterTurn),[0,90,180,270,0,90,270]);
const video={readyState:2,currentTime:1,videoWidth:360,videoHeight:640};
const image={width:640,height:360};
let faceCalls=0,poseCalls=0;
const face=new FaceTracker(cfg.tracker),pose=new PoseTracker(cfg.pose,'unused');
face.landmarker={detectForVideo(input){assert.equal(input,image);faceCalls++;
 return {faceLandmarks:[],faceBlendshapes:[],facialTransformationMatrixes:[]};}};
const points=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1}));
points[11].x=.4;points[12].x=.6;
pose.cfg={...cfg.pose,everyNFrames:1};
pose.landmarker={detectForVideo(input){assert.equal(input,image);poseCalls++;
 return {landmarks:[points],worldLandmarks:[points]};}};
face.update(video,100,image);
assert.equal(pose.update(video,100,image).poses[0].imageAspect,640/360);
face.update(video,110,image);pose.update(video,110,image);
assert.equal(faceCalls,1);assert.equal(poseCalls,1,'duplicate raw frame must not be inferred again');
face.resetInput();pose.resetInput();
assert.equal(pose.last.poses.length,0);
face.update(video,120,image);pose.update(video,120,image);
assert.equal(faceCalls,2);assert.equal(poseCalls,2,'rotation must refresh even if video time is unchanged');
// Real FaceTracker worker dispatch/response handling, with a fake worker.
globalThis.location={href:'https://test.invalid/'};
globalThis.fetch=async()=>({ok:true});
let worker,submitted;
globalThis.Worker=class {
 constructor(){worker=this;}
 postMessage(data){
  if(data.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready',delegate:'GPU'}}));
  else submitted=data;
 }
 terminate(){}
};
globalThis.createImageBitmap=async input=>{
 assert.equal(input,image);return {width:640,height:360};
};
const wf=new FaceTracker({...cfg.tracker,useWorker:true});
await wf.init();wf.update(video,200,image);
await Promise.resolve();
assert.equal(submitted.epoch,0);
wf.resetInput();
worker.onmessage({data:{type:'result',epoch:0,faces:[{old:true}],inferenceMs:5}});
assert.deepEqual(wf.lastResult.faces,[],'late pre-rotation response must be discarded');
wf.update(video,220,image);await Promise.resolve();
assert.equal(submitted.epoch,1);
worker.onmessage({data:{type:'result',epoch:1,faces:[{current:true}],inferenceMs:5}});
assert.deepEqual(wf.lastResult.faces,[{current:true}]);
console.log('PASS: 90° cycle; face-main/worker and pose receive rotated input; aspect/time guards; stale worker result rejected');

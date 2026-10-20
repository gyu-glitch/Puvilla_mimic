import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyTargetLock}=await import('../src/bodyTarget.ts');
const {SignalProcessor,emptySignal}=await import('../src/signals.ts');
const {MimicStateMachine}=await import('../src/state.ts');
const {FaceNeutral}=await import('../src/faceNeutral.ts');
const {FaceNeutral:Before}=await import('../dev/face-neutral-before-v47.ts');
const {FaceRecovery,faceMatchesHint}=await import('../src/faceRecovery.ts');
const {mapSignal}=await import('../src/character/mapping.ts');
const {armSessionFixture}=await import('../dev/arm-session-fixture.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
cfg.presence.lockZone={x:0,y:0,w:1,h:1};
const face=(pitch)=>({bbox:{x:.45,y:.2,w:.1,h:.12,cx:.5,cy:.26},yaw:30,pitch,roll:0,blend:{},eyes:{left:.02,right:.02},mouth:{open:.1,corner:.02}});
// Reproduce unlimited vertical freeze while eye/yaw calibration never passes.
for(const fps of [6,15,30,60]) {
 const old=new Before(),fixed=new FaceNeutral(),processor=new SignalProcessor(cfg);
 const out=[];
 for(let i=0;i<fps*12;i++){
  const t=i/fps,raw=face(24+12*Math.sin(t*2));
  old.update(raw,t*1000);fixed.update(raw,t*1000);
  assert.equal(old.pitch(raw.pitch),0);
  assert.ok(Math.abs(fixed.pitch(raw.pitch)-12*Math.sin(t*2))<1e-9);
  const sig=processor.update({faces:[raw],inferenceMs:1,observedAtMs:t*1000},t*1000);
  out.push(mapSignal(sig,cfg.mapping).headPitch);
 }
 assert.ok(Math.max(...out)>.12 && Math.min(...out)<-.12,'both directions reach character without neutral-ready');
 assert.equal(fixed.ready,false);
 fixed.reset();fixed.update(face(-15),13000);assert.equal(fixed.pitch(-15),0);assert.equal(fixed.pitch(-3),12);
}
const base=armSessionFixture(2.5,true).raw;
const person=(x=.5,scale=1,aspect=2)=>{
 const p=structuredClone(base),center=p.nose;
 p.image=p.image.map(v=>({x:x+(v.x-center.x)*scale,y:.3+(v.y-center.y)*scale}));
 p.nose={x,y:.3};p.imageAspect=aspect;
 p.shoulderW=Math.hypot(p.image[11].x-p.image[12].x,p.image[11].y-p.image[12].y);
 return p;
};
for(const aspect of [.5,1,2])for(const scale of [1,.1,.01]){
 const lock=new BodyTargetLock(cfg),p=person(.5,scale,aspect),fsm=new MimicStateMachine(cfg);
 assert.equal(lock.update([p],null,true,0),p,'small positive geometry must acquire');
 assert.ok(lock.headHint(0));assert.equal(fsm.update(emptySignal(),0,true).state,'ENTER');
 assert.equal(fsm.update(emptySignal(),1000,true).state,'MIMIC');
 assert.equal(lock.update([p],null,false,2000),null,'cached body must expire');
 assert.equal(lock.headHint(2000),null);
}
const lock=new BodyTargetLock(cfg),small=person(.2,.4),large=person(.6,1),larger=person(.15,1.4);
assert.equal(lock.update([small,large],null,true,0),large,'relative largest person first');
assert.equal(lock.update([larger,large],null,true,100),large,'keep selected person');
assert.equal(lock.update([larger],null,true,200),null,'no bystander takeover in hold');
assert.ok(lock.headHint(200));assert.equal(lock.update([larger],null,true,1800),larger,'after genuine loss reacquire');
const zoneCfg=structuredClone(cfg);zoneCfg.presence.lockZone={x:.4,y:0,w:.2,h:1};
assert.equal(new BodyTargetLock(zoneCfg).update([person(.1)],null,true,0),null);
const zero=person();zero.shoulderW=0;
assert.equal(new BodyTargetLock(cfg).update([zero],null,true,0),null);
const weak=person();weak.world[11].visibility=.2;
assert.equal(new BodyTargetLock(cfg).update([weak],null,true,0),null);
const hint={cx:.5,cy:.26,size:.3},sig=new SignalProcessor(cfg),visitor=face(24),other=face(24);
other.bbox={...other.bbox,x:.8,cx:.85};
assert.equal(faceMatchesHint(other,hint,2),false);
assert.equal(sig.update({faces:[other],inferenceMs:1},0,2,hint).present,false);
assert.equal(sig.update({faces:[visitor,other],inferenceMs:1},50,2,hint).present,true);
let draws=[];
globalThis.OffscreenCanvas=class{
 constructor(w,h){this.width=w;this.height=h;}
 getContext(){return {filter:'',drawImage(...args){draws.push(args);}};}
};
for(const [width,height] of [[1280,720],[720,1280],[720,720]]){
 const r=new FaceRecovery(),source={width,height},h={cx:.5,cy:.3,size:.2};let calls=0;
 const faces=r.run(source,100,(input)=>{calls++;assert.notEqual(input,source,'head-guided inference must run immediately');return [{...visitor,bbox:{x:.4,y:.4,w:.2,h:.2,cx:.5,cy:.5}}];},h);
 assert.equal(calls,1);assert.equal(r.mode,'person');
 assert.ok(Math.abs(faces[0].bbox.cx-h.cx)<1e-9 && Math.abs(faces[0].bbox.cy-h.cy)<1e-9);
 assert.equal(draws.at(-1)[3],height*.2);
}
console.log('PASS: eye calibration cannot freeze pitch (6/15/30/60 Hz); both directions reach renderer; reset reference; largest person without fixed size gate; continuity/zone/loss; wrong-person face rejection; immediate head ROI in 3 aspects');

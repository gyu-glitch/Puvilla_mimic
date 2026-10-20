import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){
    const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);
  }return next(s,c);
}});
const {SignalProcessor}=await import('../src/signals.ts');
const {MimicStateMachine}=await import('../src/state.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
cfg.presence.mimicOnLock=false; // Explicit distance-gated mode remains supported.
function face(h,cx=.5){
  return {bbox:{x:cx-.06,y:.3-h/2,w:.12,h,cx,cy:.3},
    yaw:20,pitch:10,roll:5,blend:{jawOpen:.5},
    mouth:{open:.3,corner:.02},eyes:{left:.2,right:.2}};
}
function session(aspect,correct=true,cx=.5){
  const config=structuredClone(cfg),proc=new SignalProcessor(config),fsm=new MimicStateMachine(config);
  let sig,state;
  const step=(from,to,size,visible=true)=>{
    for(let now=from;now<to;now+=1000/30){
      sig=proc.update({faces:visible?[face(size*Math.min(1,aspect),cx)]:[],inferenceMs:10},
        now,correct?aspect:1);
      state=fsm.update(sig,now);
    }
    return state.state;
  };
  return {proc,step,get signal(){return sig;}};
}
// Same face pixels / same short-side frame size, across input orientations.
for(const aspect of [16/9,4/3,1,3/4,9/16]){
  const s=session(aspect);
  assert.equal(s.step(0,4000,.25),'MIMIC');
  assert.ok(Math.abs(s.signal.bboxH-.25)<1e-8);
  assert.ok(Math.abs(s.signal.yaw)>10,'motion signal must survive presence normalization');
  assert.equal(s.proc.target.h,.25*Math.min(1,aspect),'target matching must retain raw coordinates');
  assert.equal(s.step(4000,7000,.19),'MIMIC','hysteresis holding range');
  assert.equal(s.step(7000,14000,.1),'IDLE','far visitor must still exit');
}
const old=session(9/16,false);
assert.equal(old.step(0,10000,.25),'ATTRACT');
assert.equal(old.signal.present,true);
assert.equal(old.proc.debugFaces[0].locked,true);
assert.equal(old.signal.near,false,'reproduce LOCK without MIMIC on portrait input');
const offCenter=session(9/16,true,.9);
assert.notEqual(offCenter.step(0,4000,.3),'MIMIC');
const lost=session(9/16);
assert.equal(lost.step(0,4000,.25),'MIMIC');
assert.equal(lost.step(4000,12000,.25,false),'IDLE');
console.log('PASS: portrait LOCK/no-response reproduced; 5 aspects enter/hold/exit, raw target coordinates, off-center and lost-face guards preserved');
// Venue image: detected/locked face h=.182 was below the old .22 entry gate.
for(const aspect of [16/9,1,9/16]){
 const config=structuredClone(cfg);config.presence.mimicOnLock=true;
 const processor=new SignalProcessor(config),fsm=new MimicStateMachine(config);
 let state,signal;
 for(let now=0;now<4000;now+=1000/30){
  signal=processor.update({faces:[face(.182*Math.min(1,aspect))],inferenceMs:10},now,aspect);
  state=fsm.update(signal,now);
 }
 assert.equal(signal.near,false,'reproduction stays below the distance gate');
 assert.equal(state.state,'MIMIC','a locked venue visitor must actually animate');
 for(let now=4000;now<12000;now+=1000/30){
  signal=processor.update({faces:[],inferenceMs:10},now,aspect);state=fsm.update(signal,now);
 }
 assert.equal(state.state,'IDLE','lock activation does not bypass loss/exit handling');
 const outside=new SignalProcessor(config),outsideState=new MimicStateMachine(config);
 for(let now=0;now<4000;now+=1000/30){
  signal=outside.update({faces:[face(.182,.99)],inferenceMs:10},now,aspect);
  state=outsideState.update(signal,now);
 }
 assert.notEqual(state.state,'MIMIC','outside-zone faces cannot activate mimic');
}
console.log('PASS: locked .182 face activates MIMIC with legacy .22 threshold, across 3 aspects; loss and outside-zone guards preserved');
{
 const config=structuredClone(cfg);config.presence.mimicOnLock=true;
 config.presence.lockZone={x:0,y:0,w:1,h:1};
 config.presence.lockCenterWeight=1; // Old browser preference cannot override largest-first mode.
 const large={...face(.18,.82),bbox:{x:.74,y:.21,w:.16,h:.18,cx:.82,cy:.3}};
 const small={...face(.12,.5),bbox:{x:.45,y:.24,w:.1,h:.12,cx:.5,cy:.3}};
 for(const faces of [[small,large],[large,small]]){
  const proc=new SignalProcessor(config),fsm=new MimicStateMachine(config);
  let sig=proc.update({faces,inferenceMs:1},0,16/9);
  assert.equal(proc.target.cx,.82,'largest off-center face wins regardless of result ordering');
  assert.equal(fsm.update(sig,0).state,'ENTER','relative largest can enter below absolute .22 gate');
  const newLargest={...small,bbox:{x:.35,y:.15,w:.3,h:.3,cx:.5,cy:.3}};
  proc.update({faces:[newLargest,large],inferenceMs:1},33,16/9);
  assert.equal(proc.target.cx,.82,'existing visitor stays locked when a larger bystander appears');
  proc.update({faces:[],inferenceMs:1},2000,16/9);
  proc.update({faces:[small,newLargest],inferenceMs:1},2033,16/9);
  assert.equal(proc.target.h,.3,'after loss, select the currently largest face');
 }
}
console.log('PASS: largest face acquisition independent of ordering/old center preference; lock continuity; largest reacquisition after loss');

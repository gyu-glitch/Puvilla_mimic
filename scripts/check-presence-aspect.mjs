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

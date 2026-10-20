import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyTargetLock}=await import('../src/bodyTarget.ts');
const {BodyProcessor}=await import('../src/body.ts');
const {BodyProcessor:Before}=await import('../dev/body-before-v26.ts');
const {MimicStateMachine}=await import('../src/state.ts');
const {emptySignal}=await import('../src/signals.ts');
const {armTrackingFixture}=await import('../dev/arm-tracking-fixture.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
const target=new BodyTargetLock(),processor=new BodyProcessor(cfg),fsm=new MimicStateMachine(cfg);
const oldProcessor=new Before(cfg),oldFSM=new MimicStateMachine(cfg);
const face={cx:.5,cy:.3,h:.3},raw=armTrackingFixture(2.5).raw;
let oldDroppedAt=null,oldExitAt=null;
for(let frame=0;frame<900;frame++){
 const now=frame*1000/30;
 // Hands obscure the face at 2s; the face subsystem holds its target for 1.5s.
 const faceHeld=now<3500;
 const signal={...emptySignal(),present:faceHeld,near:faceHeld};
 const body=processor.update(target.update([raw],faceHeld?face:null,true,now),true,now);
 const state=fsm.update(signal,now,body!==null);
 const oldBody=oldProcessor.update(faceHeld?raw:null,true,now);
 const oldState=oldFSM.update(signal,now);
 if(now>1000){
  assert.equal(body?.armL,1);assert.equal(body?.armR,1);
  assert.equal(state.state,'MIMIC','body still present but interaction exited');
  if(!oldDroppedAt && oldBody?.armL!==1)oldDroppedAt=now;
  if(!oldExitAt && oldState.state==='EXIT')oldExitAt=now;
 }
}
assert.ok(oldDroppedAt>=3500&&oldDroppedAt<3600);
assert.ok(oldExitAt>=5000&&oldExitAt<5100);
// The tracked visitor leaving must release the body and exit; a new body alone
// cannot take ownership, and a far-away visitor cannot keep the session alive.
const stranger=structuredClone(raw);stranger.nose.x=.95;stranger.image.forEach(p=>p.x=.95);
assert.equal(target.update([stranger],null,true,30000),null);
let state;
for(let now=30000;now<33000;now+=50){
 const b=processor.update(target.update([],null,true,now),true,now);
 state=fsm.update(emptySignal(),now,b!==null);
}
assert.equal(state.state,'IDLE');
assert.equal(new BodyTargetLock().update([raw],null,true,0),null);
const unowned=new MimicStateMachine(cfg);
assert.equal(unowned.update(emptySignal(),1000,true).state,'ENTER','a selected person can now start mimic without face');
// Modest confidence drift on a steady pose must not drop either arm.
const stable=new BodyProcessor(cfg),oldStable=new Before(cfg);let oldRejected=0;
for(let frame=0;frame<600;frame++){
 const r=structuredClone(raw),now=frame*1000/30;
 if(now>3000)for(const id of [13,14,15,16])r.world[id].visibility=.58;
 const a=stable.update(r,true,now),b=oldStable.update(r,true,now);
 if(now>3200){assert.equal(a.armL,.58);assert.equal(a.armR,.58);if(b.armL===0)oldRejected++;}
}
assert.ok(oldRejected>400);
const bad=structuredClone(raw);bad.world[15].visibility=.58;bad.world[15].x+=.25;
assert.equal(stable.update(bad,true,20100).armR,0,'uncertain moving landmark accepted as a steady arm');
console.log({oldDroppedAt,oldExitAt,continuousBodyHeldSeconds:30,oldSteadyConfidenceFramesRejected:oldRejected});

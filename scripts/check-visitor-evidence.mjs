import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyTargetLock}=await import('../src/bodyTarget.ts');
const {MimicStateMachine}=await import('../src/state.ts');
const {emptySignal}=await import('../src/signals.ts');
const {armSessionFixture}=await import('../dev/arm-session-fixture.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));cfg.presence.lockZone={x:0,y:0,w:1,h:1};cfg.presence.mimicOnLock=true;
const raw=armSessionFixture(2.5,true).raw;
function person(cx=.5,scale=1,aspect=2){const p=structuredClone(raw),n=p.nose;p.image=p.image.map(v=>({x:cx+(v.x-n.x)*scale,y:.3+(v.y-n.y)*scale}));p.nose={x:cx,y:.3};p.imageAspect=aspect;p.shoulderW=Math.hypot(p.image[11].x-p.image[12].x,p.image[11].y-p.image[12].y);return p;}
function observed(p,ts){return {observedAtMs:ts,inferenceMs:5,faces:[{bbox:{cx:p.nose.x,cy:p.nose.y,h:.1,w:.1,x:p.nose.x-.05,y:p.nose.y-.05}}]};}
// The same confident skeleton is emitted indefinitely by a hypothetical false
// body detector. No face evidence ever supports it. Old wiring moves forever.
const phantom=person(),oldFsm=new MimicStateMachine(cfg),newFsm=new MimicStateMachine(cfg),lock=new BodyTargetLock(cfg);
for(let t=0;t<20000;t+=33){const p=lock.update([phantom],null,true,t);lock.observeFace({faces:[],inferenceMs:1,observedAtMs:t},t);
 oldFsm.update(emptySignal(),t,!!p);const state=newFsm.update(emptySignal(),t,lock.confirmed(t));assert.ok(!['ENTER','MIMIC'].includes(state.state));assert.equal(lock.debugTarget(t)[0].pending,true);}
assert.equal(oldFsm.current,'MIMIC');
// Two fresh face observations; camera frame reuse, wrong head, old responses do not count.
for(const aspect of [.5,1,2])for(const scale of [1,.1,.01]){
 const p=person(.5,scale,aspect),l=new BodyTargetLock(cfg);l.update([p],null,true,0);
 l.observeFace(observed(p,0),0);assert.equal(l.confirmed(0),false);
 l.observeFace(observed(p,0),33);assert.equal(l.confirmed(33),false);
 l.observeFace(observed(p,33),33);assert.equal(l.confirmed(33),true);
 for(let t=66;t<2900;t+=33){l.update([p],null,true,t);l.observeFace(observed(p,33),t);assert.equal(l.confirmed(t),true);}
 l.update([p],null,true,3100);assert.equal(l.confirmed(3100),false,'endless pose + cached face cannot renew visitor');
 l.observeFace(observed(p,100),3100);assert.equal(l.confirmed(3100),false,'late response cannot renew');
 l.observeFace(observed(p,3100),3100);assert.equal(l.confirmed(3100),false);l.observeFace(observed(p,3133),3133);assert.equal(l.confirmed(3133),true);
 l.update([],null,true,5000);assert.equal(l.confirmed(5000),false,'actual body loss expires');
}
const l=new BodyTargetLock(cfg),fake=person(.15),real=person(.8,.3);l.update([fake],null,true,0);l.observeFace(observed(real,50),50);l.observeFace(observed(real,83),83);assert.equal(l.confirmed(83),false);
const revision=l.revision;assert.equal(l.update([fake,real],null,true,100),real,'unconfirmed ghost cannot monopolize real visitor elsewhere');assert.ok(l.revision>revision);
l.observeFace(observed(real,100),100);l.observeFace(observed(real,133),133);assert.equal(l.confirmed(133),true);
l.observeFace(observed(fake,166),166);assert.equal(l.update([fake,real],null,true,166),real,'confirmed visitor retains identity');
console.log('PASS: old indefinite empty-scene MIMIC reproduced; unsupported poses never animate; 9 size/aspect cases acquire, brief face occlusion survives, stale/repeated frames cannot renew, real visitor can replace unconfirmed ghost');

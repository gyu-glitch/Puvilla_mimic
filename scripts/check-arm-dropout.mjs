import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyProcessor}=await import('../src/body.ts');
const {BodyProcessor:Before}=await import('../dev/body-before-v50.ts');
const {BodyTargetLock}=await import('../src/bodyTarget.ts');
const {BodyTargetLock:OldLock}=await import('../dev/body-target-before-v50.ts');
const {armSessionFixture}=await import('../dev/arm-session-fixture.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
cfg.presence.mimicOnLock=true;cfg.presence.lockZone={x:0,y:0,w:1,h:1};
const raw=armSessionFixture(3,true).raw;
const results=[];
for(const interval of [100,200,300,400]){
 const before=new Before(cfg),after=new BodyProcessor(cfg);let oldDrops=0,newDrops=0;
 for(let t=0;t<=10000;t+=20){
  const fresh=t%interval===0;
  // One missing observation every two seconds, on the faster two inputs.
  const missing=fresh&&interval<=200&&t>1000&&t%2000===0;
  const p=missing?null:raw;
  const old=before.update(p,fresh,t),next=after.update(p,fresh,t);
  if(t>=1000){if(!old?.armL||!old?.armR)oldDrops++;if(!next?.armL||!next?.armR)newDrops++;}
 }
 assert.equal(newDrops,0,`valid held gesture dropped at ${interval} ms cadence`);
 assert.ok(oldDrops>0,'old failure must be reproduced');
 // No face or pose input can pin a stale arm forever.
 after.update(raw,true,10020);
 assert.equal(after.update(null,true,10480)?.armL,0);
 assert.equal(after.update(null,false,10540),null);
 results.push({intervalMs:interval,oldDroppedRenderFrames:oldDrops,newDroppedRenderFrames:newDrops});
}
// Real lowering is applied immediately, without waiting for dropout grace.
const lowering=new BodyProcessor(cfg);
for(let t=0;t<1000;t+=50)lowering.update(raw,true,t);
const start=lowering.update(raw,true,1000).wristL[1];
let end;
for(let t=1050;t<=3000;t+=50){end=lowering.update(armSessionFixture(16+(t-1000)/1000,true).raw,true,t);assert.ok(end.armL>0);}
assert.ok(end.wristL[1]<start-.15);
const offscreen=structuredClone(raw);offscreen.image[15].x=1.1;
assert.equal(lowering.update(offscreen,true,3050).armR,0,'observed off-screen arm still releases');
// Fresh matching face detections every 800 ms must renew a confirmed visitor.
const lock=new BodyTargetLock(cfg),old=new OldLock(cfg);let oldExpired=0;
let track={faces:[],inferenceMs:1};
for(let t=0;t<15000;t+=20){
 for(const l of [lock,old])l.update([raw],null,true,t);
 if(t===0||t===100||(t>100&&t%800===0))track={faces:[{bbox:{cx:raw.nose.x,cy:raw.nose.y,w:.1,h:.1}}],inferenceMs:1,observedAtMs:t};
 for(const l of [lock,old])l.observeFace(track,t);
 if(t>=100){assert.equal(lock.confirmed(t),true);if(!old.confirmed(t))oldExpired++;}
}
assert.ok(oldExpired>0);
for(let t=15000;t<=18500;t+=20){lock.update([raw],null,true,t);lock.observeFace(track,t);}
assert.equal(lock.confirmed(18500),false,'repeated cached face never renews confirmation');
console.log(JSON.stringify({poseCadence:results,oldFaceExpiredFrames:oldExpired,newFaceExpiredFrames:0,missingPoseReleaseMs:450},null,2));

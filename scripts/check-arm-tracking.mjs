import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyProcessor}=await import('../src/body.ts');
const {BodyProcessor:Before}=await import('../dev/body-before-v24.ts');
const {armTrackingFixture}=await import('../dev/arm-tracking-fixture.ts');
const cfg=JSON.parse(readFileSync('public/config.json','utf8'));
let oldBad=0,newBad=0,validOther=0;
for(const fps of [15,30,60]){
 const after=new BodyProcessor(cfg),before=new Before(cfg);
 for(let frame=0;frame<12*fps;frame++){
  const t=frame/fps,{raw}=armTrackingFixture(t);
  const a=after.update(raw,true,t*1000),b=before.update(raw,true,t*1000);
  if(t>=3&&t<6){
   if(b?.armR>=cfg.body.minVisibility)oldBad++;
   if(a?.armR>=cfg.body.minVisibility)newBad++;
   assert.equal(a.armR,0,'uncertain/off-screen arm remained active');
   assert.equal(a.armL,1,'bad left arm disabled reliable right arm');validOther++;
  }
  if(t>=6&&t<6.35)assert.equal(a?.armL,1,'brief missing body must preserve the accepted arm');
  if(t>=6.46&&t<7)assert.ok(!a||a.armL===0,'sustained missing body must release the arm');
  if(t>=8.3&&t<10)assert.equal(a?.armR,1,'stable raised arm did not reacquire');
  if(t>=11.1)assert.equal(a?.armR,0,'uncertain lowered arm became active again');
 }
}
assert.ok(oldBad>100);assert.equal(newBad,0);
// Frame skips are normal; stalled inference and a fresh missing body are different.
const p=new BodyProcessor(cfg),raw=armTrackingFixture(2.5).raw;
for(let t=0;t<=300;t+=50)p.update(raw,true,t);
assert.equal(p.update(raw,false,400).armR,1);
assert.equal(p.update(raw,false,550).armR,1);
assert.equal(p.update(raw,false,750).armR,0);
assert.equal(p.update(raw,true,760).armR,0);
assert.equal(p.update(raw,true,860).armR,0);
assert.equal(p.update(raw,true,960).armR,1);
const collapsed=structuredClone(raw);Object.assign(collapsed.world[15],collapsed.world[13]);
assert.equal(p.update(collapsed,true,1000).armR,0,'collapsed bone accepted');
// Invalid input must never seed the reacquired OneEuro filters.
const exploded=structuredClone(raw);exploded.world[15].x=999;
assert.equal(p.update(exploded,true,1050).armR,0);
for(let t=1100;t<=1300;t+=50)p.update(raw,true,t);
const stable=p.update(raw,true,1350);
assert.ok(Math.abs(stable.wristR[0]+raw.world[15].x)<1e-9);
console.log({oldUncertainFramesAccepted:oldBad,newUncertainFramesAccepted:newBad,reliableOtherArmFrames:validOther});
console.log('PASS: independent rest, stable reacquisition at 15/30/60Hz, missing body, frame skips, stall, off-screen wrist, collapsed bone and clean filter recovery.');

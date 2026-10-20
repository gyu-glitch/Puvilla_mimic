import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyProcessor}=await import('../src/body.ts');
const {BodyProcessor:Before}=await import('../dev/body-before-v44.ts');
const {armLoweringFixture}=await import('../dev/arm-lowering-fixture.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
const rows=[];
for(const fps of [15,30,60])for(const mirror of [false,true])for(const confidence of [.52,.58,.64])for(const duration of [3,8,20]){
 const c=structuredClone(cfg);c.camera.mirror=mirror;
 const old=new Before(c),next=new BodyProcessor(c);let droppedAt=null,maxStep=0,previous=null;
 for(let f=0;f<fps*(duration+3);f++){
  const t=f/fps,raw=armLoweringFixture(t,confidence,duration).raw;
  const a=old.update(raw,true,t*1000),b=next.update(raw,true,t*1000);
  if(t>=1){
   if(!a.armL&&droppedAt===null)droppedAt=t;
   assert.ok(b.armL>0&&b.armR>0,`dropped lowering ${JSON.stringify({fps,mirror,confidence,t})}`);
   if(previous)maxStep=Math.max(maxStep,Math.hypot(...b.wristL.map((x,i)=>x-previous[i])));
  }
  previous=b.wristL;
 }
 assert.ok(droppedAt>1&&droppedAt<duration);
 assert.ok(maxStep<.025*8/duration,'slow input acquired a positional jump');
 next.update(null,true,(duration+3)*1000);
 assert.equal(next.update(armLoweringFixture(2,confidence).raw,true,(duration+3)*1000+50).armL,0,'weak input reacquired without confirmation');
 rows.push({fps,mirror,confidence,duration,oldDroppedAtSec:droppedAt,maxAcceptedStepCm:maxStep*100});
}
// No image support, a collapsed arm, or an off-screen wrist cannot use the exception.
for(const invalid of ['missingImage','offscreen','collapsed','lowConfidence']){
 const p=new BodyProcessor(cfg);let b;
 for(let f=0;f<180;f++){
  const t=f/30,raw=armLoweringFixture(t).raw;
  if(t>=1){
   if(invalid==='missingImage')delete raw.image;
   if(invalid==='offscreen')raw.image[15].x=1.2;
   if(invalid==='collapsed')raw.world[15]={...raw.world[13]};
   if(invalid==='lowConfidence')raw.world[15].visibility=.3;
  }
  b=p.update(raw,true,t*1000);
 }
 assert.equal(b.armR,0,invalid);
}
console.log(JSON.stringify({cases:rows.length,slowLowering:rows.filter(r=>r.fps===30&&r.mirror&&r.confidence===.58),invalidObservations:'rejected'},null,2));

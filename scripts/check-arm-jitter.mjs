import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyProcessor}=await import('../src/body.ts');
const {BodyProcessor:Before}=await import('../dev/body-before-v27.ts');
const {armJitterFixture}=await import('../dev/arm-jitter-fixture.ts');
const {armSessionFixture}=await import('../dev/arm-session-fixture.ts');
const {alignedCameraArm}=await import('../src/armImageAlignment.ts');
const {alignedCameraArm:oldAligned}=await import('../dev/arm-image-before-v27.ts');
const {standingTorso}=await import('../src/character/standingTorso.ts');
const {Quaternion,Vector3}=await import('three');
const cfg=JSON.parse(readFileSync('public/config.json'));
let oldTransitions=0,newTransitions=0;
for(const fps of [15,30,60]){
 const before=new Before(cfg),after=new BodyProcessor(cfg);let old=0,next=0;
 for(let f=0;f<6*fps;f++){
  const t=f/fps,raw=armJitterFixture(t).raw,b=before.update(raw,true,t*1000),a=after.update(raw,true,t*1000);
  if(t>=2){if(old!==(b.armL>0))oldTransitions++;if(next!==(a.armL>0))newTransitions++;}
  old=b.armL>0;next=a.armL>0;
 }
 // Persistent uncertainty must still end the hold in bounded time.
 const low=armSessionFixture(3,true).raw;
 for(const id of [13,14,15,16])low.world[id].visibility=.49;
 after.update(low,true,6000);
 assert.equal(after.update(low,true,6150).armL,0);
 const good=armSessionFixture(3,true).raw;
 for(let t=6200;t<=6500;t+=50)after.update(good,true,t);
 const missing=structuredClone(good);missing.image[15].x=1.1;
 assert.equal(after.update(missing,true,6550).armR,0);
}
assert.ok(oldTransitions>10);assert.equal(newTransitions,0);
const aa=armJitterFixture(6.01).raw,bb=armJitterFixture(6.08).raw;
const world=(p)=>new Vector3(p.world[13].x-p.world[15].x,p.world[13].y-p.world[15].y,p.world[13].z-p.world[15].z).normalize();
const direction=(fn,r)=>fn(r,[11,13,15],true)?.fore??world(r);
const oldAngle=direction(oldAligned,aa).angleTo(direction(oldAligned,bb));
const newAngle=direction(alignedCameraArm,aa).angleTo(direction(alignedCameraArm,bb));
assert.ok(oldAngle>.1);assert.ok(newAngle<.001);
const p=new BodyProcessor(cfg);let pose;
for(let t=0;t<500;t+=50)pose=p.update(armJitterFixture(10.01).raw,true,t);
const low={...pose,hips:.49},high={...pose,hips:.51};
const q=(pose,legacy)=>{const result=new Quaternion();standingTorso(pose,.5,result,legacy);return result;};
const oldTorso=q(low,true).angleTo(q(high,true)),newTorso=q(low,false).angleTo(q(high,false));
assert.ok(oldTorso>.3);assert.ok(newTorso<.005);
console.log({oldConfidenceTransitions:oldTransitions,newConfidenceTransitions:newTransitions,
 oldBoundaryJumpDeg:oldAngle*180/Math.PI,newBoundaryJumpDeg:newAngle*180/Math.PI,
 oldTorsoJumpDeg:oldTorso*180/Math.PI,newTorsoJumpDeg:newTorso*180/Math.PI});

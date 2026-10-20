import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {Vector3}=await import('three');
const {BodyProcessor}=await import('../src/body.ts');
const {BodyProcessor:Before}=await import('../dev/body-before-v26.ts');
const {alignedCameraArm}=await import('../src/armImageAlignment.ts');
const {armSessionFixture}=await import('../dev/arm-session-fixture.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
const raw=armSessionFixture(2.5).raw,a=new BodyProcessor(cfg),b=new Before(cfg);
let after,before;
for(let t=0;t<2000;t+=50){after=a.update(raw,true,t);before=b.update(raw,true,t);}
const fore=(p,s)=>new Vector3(...p['wrist'+s]).sub(new Vector3(...p['elbow'+s])).normalize();
const mirrored=v=>new Vector3(-v.x,v.y,v.z);
const oldError=fore(before,'L').angleTo(mirrored(fore(before,'R')));
const newError=fore(after,'L').angleTo(mirrored(fore(after,'R')));
assert.ok(oldError>.3);assert.ok(newError<1e-7,'same image gesture produced unequal forearm directions');
const forward=structuredClone(raw);
for(const [s,e,w] of [[11,13,15],[12,14,16]]){
 forward.world[w]={...forward.world[e],y:forward.world[e].y-.025,z:forward.world[e].z-.25};
 forward.image[w]={x:forward.image[e].x,y:forward.image[e].y-.02};
}
assert.ok(alignedCameraArm(forward,[11,13,15],true).fore.z>.9,'genuine foreshortened forward arm was flattened');
const turned=structuredClone(raw);turned.world[11].z=.3;turned.world[12].z=-.3;
assert.equal(alignedCameraArm(turned,[11,13,15],true),null,'frontal reconstruction applied to a turned torso');
const omitted=structuredClone(raw);delete omitted.imageAspect;
assert.equal(alignedCameraArm(omitted,[11,13,15],true),null);
for(const mirror of [true,false]){
 const right=alignedCameraArm(raw,[12,14,16],mirror),left=alignedCameraArm(raw,[11,13,15],mirror);
 assert.ok(right.fore.distanceTo(mirrored(left.fore))<1e-9);
}
console.log({oldBilateralForearmDifferenceDeg:oldError*180/Math.PI,newBilateralForearmDifferenceDeg:newError*180/Math.PI});

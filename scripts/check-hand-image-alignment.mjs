import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyProcessor}=await import('../dev/body-candidate-v33-hand.ts'),{BodyProcessor:Before}=await import('../dev/body-before-v33.ts');
const {armHandMirrorFixture}=await import('../dev/arm-hand-mirror-fixture.ts');
const {alignedCameraHand}=await import('../src/handImageAlignment.ts');
const {Vector3}=await import('three');
const cfg=JSON.parse(readFileSync('public/config.json')),rows=[];
for(const mirror of [true,false])for(const fps of [15,30,60]){
 const config=structuredClone(cfg);config.camera.mirror=mirror;
 const before=new Before(config),after=new BodyProcessor(config),raw=armHandMirrorFixture(8).raw;
 let a,b;for(let f=0;f<fps*3;f++){a=after.update(raw,true,f*1000/fps);b=before.update(raw,true,f*1000/fps);}
 const error=p=>{const l=new Vector3(...p.handAcrossL),r=new Vector3(...p.handAcrossR);r.x=-r.x;return l.angleTo(r)*180/Math.PI;};
 const old=error(b),next=error(a);assert.ok(old>40);assert.ok(next<1e-6);
 rows.push({fps,mirror,beforeAcrossDifferenceDegrees:old,afterAcrossDifferenceDegrees:next});
}
// Actual palm turns narrow the image span, so retain their measured depth.
for(const angle of [-1.0,-.6,0,.6,1.0]){
 const raw=armHandMirrorFixture(2.5).raw;
 for(const [wr,ix,pk,sign] of [[15,19,17,1],[16,20,18,-1]]){
  const wrist=raw.world[wr];
  raw.world[ix]={x:wrist.x-sign*.035*Math.cos(angle),y:wrist.y-.085,z:wrist.z+sign*.035*Math.sin(angle),visibility:1};
  raw.world[pk]={x:wrist.x+sign*.035*Math.cos(angle),y:wrist.y-.085,z:wrist.z-sign*.035*Math.sin(angle),visibility:1};
  for(const id of [ix,pk]){const v=raw.world[id];raw.image[id]={x:.5+v.x*.65/raw.imageAspect,y:.88+v.y*.65};}
 }
 for(const right of [true,false]){
  const h=alignedCameraHand(raw,right,true),ix=right?20:19,pk=right?18:17;
  const expected=new Vector3(raw.world[pk].x-raw.world[ix].x,raw.world[pk].y-raw.world[ix].y,raw.world[pk].z-raw.world[ix].z).normalize();
  // Matched image/world lengths preserve supported real turns.
  assert.ok(h.across.angleTo(expected)<1e-6,'real hand turn flattened');
 }
}
const missing=armHandMirrorFixture(8).raw;missing.world[20].visibility=.2;
assert.equal(alignedCameraHand(missing,false,true),null,'missing other hand invented a size reference');
// Fading reference confidence must not suddenly turn the opposite palm.
const low=armHandMirrorFixture(8).raw;
low.world[20].visibility=.6501;
const nearBoundary=alignedCameraHand(low,false,true).across;
const observed=new Vector3(low.world[17].x-low.world[19].x,low.world[17].y-low.world[19].y,low.world[17].z-low.world[19].z).normalize();
assert.ok(nearBoundary.angleTo(observed)<1e-5,'reference confidence boundary snapped');
console.log(JSON.stringify({rows,realTurnsAndMissingReference:'pass'},null,2));

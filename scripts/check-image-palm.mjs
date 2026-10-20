import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyProcessor}=await import('../src/body.ts'),{imagePalm}=await import('../src/imagePalm.ts');
const {armHandMirrorFixture}=await import('../dev/arm-hand-mirror-fixture.ts');
const {Vector3}=await import('three');
const config=JSON.parse(readFileSync('public/config.json')),rows=[];
for(const mirror of [true,false])for(const fps of [15,30,60])for(const oneHand of [false,true]){
 const raw=armHandMirrorFixture(8).raw,clean=armHandMirrorFixture(2.5).raw;
 // Keep the same arm/hand screen positions; remove only the injected depth.
 for(const [id,sign] of [[19,1],[17,-1]])raw.world[id].z-=sign*.045;
 const desired=structuredClone(raw);
 raw.world[19].z+=.045;raw.world[17].z-=.045;
 if(oneHand)for(const id of [14,16,18,20]){raw.world[id].visibility=0;desired.world[id].visibility=0;}
 let before,after,expected;
 for(const mode of ['before','after','expected']){
  const cfg=structuredClone(config);cfg.camera.mirror=mirror;cfg.body.armImagePalm=mode!=='before';
  const p=new BodyProcessor(cfg);let value;
  for(let i=0;i<fps*2;i++)value=p.update(mode==='expected'?desired:raw,true,i*1000/fps);
  if(mode==='before')before=value;else if(mode==='after')after=value;else expected=value;
 }
 const name=mirror?'R':'L',vector=p=>new Vector3(...p['handAcross'+name]);
 const error=vector(before).angleTo(vector(expected))*180/Math.PI;
 const afterError=vector(after).angleTo(vector(expected))*180/Math.PI;
 assert.ok(error>40);assert.ok(afterError<1e-6);
 assert.equal(after['handAcross'+name][2],0);
 rows.push({mirror,fps,oneHand,beforeDegrees:error,afterDegrees:afterError});
}
const raw=armHandMirrorFixture(8).raw;
assert.ok(imagePalm(raw,15,19,17,true));
const lost=structuredClone(raw);lost.image[19].x=1.2;
assert.equal(imagePalm(lost,15,19,17,true),null);
const collapsed=structuredClone(raw);collapsed.image[19]=collapsed.image[17];
assert.equal(imagePalm(collapsed,15,19,17,true),null);
// Image-plane wrist direction remains real input, not a forced vertical wrist.
const rotated=structuredClone(raw),w=rotated.image[15],aspect=rotated.imageAspect,angle=.35;
for(const id of [19,17]){
 const p=rotated.image[id],x=(p.x-w.x)*aspect,y=p.y-w.y;
 p.x=w.x+(x*Math.cos(angle)-y*Math.sin(angle))/aspect;p.y=w.y+x*Math.sin(angle)+y*Math.cos(angle);
}
const a=imagePalm(raw,15,19,17,true),b=imagePalm(rotated,15,19,17,true);
assert.ok(Math.abs(a.forward.angleTo(b.forward)-angle)<1e-6);
console.log(JSON.stringify({scope:'Camera-plane greeting. Real palm/back depth turns deliberately omitted; image-plane wrist direction preserved.',rows,missingAndCollapsed:'pass',imageWristTurnDegrees:angle*180/Math.PI},null,2));

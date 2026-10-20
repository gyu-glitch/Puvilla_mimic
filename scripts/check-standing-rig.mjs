import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
// Resolve the application's bundler-style TS imports for these Node regression checks.
registerHooks({resolve(specifier,context,next){
 if(specifier.startsWith('.')&&context.parentURL&&!/\.[a-z]+$/i.test(specifier)){
  const ts=new URL(specifier+'.ts',context.parentURL);if(existsSync(ts))return next(ts.href,context);
 }return next(specifier,context);
}});
const {BodyProcessor}=await import('../src/body.ts');
const DEFAULT_CONFIG=JSON.parse(readFileSync('public/config.json','utf8'));
const rig=JSON.parse(readFileSync('public/models/stand_connected_rig.json','utf8'));
const baseline='work/stand/pu_stand.obj';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(hash('public/models/pu_stand.obj'),hash(baseline),'original model changed');
assert.equal(hash('public/models/muffler_fit.bin'),hash('work/stand/muffler_fit.bin'),'original scarf changed');
assert.equal(rig.sourceSha256,hash(baseline));
let torso=0,arms=0;
rig.weights.forEach((w,i)=>{
 assert.ok(w.every(Number.isFinite));assert.ok(w.every(x=>x>=0&&x<=1));
 assert.ok(w[0]+w[1]<=1.000001);assert.ok(w[2]<=w[0]+w[1]+1e-8);
 const [x,y]=rig.rest[i];
 if(y>120||Math.abs(x)<15){assert.equal(w[0]+w[1],0,'head/central torso acquired arm influence');torso++;}
 if(w[0]+w[1]>.999)arms++;
});
assert.ok(arms>300);assert.ok(torso>400);
for(const joint of ['shoulder','elbow','hand']){
 assert.equal(rig.joints.L[joint][0],-rig.joints.R[joint][0]);
 assert.deepEqual(rig.joints.L[joint].slice(1),rig.joints.R[joint].slice(1));
}
function raw(){
 const world=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));
 for(const [i,p] of Object.entries({11:[.2,-.5,0],12:[-.2,-.5,0],13:[.4,-.3,0],14:[-.3,-.25,0],15:[.5,-.55,-.2],16:[-.3,0,0],23:[.1,0,0],24:[-.1,0,0]})){
  [world[i].x,world[i].y,world[i].z]=p;
 }return {world,nose:{x:.5,y:.3},shoulderW:.3};
}
const cfg=structuredClone(DEFAULT_CONFIG);cfg.camera.mirror=true;
const processor=new BodyProcessor(cfg),r=raw(),a=processor.update(r,true,1000);
assert.ok(a);assert.ok(a.shoulderL[0]>0&&a.shoulderR[0]<0);
assert.equal(a.wristR[0],-.5,'mirrored human left wrist must drive screen-left paw');
const occluded=raw();occluded.world[15].visibility=0;occluded.world[15].x=999;
const held=processor.update(occluded,true,1100);
assert.ok(held.wristR.every((v,i)=>Math.abs(v-a.wristR[i])<1e-10),'occluded wrist polluted pose');assert.equal(held.armR,1);assert.equal(held.armL,1);
const expired=processor.update(occluded,true,1601);assert.equal(expired.armR,0);assert.equal(expired.armL,1);
const invalid=raw();invalid.world[11].x=NaN;
assert.ok(processor.update(invalid,true,1650));assert.equal(processor.update(invalid,true,2200),null);
const recovered=processor.update(raw(),true,2300);assert.ok(recovered.wristR.every(Number.isFinite));
const nearest=raw(),other=raw();other.nose={x:.9,y:.3};other.shoulderW=.8;
assert.equal(BodyProcessor.pickForFace([other,nearest],{cx:.5,cy:.3,h:.2}),nearest);
console.log(`PASS: original body/scarf hashes; ${torso} fixed torso/head vertices; ${arms} fully weighted arm vertices; symmetric joints; mirrored tracking; independent occlusion hold/release; NaN recovery; face/body association.`);

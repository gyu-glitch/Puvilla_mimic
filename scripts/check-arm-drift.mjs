import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {BodyProcessor}=await import('../src/body.ts');
const {BodyProcessor:Before}=await import('../dev/body-before-v32.ts');
const {armDriftFixture}=await import('../dev/arm-drift-fixture.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
const rows=[];
for(const fps of [15,30,60])for(const mirror of [false,true])for(const side of ['L','R']){
 const config=structuredClone(cfg);config.camera.mirror=mirror;
 const before=new Before(config),after=new BodyProcessor(config),key='arm'+(mirror?side:side==='L'?'R':'L');
 let oldBad=0,newBad=0,held=0;
 for(let f=0;f<fps*16;f++){
  const t=f/fps,raw=armDriftFixture(t,side).raw;
  const b=before.update(raw,true,t*1000),a=after.update(raw,true,t*1000);
  if(t>=3&&t<6||t>=14&&t<16){oldBad+=b[key]>0?1:0;newBad+=a[key]>0?1:0;}
  if(t>=8.2&&t<11){assert.ok(a.armL>0&&a.armR>0,'steady low-confidence greeting was dropped');held++;}
  if(t>=6.3&&t<8)assert.ok(a[key]>0,'valid new lift was blocked');
 }
 assert.ok(oldBad>0,'fixture did not reproduce slow false activation');
 if(!process.argv.includes('--baseline'))assert.equal(newBad,0,'weak drift moved the arm away from a confident anchor');
 rows.push({fps,mirror,side,oldBad,newBad,held});
}
// A confirmed gesture can stay still indefinitely without a fresh high score.
// The anchor is spatial, not a timeout that lowers both arms after a few seconds.
for(const fps of [15,30,60]){
 const p=new BodyProcessor(cfg),raw=armDriftFixture(8).raw;
 for(const id of [13,14,15,16])raw.world[id].visibility=1;
 for(let f=0;f<fps;f++)p.update(raw,true,f*1000/fps);
 for(const id of [13,14,15,16])raw.world[id].visibility=.58;
 for(let f=fps;f<fps*31;f++){
  const a=p.update(raw,true,f*1000/fps);
  assert.ok(a.armL>0&&a.armR>0,'stationary raised arms expired');
 }
 p.update(null,true,31000);
 assert.equal(p.update(raw,true,31050).armL,0,'low confidence reacquired a cleared anchor');
}
console.log(JSON.stringify(rows,null,2));

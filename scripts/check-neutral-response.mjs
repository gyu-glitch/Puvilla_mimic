import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {SignalProcessor}=await import('../src/signals.ts');
const {BodyProcessor}=await import('../src/body.ts');
const {OneEuro}=await import('../src/smoothing.ts');
const {armSessionFixture}=await import('../dev/arm-session-fixture.ts');
const config=JSON.parse(readFileSync('public/config.json'));
const face=(pitch=24,left=.11,right=.14)=>({
 bbox:{x:.4,y:.2,w:.2,h:.25,cx:.5,cy:.325},yaw:0,pitch,roll:0,
 blend:{},eyes:{left,right},mouth:{open:.1,corner:.02}
});
for(const mirror of [true,false]){
 const cfg=structuredClone(config);cfg.camera.mirror=mirror;
 const proc=new SignalProcessor(cfg);let signal;
 const feed=(start,end,fn)=>{for(let t=start;t<end;t+=1000/30)signal=proc.update({faces:[fn(t)],inferenceMs:5},t);};
 // An entry-frame eye outlier must not establish the baseline.
 feed(0,100,t=>face(24,.32,.34));
 feed(100,1500,t=>face(24+Math.sin(t)*.15));
 assert.ok(proc.neutralReady);assert.ok(Math.abs(signal.pitch)<.3);
 assert.ok(signal.blend.__blinkRelLeft<.05&&signal.blend.__blinkRelRight<.05);
 feed(1500,2000,t=>face(36));
 assert.ok(signal.pitch>11&&signal.pitch<13,'real nod remains after calibration');
 feed(2000,2250,t=>face(24,.025,.14));
 assert.ok(signal.blend[mirror?'__blinkRelRight':'__blinkRelLeft']>.9,'wink preserved');
 assert.ok(signal.blend[mirror?'__blinkRelLeft':'__blinkRelRight']<.1);
 feed(2250,2500,t=>face());assert.ok(signal.blend.__blinkRelLeft<.1&&signal.blend.__blinkRelRight<.1);
 proc.recalibrateNeutral();feed(2500,3600,t=>face(12,.08,.09));
 assert.ok(proc.neutralReady);assert.ok(Math.abs(signal.pitch)<.1);
 for(let t=3600;t<5500;t+=50)proc.update({faces:[],inferenceMs:5},t);
 feed(5500,6700,t=>face(-10,.2,.22));assert.ok(Math.abs(signal.pitch)<.1,'new visitor gets own baseline');
}
const cached=new SignalProcessor(config),cachedFace=face();
for(let t=0;t<2000;t+=16)cached.update({faces:[cachedFace],inferenceMs:5},t);
assert.equal(cached.neutralReady,false,'cached inference cannot calibrate');
// Low-amplitude positional noise retains precisely the original filtering.
const a=new OneEuro(1.2,.3,1),b=new OneEuro(1.2,.3,1);
for(let f=0;f<600;f++){const x=.004*Math.sin(f*2.17);assert.equal(a.filter(x,f/60),b.filter(x,f/60,true));}
const result=[];
for(const fps of [15,30,60]){
 const measure=responsive=>{
  const cfg=structuredClone(config);cfg.body.responsiveArms=responsive;
  const proc=new BodyProcessor(cfg),dt=1/fps;let pose,origin,target,renderY,at50=null,at90=null;
  for(let f=0;f<4*fps;f++){
   const t=f*dt,raised=t>=1;
   const raw=armSessionFixture(raised?3:0,true).raw;
   pose=proc.update(raw,true,t*1000);
   if(t<1){origin=pose.wristL[1];renderY=origin;}
   else{
    // Exact stationary endpoint through the same alignment, no temporal filter.
    if(target===undefined){const q=new BodyProcessor(cfg);for(let i=0;i<30;i++)target=q.update(raw,true,i*40).wristL[1];}
    renderY+=(pose.wristL[1]-renderY)*(1-Math.exp(-(responsive?28:18)*dt));
    const progress=(renderY-origin)/(target-origin);
    if(progress>=.5&&at50===null)at50=(t-1+dt)*1000;
    if(progress>=.9&&at90===null)at90=(t-1+dt)*1000;
   }
  }
  return {at50,at90};
 };
 const before=measure(false),after=measure(true);
 assert.ok(after.at90<=before.at90*.65,JSON.stringify({fps,before,after}));
 result.push({fps,before,after});
}
console.log(JSON.stringify({neutral:'PASS: pitch, blink/wink, outlier, cached result, reacquisition',smallNoise:'unchanged',syntheticJointPlusRenderResponseMs:result},null,2));

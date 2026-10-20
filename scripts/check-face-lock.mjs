import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){
    const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);
  }return next(s,c);
}});
const {SignalProcessor}=await import('../src/signals.ts');
const {SignalProcessor:Before}=await import('../dev/signals-before-v38.ts');
const cfg=JSON.parse(readFileSync('public/config.json'));
const face=(x=.5,y=.3,h=.14,w=.17,yaw=0)=>({
 bbox:{cx:x,cy:y,x:x-w/2,y:y-h/2,w,h},yaw,pitch:0,roll:0,blend:{},
 mouth:{open:.1,corner:0},eyes:{left:.2,right:.2}
});
const feed=(p,faces,t,aspect=9/16)=>p.update({faces,inferenceMs:5},t,aspect);
// Portrait lateral motion: 108px at 1080x1920 is less than half a 269px face.
const old=new Before(structuredClone(cfg)),fixed=new SignalProcessor(structuredClone(cfg));
for(const p of [old,fixed])feed(p,[face()],100);
feed(old,[face(.6)],133);feed(fixed,[face(.6)],133);
assert.equal(old.debugFaces[0].locked,false);
assert.equal(fixed.debugFaces[0].locked,true);
assert.equal(fixed.target.cx,.6);
// Equal pixel/face-relative motion must match for landscape and portrait.
for(const aspect of [9/16,3/4,1,4/3,16/9]){
 for(const mirror of [false,true]){
  const c=structuredClone(cfg);c.camera.mirror=mirror;
  const p=new SignalProcessor(c);
  const h=.25*Math.min(1,aspect);
  const f=x=>face(x,.3,h,h*.7/aspect);
  feed(p,[f(.5)],100,aspect);
  feed(p,[f(.5+h*.4/aspect)],133,aspect);
  assert.equal(p.debugFaces[0].locked,true,`aspect ${aspect} mirror ${mirror}`);
 }
}
// Head-box size change and short occlusion followed by moderate movement.
const recovery=new SignalProcessor(structuredClone(cfg));
feed(recovery,[face()],100);
feed(recovery,[face(.51,.3,.10)],133);
assert.equal(recovery.debugFaces[0].locked,true);
feed(recovery,[],300);
assert.equal(feed(recovery,[face(.64,.3,.11)],600).present,true);
assert.equal(recovery.debugFaces[0].locked,true);
// A distant remaining bystander must not steal the lock during its grace time.
const crowd=new SignalProcessor(structuredClone(cfg));
feed(crowd,[face()],100);
feed(crowd,[face(.9,.65,.10)],200);
assert.equal(crowd.target.cx,.5);
assert.equal(crowd.debugFaces[0].locked,false);
// Equally plausible faces: hold, do not select by detector ordering.
for(const reverse of [false,true]){
 const p=new SignalProcessor(structuredClone(cfg));feed(p,[face()],100);
 const faces=[face(.47),face(.53)];if(reverse)faces.reverse();
 feed(p,faces,133);
 assert.equal(p.target.cx,.5);
 assert.equal(p.debugFaces.some(f=>f.locked),false);
}
// Acquisition is still central; maintaining an acquired face tolerates the
// center crossing the band edge while the box still overlaps the band.
const c=structuredClone(cfg);c.camera.mirror=false;c.presence.centerToleranceX=.1;
const edge=new SignalProcessor(c),oldEdge=new Before(c);
let a,b;
for(let t=0;t<6000;t+=1000/30){
 const x=t<1000?.5:Math.min(.62,.5+(t-1000)/5000);
 a=feed(edge,[face(x)],t);b=feed(oldEdge,[face(x)],t);
}
assert.equal(a.near,true);assert.equal(b.near,false);
const fresh=new SignalProcessor(c);
assert.equal(feed(fresh,[face(.62)],100).near,false);
for(let t=6000;t<9000;t+=1000/30)a=feed(edge,[face(.85)],t);
assert.equal(a.near,false,'actual departure must exit');
assert.equal(feed(recovery,[],4000).present,false);
assert.equal(recovery.target,null);
console.log('PASS: portrait motion rejection reproduced; 5 aspects × 2 mirrors, turn/recovery, ambiguous/distant faces, center edge and true loss');

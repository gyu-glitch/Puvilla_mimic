import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const T=await import('three');
const {StandingElbowPlane}=await import('../src/character/standingElbowPlane.ts');
function old(u,f){const angle=Math.min(2.4,u.angleTo(f)),axis=new T.Vector3().crossVectors(u,f);return axis.lengthSq()<1e-6||angle<.02?u.clone():u.clone().applyAxisAngle(axis.normalize(),angle);}
let normalError=0,oldJump=0,newJump=0,releaseJump=0;
for(const side of [-1,1]){
 const plane=new StandingElbowPlane(),upper=new T.Vector3(side,0,0),axis=new T.Vector3(0,0,side);let a=null,b=null;
 for(let i=0;i<360;i++){
  const fore=upper.clone().applyAxisAngle(axis,Math.PI+Math.sin(i*.05)*.02),before=old(upper,fore),after=plane.direction(upper,fore,side,1,1/60);
  if(a){oldJump=Math.max(oldJump,a.angleTo(before));newJump=Math.max(newJump,b.angleTo(after));}a=before;b=after;
  assert.ok(Math.abs(upper.angleTo(after)-2.4)<1e-7);assert.ok(Math.abs(after.length()-1)<1e-7);
 }
 // After the occluded/reversed input, recover to the opposite valid bend plane.
 for(let i=0;i<300;i++){
  const bend=3.12-1.7*Math.min(1,i/120),fore=upper.clone().applyAxisAngle(axis,-bend),after=plane.direction(upper,fore,side,1,1/60);
  releaseJump=Math.max(releaseJump,b.angleTo(after));b=after;
  if(i>240)assert.ok(after.angleTo(old(upper,fore))<1e-7,'did not release held bend plane');
 }
 plane.reset();
 for(let i=0;i<2000;i++){
  const u=new T.Vector3(side*Math.cos(i*.03),Math.sin(i*.03),.3*Math.sin(i*.07)).normalize(),n=new T.Vector3().crossVectors(u,new T.Vector3(0,0,1)).normalize();
  const f=u.clone().applyAxisAngle(n,1.33*(1+Math.sin(i*.01))),after=plane.direction(u,f,side,1,1/60);
  normalError=Math.max(normalError,after.angleTo(old(u,f)));
 }
}
console.log({oldJump,newJump,releaseJump,normalError});
assert.ok(newJump<1e-6);assert.ok(releaseJump<.09);assert.ok(normalError<1e-7);

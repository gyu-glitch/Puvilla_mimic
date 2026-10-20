import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {standingUpperDirection as map,standingAzimuth} from '../src/character/standingArmPose.ts';
let worstStep=0,before=0,after=0;
for(const side of [-1,1]){
 const rest=new Vector3(side*.58,-.81,-.02).normalize();
 const a=new Vector3(-side,-.07,.001).normalize(),b=new Vector3(-side,-.07,-.001).normalize();
 before=Math.max(before,map(side,rest,a,3,false).angleTo(map(side,rest,b,3,false)));
 after=Math.max(after,map(side,rest,a,3).angleTo(map(side,rest,b,3)));
 assert.ok(map(side,rest,new Vector3(0,-1,0),3).distanceTo(rest)<1e-10);
 for(const theta of [.1,.4,1.5,2.6]){
  let previous;
  for(let i=0;i<=4000;i++){
   const phi=-Math.PI+2*Math.PI*i/4000;
   const human=new Vector3(side*Math.sin(theta)*Math.cos(phi),-Math.cos(theta),Math.sin(theta)*Math.sin(phi));
   const out=map(side,rest,human,3);
   assert.ok(Math.abs(out.length()-1)<1e-10);
   if(phi>=-.5&&phi<=2)assert.ok(out.distanceTo(map(side,rest,human,3,false))<1e-10,'supported input changed');
   if(previous)worstStep=Math.max(worstStep,out.angleTo(previous));previous=out;
   const mirror=map(-side,new Vector3(-rest.x,rest.y,rest.z),new Vector3(-human.x,human.y,human.z),3);
   assert.ok(mirror.distanceTo(new Vector3(-out.x,out.y,out.z))<1e-10);
  }
 }
}
assert.ok(before>2 && after<.003,'cross-body depth noise not fixed');
assert.ok(worstStep<.003,'limited azimuth has a discontinuity');
for(let phi=-20;phi<20;phi+=.01){
 const a=standingAzimuth(phi),b=standingAzimuth(phi+Math.PI*2);
 assert.ok(a>=-.5-1e-10&&a<=2+1e-10&&Math.abs(a-b)<1e-10);
}
console.log({crossBodyBeforeDeg:before*180/Math.PI,crossBodyAfterDeg:after*180/Math.PI,wholeCircleMaxStepDeg:worstStep*180/Math.PI});

import {Quaternion,Vector3} from 'three';
import {RoundedElbowFrame} from './standingBend';
import {preserveStandingLift,preserveLiftDirection} from './standingLiftTorso';

// Conservative proxy around the source's rounded belly, inflated by the paw
// thickness. It constrains the arm joints, never the torso or paw geometry.
const center=new Vector3(0,69,.5),radius=new Vector3(46,60,47);
const chestPivot=new Vector3(0,88,0);
const samples=[.78,.9,1,1.1];
export function standingTorsoClearance(shoulder:Vector3,length:number,upper:Vector3,fore:Vector3,chest?:Quaternion){
 const curve=new RoundedElbowFrame(length,upper,fore),p=new Vector3(),gradient=new Vector3();
 let distance=Infinity;
 for(const t of samples){
  curve.center(t*length,p).add(shoulder);
  // The belly follows the spine while arms follow the chest. Undo that
  // relative frame difference before measuring against the source belly.
  if(chest)p.sub(chestPivot).applyQuaternion(chest).add(chestPivot);
  p.sub(center);
  const rho=Math.hypot(p.x/radius.x,p.y/radius.y,p.z/radius.z);
  if(rho<distance){distance=rho;gradient.set(p.x/(radius.x*radius.x),p.y/(radius.y*radius.y),p.z/(radius.z*radius.z)).normalize();}
 }
 if(chest)gradient.applyQuaternion(chest.clone().invert());
 return {distance,gradient};
}

export function clearStandingTorso(shoulder:Vector3,length:number,restAxis:Vector3,upperQ:Quaternion,foreQ:Quaternion,chest?:Quaternion,lift=false):number{
 const upper=restAxis.clone().applyQuaternion(upperQ),desired=restAxis.clone().applyQuaternion(foreQ).applyQuaternion(upperQ);
 const before=standingTorsoClearance(shoulder,length,upper,desired,chest).distance;
 if(before>=1.015)return 0;
 // Follow one continuous front/outward arc instead of choosing between two
 // closest exits from the belly's interior. The latter flips near its center.
 const front=new Vector3(Math.sign(shoulder.x)*.15,0,1).normalize();
 if(chest)front.applyQuaternion(chest.clone().invert());
 if(lift)preserveLiftDirection(front,desired);
 const rotation=new Quaternion().setFromUnitVectors(desired,front),angle=desired.angleTo(front);
 const limit=Math.min(1,1.5/Math.max(1e-8,angle)),fore=new Vector3(),q=new Quaternion();
 const at=(t:number)=>{q.identity().slerp(rotation,t);return fore.copy(desired).applyQuaternion(q);};
 let lo=0,hi=limit,found=false;
 for(let i=1;i<=16;i++){
  const t=limit*i/16;
  if(standingTorsoClearance(shoulder,length,upper,at(t),chest).distance>=1.015){hi=t;lo=limit*(i-1)/16;found=true;break;}
 }
 if(found)for(let i=0;i<12;i++){
  const mid=(lo+hi)/2;
  if(standingTorsoClearance(shoulder,length,upper,at(mid),chest).distance>=1.015)hi=mid;else lo=mid;
 }
 at(hi);
 if(standingTorsoClearance(shoulder,length,upper,fore,chest).distance<before)return 0;
 foreQ.setFromUnitVectors(restAxis,fore.applyQuaternion(upperQ.clone().invert()));
 return angle*hi;
}

/** Follow the last feasible direction while a hand slides around the belly.
 * A fresh closest-exit solve each frame can switch sides inside the body. */
export class StandingTorsoContact {
 private previous:Vector3|null=null;
 private hadContact=false;
 reset(){this.previous=null;this.hadContact=false;}
 solveLift(shoulder:Vector3,length:number,restAxis:Vector3,upperQ:Quaternion,foreQ:Quaternion,dt:number,chest?:Quaternion){
  const desired=restAxis.clone().applyQuaternion(foreQ).applyQuaternion(upperQ);
  this.solve(shoulder,length,restAxis,upperQ,foreQ,dt,chest,true);
  preserveStandingLift(restAxis,upperQ,foreQ,desired);
  this.previous=restAxis.clone().applyQuaternion(foreQ).applyQuaternion(upperQ);
 }
 solve(shoulder:Vector3,length:number,restAxis:Vector3,upperQ:Quaternion,foreQ:Quaternion,dt:number,chest?:Quaternion,lift=false){
  const upper=restAxis.clone().applyQuaternion(upperQ),desired=restAxis.clone().applyQuaternion(foreQ).applyQuaternion(upperQ);
  const distance=(f:Vector3)=>standingTorsoClearance(shoulder,length,upper,f,chest).distance;
  const rotation=new Quaternion(),q=new Quaternion(),candidate=new Vector3();
  if(!this.previous){
   this.hadContact=distance(desired)<1.015;
   clearStandingTorso(shoulder,length,restAxis,upperQ,foreQ,chest,lift);
   this.previous=restAxis.clone().applyQuaternion(foreQ).applyQuaternion(upperQ);return;
  }
  const previous=this.previous;
  const step=3.6*Math.min(.05,Math.max(0,dt)),angle=previous.angleTo(desired);
  rotation.setFromUnitVectors(previous,desired);
  // Preserve free movement when the whole short arc is outside the body.
  let free=true;
  for(const t of [0,.25,.5,.75,1])if(distance(candidate.copy(previous).applyQuaternion(q.identity().slerp(rotation,t)))<1.015){free=false;break;}
  if(free){
   if(this.hadContact&&angle>step){
    previous.applyQuaternion(q.identity().slerp(rotation,step/angle));
    if(lift)preserveLiftDirection(previous,desired);
    foreQ.setFromUnitVectors(restAxis,candidate.copy(previous).applyQuaternion(upperQ.clone().invert()));return;
   }
   previous.copy(desired);this.hadContact=false;return;
  }
  this.hadContact=true;
  candidate.copy(previous).applyQuaternion(q.identity().slerp(rotation,Math.min(1,step/Math.max(angle,1e-8))));
  if(lift)preserveLiftDirection(candidate,desired);
  for(let i=0;i<12;i++){
   const {distance:rho,gradient}=standingTorsoClearance(shoulder,length,upper,candidate,chest);
   if(rho>=1.015)break;
   gradient.addScaledVector(candidate,-gradient.dot(candidate));
   if(gradient.lengthSq()<1e-8)break;
   candidate.addScaledVector(gradient.normalize(),Math.min(.08,(1.015-rho)*.8)).normalize();
   if(lift)preserveLiftDirection(candidate,desired);
  }
  const correction=previous.angleTo(candidate);
  if(correction>step){
   rotation.setFromUnitVectors(previous,candidate);
   candidate.copy(previous).applyQuaternion(q.identity().slerp(rotation,step/correction));
  }
  if(lift)preserveLiftDirection(candidate,desired);
  previous.copy(candidate);
  foreQ.setFromUnitVectors(restAxis,candidate.applyQuaternion(upperQ.clone().invert()));
 }
}

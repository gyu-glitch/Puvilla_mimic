import {Quaternion,Vector3} from 'three';
import {RoundedElbowFrame} from './standingBend';
import {standingTorsoClearance} from './standingTorsoClearance';
import {standingHeadClearance} from './standingHeadClearance';

export interface PawContactArm {
 shoulder:Vector3;
 length:number;
 rest:Vector3;
 upper:Quaternion;
 fore:Quaternion;
}

export function standingPawCenter(arm:PawContactArm,out=new Vector3()):Vector3 {
 const upper=arm.rest.clone().applyQuaternion(arm.upper);
 const fore=arm.rest.clone().applyQuaternion(arm.fore).applyQuaternion(arm.upper);
 return new RoundedElbowFrame(arm.length,upper,fore).center(arm.length,out).add(arm.shoulder);
}

/** Separate the original plush paws by rotating forearms, preserving their
 * dimensions. A shoulder-side contact normal remains stable when coincident
 * inputs have already put one hand through the other. */
export function separateStandingPaws(arms:PawContactArm[],chest:Quaternion,head:Quaternion):number {
 if(arms.length!==2)return 0;
 const centers=arms.map(a=>standingPawCenter(a)),delta=new Vector3();
 const spacing=18;
 if(centers[0].distanceTo(centers[1])>=spacing)return 0;
 const normal=arms[0].shoulder.clone().sub(arms[1].shoulder).normalize();
 const directions=arms.map(a=>a.rest.clone().applyQuaternion(a.fore).applyQuaternion(a.upper));
 const uppers=arms.map(a=>a.rest.clone().applyQuaternion(a.upper));
 const originals=directions.map(d=>d.clone());
 const limits=arms.map((a,i)=>({body:standingTorsoClearance(a.shoulder,a.length,uppers[i],directions[i],chest).distance,head:standingHeadClearance(a.shoulder,a.length,uppers[i],directions[i],head).distance}));
 for(let iteration=0;iteration<18;iteration++){
  delta.subVectors(centers[0],centers[1]);
  if(delta.length()>=spacing)break;
  const gap=delta.dot(normal),perpendicularSq=Math.max(0,delta.lengthSq()-gap*gap);
  const required=Math.sqrt(Math.max(0,spacing*spacing-perpendicularSq));
  const correction=required-gap;
  if(correction<=.005)break;
  let changed=false;
  for(let i=0;i<2;i++){
   const a=arms[i],direction=directions[i],gradient=normal.clone().multiplyScalar(i===0?1:-1);
   gradient.addScaledVector(direction,-gradient.dot(direction));
   if(gradient.lengthSq()<1e-6)continue;
   const candidate=direction.clone().addScaledVector(gradient.normalize(),Math.min(.08,correction/a.length*.9)).normalize();
   if(originals[i].angleTo(candidate)>.7)continue;
   // Do not solve a hand-hand contact by pushing either hand back into the
   // already-protected torso/head. These are the same conservative proxies.
   if(standingTorsoClearance(a.shoulder,a.length,uppers[i],candidate,chest).distance<Math.min(1.005,limits[i].body)-1e-5)continue;
   if(standingHeadClearance(a.shoulder,a.length,uppers[i],candidate,head).distance<Math.min(1.005,limits[i].head)-1e-5)continue;
   direction.copy(candidate);
   a.fore.setFromUnitVectors(a.rest,candidate.applyQuaternion(a.upper.clone().invert()));
   standingPawCenter(a,centers[i]);changed=true;
  }
  if(!changed)break;
 }
 return Math.max(...directions.map((d,i)=>d.angleTo(originals[i])));
}

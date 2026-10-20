import {Vector3} from 'three';
import {standingWavePose} from '../src/standingWave';
import type {BodyPose,V3} from '../src/body';

/** Lift, small forearm movements around the automatic palm boundary, greet,
 * lower. Missing finger landmarks isolate the automatic front-palm fallback. */
export function armFrontBoundaryFixture(t:number):BodyPose{
 const p=((t%20)+20)%20;
 const pose:BodyPose={hipL:[.1,0,0],hipR:[-.1,0,0],armL:1,armR:1,hips:1,
  shoulderL:[0,0,0],elbowL:[0,0,0],wristL:[0,0,0],shoulderR:[0,0,0],elbowR:[0,0,0],wristR:[0,0,0]};
 const ease=(v:number)=>{const x=Math.max(0,Math.min(1,v));return x*x*(3-2*x);};
 for(const side of [1,-1] as const){
  const name=side>0?'L':'R',s=new Vector3(side*.18,.48,0);
  const q=.10+.025*Math.sin((p-3)*Math.PI*1.5);
  const u=new Vector3(side*.8,.15,.3).normalize(),f=new Vector3(0,Math.sqrt(q),Math.sqrt(1-q));
  const e=s.clone().addScaledVector(u,.27),w=e.clone().addScaledVector(f,.25);
  const rest=standingWavePose(0,0,side),greet=standingWavePose(p,1,side);
  pose[`shoulder${name}`]=s.toArray();
  for(const joint of ['elbow','wrist'] as const){
   const key=`${joint}${name}` as const;
   let v=new Vector3(...rest[key]).lerp(joint==='elbow'?e:w,ease(p/3));
   if(p>=12)v.lerp(new Vector3(...greet[key]),ease((p-12)/2));
   if(p>=16)v.lerp(new Vector3(...rest[key]),ease((p-16)/2));
   pose[key]=v.toArray() as V3;
  }
 }
 return pose;
}

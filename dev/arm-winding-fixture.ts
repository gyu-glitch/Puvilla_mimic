import {Vector3} from 'three';
import {standingWavePose} from '../src/standingWave';
import type {BodyPose,V3} from '../src/body';

/** Repeatable orientation history, then an ordinary greeting and lowering.
 * Palms stay in the image plane, as in the v33 camera input path. */
export function armWindingFixture(t:number):BodyPose{
 const p=((t%36)+36)%36;
 const pose:BodyPose={hipL:[.1,0,0],hipR:[-.1,0,0],armL:1,armR:1,hips:1,
  shoulderL:[0,0,0],elbowL:[0,0,0],wristL:[0,0,0],shoulderR:[0,0,0],elbowR:[0,0,0],wristR:[0,0,0]};
 const polar=(side:number,a:number,b:number)=>new Vector3(side*Math.sin(a)*Math.cos(b),-Math.cos(a),Math.sin(a)*Math.sin(b));
 const history=Math.min(p,22),theta=1.6+1.5*Math.sin(history*.7),phi=1.4*Math.sin(history*.4),bend=1.1+1.1*Math.sin(history*1.1);
 for(const side of [1,-1] as const){
  const name=side>0?'L':'R',s=new Vector3(side*.18,.48,0),u=polar(side,theta,phi),
   f=u.clone().applyAxisAngle(new Vector3(0,0,side),bend),e=s.clone().addScaledVector(u,.27);
  pose[`shoulder${name}`]=s.toArray();pose[`elbow${name}`]=e.toArray();pose[`wrist${name}`]=e.clone().addScaledVector(f,.25).toArray();
  pose[`handAcross${name}`]=[-side,0,0];pose[`handDirection${name}`]=[0,1,0];
  if(p>=22){
   const lift=p<30?1:Math.max(0,1-(p-30)/3),greet=standingWavePose(0,lift,side);
   let blend=Math.min(1,(p-22)/2);blend=blend*blend*(3-2*blend);
   for(const joint of ['elbow','wrist'] as const){
    const key=`${joint}${name}` as const;
    pose[key]=new Vector3(...pose[key]).lerp(new Vector3(...greet[key]),blend).toArray() as V3;
   }
  }
 }
 return pose;
}

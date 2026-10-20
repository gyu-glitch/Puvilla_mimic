import {Quaternion,Vector3} from 'three';
import {RoundedElbowFrame} from '../src/character/standingBend';

/** Raise the elbow of a greeting to match palm height relative to the face.
 * Keep forearm direction, limb length and cross-section. No correction below
 * shoulder height, and no lowering of a higher observed gesture. */
export function matchStandingFaceHeight(
 rest:Vector3,upper:Quaternion,fore:Quaternion,length:number,
 faceAboveShoulder:number,relativeHeight:number,spread:number,
){
 if(!Number.isFinite(relativeHeight)||relativeHeight<=0)return;
 const u=rest.clone().applyQuaternion(upper),f=rest.clone().applyQuaternion(fore).applyQuaternion(upper);
 if(f.y<=u.y+.01)return;
 const height=(d:Vector3)=>new RoundedElbowFrame(length,d,f,spread).center(length*.9613,new Vector3()).y;
 const start=height(u),target=faceAboveShoulder*relativeHeight;
 if(target<=start)return;
 const swing=new Quaternion().setFromUnitVectors(u,f),id=new Quaternion();
 const at=(t:number)=>u.clone().applyQuaternion(id.clone().slerp(swing,t));
 // Continuous onset when the palm emerges above the shoulder.
 const a=Math.min(1,relativeHeight/.3),weight=a*a*(3-2*a);
 const goal=start+(Math.min(target,height(f))-start)*weight;
 if(goal<=start)return;
 let lo=0,hi=1;
 for(let i=0;i<18;i++){const mid=(lo+hi)*.5;if(height(at(mid))<goal)lo=mid;else hi=mid;}
 upper.setFromUnitVectors(rest,at((lo+hi)*.5));
 fore.setFromUnitVectors(rest,f.applyQuaternion(upper.clone().invert()));
}

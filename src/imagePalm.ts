import {Vector3} from 'three';
import type {RawPose} from './poseTracker';

/** Camera-plane greeting mode. Pose's three hand landmarks cannot reliably
 * distinguish palm/back depth; do not turn that uncertainty into wrist roll.
 * Deliberate depth-axis palm turns are not represented in this mode. */
export function imagePalm(raw:RawPose,wrist:number,index:number,pinky:number,mirror:boolean,minVisibility=.65){
 const ids=[wrist,index,pinky],im=raw.image;
 if(!im||ids.some(i=>!im[i]||!raw.world[i]||
   !Number.isFinite(raw.world[i].visibility)||raw.world[i].visibility<minVisibility||![im[i].x,im[i].y].every(Number.isFinite)||
   im[i].x<0||im[i].x>1||im[i].y<0||im[i].y>1))return null;
 const aspect=raw.imageAspect??1;
 if(!Number.isFinite(aspect)||aspect<=0)return null;
 const point=(i:number)=>new Vector3(im[i].x*aspect*(mirror?-1:1),-im[i].y,0);
 const a=point(index),b=point(pinky),w=point(wrist);
 const across=a.clone().sub(b),forward=a.clone().add(b).multiplyScalar(.5).sub(w);
 if(across.length()<.008||forward.length()<.01)return null;
 across.normalize();forward.normalize();
 if(Math.abs(across.clone().cross(forward).z)<.25)return null;
 return {across,forward};
}

import { Vector3 } from "three";
import type { RawPose } from "./poseTracker";

/** Use measured image angles when the torso is frontal. A nearly full-length
 * projected limb cannot simultaneously point strongly into/out of the screen.
 * Both sides use the same shoulder scale and segment length estimate. */
export function alignedCameraArm(raw: RawPose, ids: readonly number[], mirror: boolean): {upper:Vector3;fore:Vector3} | null {
  const im=raw.image, aspect=raw.imageAspect;
  if (!im || !aspect || !Number.isFinite(aspect) || aspect<=0) return null;
  const w=raw.world, vector=(a:number,b:number)=>new Vector3(
    (w[b].x-w[a].x)*(mirror?-1:1),w[a].y-w[b].y,w[a].z-w[b].z);
  if (![11,12,13,14,15,16].every(i=>w[i]&&im[i]&&
    [w[i].x,w[i].y,w[i].z,im[i].x,im[i].y].every(Number.isFinite))) return null;
  const shoulders=vector(11,12), width=shoulders.length();
  const imageLength=(a:number,b:number)=>Math.hypot((im[b].x-im[a].x)*aspect,im[b].y-im[a].y);
  const imageWidth=imageLength(11,12);
  if (width<.15 || imageWidth<.08 || Math.abs(shoulders.z)/width>.35) return null;
  const smooth=(a:number,b:number,x:number)=>{
    const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);
  };
  // Fade to the world estimate before crossing a validity boundary. Otherwise
  // millimetres of shoulder noise can switch the entire arm between two poses.
  const weight=smooth(.15,.20,width)*smooth(.08,.12,imageWidth)*
    (1-smooth(.18,.35,Math.abs(shoulders.z)/width));
  const sharedLength=(pairs:number[][])=>{
    let sum=0,total=0;
    for(const [a,b] of pairs){
      const length=vector(a,b).length();
      const confidence=smooth(.35,.65,Math.min(w[a].visibility,w[b].visibility))*
        smooth(.08,.12,length)*(1-smooth(.60,.70,length));
      sum+=length*confidence;total+=confidence;
    }
    return total?sum/total:0;
  };
  const upperLength=sharedLength([[11,13],[12,14]]),foreLength=sharedLength([[13,15],[14,16]]);
  const align=(a:number,b:number,length:number)=>{
    const observed=vector(a,b).normalize(), projected=imageLength(a,b);
    if (projected<.02 || !length) return observed;
    const fraction=Math.min(1,projected*width/imageWidth/(length*.92));
    const depthLimit=Math.sqrt(Math.max(0,1-fraction*fraction));
    const z=Math.max(-depthLimit,Math.min(depthLimit,observed.z));
    const planar=Math.sqrt(Math.max(0,1-z*z));
    const corrected=new Vector3((im[b].x-im[a].x)*aspect*(mirror?-1:1)/projected*planar,
      (im[a].y-im[b].y)/projected*planar,z);
    return observed.lerp(corrected,weight*smooth(.02,.04,projected)).normalize();
  };
  return {upper:align(ids[0],ids[1],upperLength),fore:align(ids[1],ids[2],foreLength)};
}

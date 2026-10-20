import { Vector3 } from "three";
import type { RawPose } from "../src/poseTracker";

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
  const sharedLength=(pairs:number[][])=>{
    const lengths=pairs.filter(([a,b])=>Math.min(w[a].visibility,w[b].visibility)>=.5)
      .map(([a,b])=>vector(a,b).length()).filter(l=>l>=.10&&l<=.65);
    return lengths.length?lengths.reduce((a,b)=>a+b,0)/lengths.length:0;
  };
  const upperLength=sharedLength([[11,13],[12,14]]),foreLength=sharedLength([[13,15],[14,16]]);
  const align=(a:number,b:number,length:number)=>{
    const observed=vector(a,b).normalize(), projected=imageLength(a,b);
    if (projected<.02 || !length) return observed;
    const fraction=Math.min(1,projected*width/imageWidth/(length*.92));
    const depthLimit=Math.sqrt(Math.max(0,1-fraction*fraction));
    const z=Math.max(-depthLimit,Math.min(depthLimit,observed.z));
    const planar=Math.sqrt(Math.max(0,1-z*z));
    return new Vector3((im[b].x-im[a].x)*aspect*(mirror?-1:1)/projected*planar,
      (im[a].y-im[b].y)/projected*planar,z);
  };
  return {upper:align(ids[0],ids[1],upperLength),fore:align(ids[1],ids[2],foreLength)};
}

import {Vector3} from "three";
import type {RawPose} from "./poseTracker";

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** One camera scale and hand-size reference for both sides. Keep each hand's
 * own measured image direction; a full-width palm cannot also be edge-on. */
export function alignedCameraHand(raw:RawPose, right:boolean, mirror:boolean):{across:Vector3;forward:Vector3}|null {
 const w=raw.world,im=raw.image,aspect=raw.imageAspect;
 if(!im||!aspect||!Number.isFinite(aspect)||aspect<=0)return null;
 const valid=(id:number)=>w[id]&&im[id]&&[w[id].x,w[id].y,w[id].z,im[id].x,im[id].y,w[id].visibility].every(Number.isFinite);
 if(![11,12].every(valid))return null;
 const shoulders=new Vector3(w[12].x-w[11].x,w[12].y-w[11].y,w[12].z-w[11].z);
 const width=shoulders.length(),imageWidth=Math.hypot((im[12].x-im[11].x)*aspect,im[12].y-im[11].y);
 if(width<.15||imageWidth<.08||Math.abs(shoulders.z)/width>.35)return null;
 const cameraWeight=smooth(.15,.20,width)*smooth(.08,.12,imageWidth)*(1-smooth(.18,.35,Math.abs(shoulders.z)/width));
 const hands=[[15,19,17],[16,20,18]].map(ids=>{
  if(!ids.every(id=>valid(id)&&w[id].visibility>=.65&&im[id].x>=0&&im[id].x<=1&&im[id].y>=0&&im[id].y<=1))return null;
  const [wr,ix,pk]=ids;
  const across=new Vector3((w[ix].x-w[pk].x)*(mirror?-1:1),w[pk].y-w[ix].y,w[pk].z-w[ix].z);
  const forward=new Vector3(((w[ix].x+w[pk].x)*.5-w[wr].x)*(mirror?-1:1),w[wr].y-(w[ix].y+w[pk].y)*.5,w[wr].z-(w[ix].z+w[pk].z)*.5);
  const span=across.length(),reach=forward.length();
  if(span<.015||span>.20||reach<.025||reach>.18)return null;
  const quality=smooth(.65,.85,Math.min(...ids.map(id=>w[id].visibility)))*
   smooth(.015,.025,span)*(1-smooth(.16,.20,span))*smooth(.025,.04,reach)*(1-smooth(.15,.18,reach));
  return {ids,across,forward,span,reach,quality};
 });
 // With only one hand there is no independent size reference. Do not invent it.
 if(!hands[0]||!hands[1])return null;
 const weight=cameraWeight*Math.min(hands[0].quality,hands[1].quality);
 const hand=hands[right?1:0]!,[wr,ix,pk]=hand.ids;
 // Depth hallucination inflates world length; the shorter reliable side is a
 // conservative shared reference. The two hands keep independent orientations.
 const span=Math.min(hands[0].span,hands[1].span),reach=Math.min(hands[0].reach,hands[1].reach);
 const align=(observed:Vector3,dx:number,dy:number,length:number)=>{
  observed.normalize();const projected=Math.hypot(dx*aspect,dy);
  if(projected<.005)return observed;
  const fraction=Math.min(1,projected*width/imageWidth/length);
  const zLimit=Math.sqrt(Math.max(0,1-fraction*fraction)),z=Math.max(-zLimit,Math.min(zLimit,observed.z));
  const planar=Math.sqrt(Math.max(0,1-z*z));
  const corrected=new Vector3(dx*aspect*(mirror?-1:1)/projected*planar,-dy/projected*planar,z);
  return observed.lerp(corrected,weight*smooth(.005,.015,projected)).normalize();
 };
 return {
  across:align(hand.across,im[ix].x-im[pk].x,im[ix].y-im[pk].y,span),
  forward:align(hand.forward,(im[ix].x+im[pk].x)*.5-im[wr].x,(im[ix].y+im[pk].y)*.5-im[wr].y,reach),
 };
}

import { Matrix4, Quaternion, Vector3 } from "three";
import type { BodyPose } from "../body";

/** Missing hips gradually reduce pitch/roll evidence instead of toggling the
 * entire torso at one visibility threshold. Shoulder yaw remains observable. */
export function standingTorso(pose:BodyPose, minVisibility:number, out:Quaternion, legacy=false):void {
  const right=new Vector3(...pose.shoulderL).sub(new Vector3(...pose.shoulderR));
  const up=new Vector3(0,1,0);
  const observed=new Vector3(...pose.shoulderL).add(new Vector3(...pose.shoulderR)).multiplyScalar(.5)
    .sub(new Vector3(...pose.hipL).add(new Vector3(...pose.hipR)).multiplyScalar(.5));
  const t=Math.max(0,Math.min(1,(pose.hips-minVisibility)/.3));
  const weight=legacy?(pose.hips>=minVisibility?1:0):t*t*(3-2*t);
  if(observed.lengthSq()>.04 && Number.isFinite(observed.lengthSq()))up.lerp(observed.normalize(),weight).normalize();
  right.addScaledVector(up,-right.dot(up));
  if(right.lengthSq()<1e-8){out.identity();return;}
  right.normalize();
  const fwd=new Vector3().crossVectors(right,up);
  out.setFromRotationMatrix(new Matrix4().makeBasis(right,up,fwd));
}

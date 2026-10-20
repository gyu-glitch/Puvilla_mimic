import {Quaternion,Vector3} from 'three';

/** Signed roll relative to the posed model's palm, not a fixed screen axis.
 * The source paw's broad axis lies along Z. Its orientation must travel through
 * both arm joints before comparing it to the observed index-to-pinky span. */
export function standingPawRoll(
 rest:Vector3,upper:Quaternion,fore:Quaternion,baseRoll:number,
 humanFore:Vector3,across:Vector3,
):number|null {
 const direction=rest.clone().applyQuaternion(fore).applyQuaternion(upper);
 const reference=new Vector3(0,0,1).addScaledVector(rest,-rest.z);
 if(reference.lengthSq()<.05||humanFore.lengthSq()<.5||across.lengthSq()<.05)return null;
 reference.normalize().applyAxisAngle(rest,baseRoll).applyQuaternion(fore).applyQuaternion(upper);
 const tracked=across.clone().normalize()
  .applyQuaternion(new Quaternion().setFromUnitVectors(humanFore,direction));
 tracked.addScaledVector(direction,-tracked.dot(direction));
 reference.addScaledVector(direction,-reference.dot(direction));
 if(tracked.lengthSq()<.10||reference.lengthSq()<.10)return null;
 tracked.normalize();reference.normalize();
 return Math.atan2(direction.dot(reference.clone().cross(tracked)),reference.dot(tracked));
}

/** Face the paw toward the viewer without inheriting a twist from the elbow's
 * swing plane. Near a camera-facing forearm this direction is indeterminate;
 * retain the ordinary fallback there instead of normalizing a tiny vector. */
export function standingFrontPawRoll(rest:Vector3,upper:Quaternion,fore:Quaternion,side:1|-1,fallback:number):number {
 const direction=rest.clone().applyQuaternion(fore).applyQuaternion(upper);
 const across=direction.clone().cross(new Vector3(0,0,1)).multiplyScalar(-side);
 if(across.lengthSq()<.10)return fallback;
 const offset=standingPawRoll(rest,upper,fore,fallback,direction,across);
 return offset===null?fallback:fallback+offset;
}

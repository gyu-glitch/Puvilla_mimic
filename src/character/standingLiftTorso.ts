import {Quaternion,Vector3} from 'three';

/** Body protection may lift a buried forearm outward, but may never lower an
 * observed lift. Upper-arm rotation is not touched. */
export function preserveStandingLift(rest:Vector3,upperQ:Quaternion,foreQ:Quaternion,observed:Vector3):void {
 const actual=rest.clone().applyQuaternion(foreQ).applyQuaternion(upperQ);
 preserveLiftDirection(actual,observed);
 foreQ.setFromUnitVectors(rest,actual.applyQuaternion(upperQ.clone().invert()));
}
export function preserveLiftDirection(actual:Vector3,observed:Vector3):void{
 if(actual.y>=observed.y-1e-8)return;
 const horizontal=Math.hypot(actual.x,actual.z),radius=Math.sqrt(Math.max(0,1-observed.y*observed.y));
 if(horizontal<1e-8)actual.copy(observed);
 else actual.set(actual.x*radius/horizontal,observed.y,actual.z*radius/horizontal);
}

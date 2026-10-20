import {Quaternion,Vector3} from 'three';
import {roundedElbowCenter} from './standingBend';

const pivot=new Vector3(0,126,2);
// Measured from the standing source head, excluding the ears. The inflated
// ellipsoid includes the plush forearm radius; it never modifies head vertices.
const center=new Vector3(0,144,17),radius=new Vector3(31,31,38);
const samples=[.5,.6,.7,.8,.9,1,1.1];

export function standingHeadClearance(shoulder:Vector3,length:number,upper:Vector3,fore:Vector3,head:Quaternion){
  const inv=head.clone().invert(),c=center.clone().sub(pivot).applyQuaternion(head).add(pivot);
  let distance=Infinity;const gradient=new Vector3();
  for(const t of samples){
    const p=roundedElbowCenter(t*length,length,upper,fore).add(shoulder).sub(c).applyQuaternion(inv);
    const rho=Math.hypot(p.x/radius.x,p.y/radius.y,p.z/radius.z);
    if(rho<distance){distance=rho;gradient.set(p.x/(radius.x*radius.x),p.y/(radius.y*radius.y),p.z/(radius.z*radius.z)).applyQuaternion(head).normalize();}
  }
  return {distance,gradient};
}

/** Rotate only the forearm away from a head intersection. Segment lengths,
 * the shoulder location and the source paw shape remain unchanged. */
export function clearStandingForearm(shoulder:Vector3,length:number,restAxis:Vector3,upperQ:Quaternion,foreQ:Quaternion,headQ:Quaternion):number{
  const upper=restAxis.clone().applyQuaternion(upperQ),fore=restAxis.clone().applyQuaternion(foreQ).applyQuaternion(upperQ),desired=fore.clone();
  for(let i=0;i<18;i++){
    const {distance,gradient}=standingHeadClearance(shoulder,length,upper,fore,headQ);
    if(distance>=1.015)break;
    gradient.addScaledVector(fore,-gradient.dot(fore));
    if(gradient.lengthSq()<1e-8){gradient.set(Math.sign(shoulder.x)||1,0,0).addScaledVector(fore,-(Math.sign(shoulder.x)||1)*fore.x);}
    if(gradient.lengthSq()<1e-8)break;
    const step=Math.min(.12,(1.015-distance)*.65);
    fore.addScaledVector(gradient.normalize(),step).normalize();
    if(desired.angleTo(fore)>.65){fore.applyQuaternion(new Quaternion().setFromUnitVectors(fore,desired).slerp(new Quaternion(),.65/desired.angleTo(fore)));break;}
  }
  const angle=desired.angleTo(fore);
  if(angle>1e-7)foreQ.setFromUnitVectors(restAxis,fore.applyQuaternion(upperQ.clone().invert()));
  return angle;
}

/** The smoothed joint can lag behind a moving head. Limit this final contact
 * correction by angular speed so it cannot produce a one-frame snap. */
export function resolveStandingHeadContact(shoulder:Vector3,length:number,restAxis:Vector3,upperQ:Quaternion,foreQ:Quaternion,headQ:Quaternion,dt:number):void{
  const contact=foreQ.clone();clearStandingForearm(shoulder,length,restAxis,upperQ,contact,headQ);
  foreQ.rotateTowards(contact,3.6*Math.min(.05,Math.max(0,dt)));
}

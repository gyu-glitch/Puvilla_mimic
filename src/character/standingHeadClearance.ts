import {Quaternion,Vector3} from 'three';
import {RoundedElbowFrame} from './standingBend';

const pivot=new Vector3(0,126,2);
// Measured from the standing source head, excluding the ears. The inflated
// ellipsoid includes the plush forearm radius; it never modifies head vertices.
const center=new Vector3(0,144,17),radius=new Vector3(31,31,38);
const samples=[.5,.6,.7,.8,.9,1,1.1];
const wholeSamples=[.25,.35,.45,.55,.7,.9,1,1.1];

export function standingHeadClearance(shoulder:Vector3,length:number,upper:Vector3,fore:Vector3,head:Quaternion,whole=false){
  const inv=head.clone().invert(),c=center.clone().sub(pivot).applyQuaternion(head).add(pivot);
  const curve=new RoundedElbowFrame(length,upper,fore),p=new Vector3();
  let distance=Infinity;const gradient=new Vector3(),point=new Vector3();
  for(const t of whole?wholeSamples:samples){
    curve.center(t*length,p).add(shoulder);const x=p.x,y=p.y,z=p.z;p.sub(c).applyQuaternion(inv);
    const rho=Math.hypot(p.x/radius.x,p.y/radius.y,p.z/radius.z);
    if(rho<distance){distance=rho;point.set(x,y,z);gradient.set(p.x/(radius.x*radius.x),p.y/(radius.y*radius.y),p.z/(radius.z*radius.z)).applyQuaternion(head).normalize();}
  }
  return {distance,gradient,point};
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


/** When the proximal arm itself reaches the head, rotating only the forearm
 * cannot clear it. Turn the whole arm around its original shoulder; keep the
 * relative elbow angle and all lengths unchanged. */
export function clearStandingUpper(shoulder:Vector3,length:number,rest:Vector3,upperQ:Quaternion,foreQ:Quaternion,head:Quaternion):number {
 const initial=upperQ.clone(),upper=rest.clone().applyQuaternion(upperQ),fore=rest.clone().applyQuaternion(foreQ).applyQuaternion(upperQ);
 const rotation=new Quaternion();
 for(let i=0;i<24;i++){
  const contact=standingHeadClearance(shoulder,length,upper,fore,head,true);
  if(contact.distance>=1.015)break;
  const lever=contact.point.clone().sub(shoulder),axis=lever.clone().cross(contact.gradient);
  if(axis.lengthSq()<1e-8)break;
  axis.normalize();
  let step=Math.min(.1,(1.015-contact.distance)*.8),accepted=false;
  for(let attempt=0;attempt<6;attempt++){
   rotation.setFromAxisAngle(axis,step);
   const u=upper.clone().applyQuaternion(rotation),f=fore.clone().applyQuaternion(rotation),q=upperQ.clone().premultiply(rotation);
   if(initial.angleTo(q)<=.65 && standingHeadClearance(shoulder,length,u,f,head,true).distance>contact.distance+1e-7){upper.copy(u);fore.copy(f);upperQ.copy(q);accepted=true;break;}
   step*=.5;
  }
  if(!accepted)break;
 }
 return initial.angleTo(upperQ);
}

export function resolveStandingUpperContact(shoulder:Vector3,length:number,rest:Vector3,upperQ:Quaternion,foreQ:Quaternion,head:Quaternion,dt:number):number {
 const target=upperQ.clone(),correction=clearStandingUpper(shoulder,length,rest,target,foreQ,head);
 upperQ.rotateTowards(target,3.6*Math.min(.05,Math.max(0,dt)));
 return correction;
}


/** Bound the combined result, not each correction independently: shoulder and
 * elbow corrections otherwise add up to a fast paw turn. Return whether a
 * speed limit remains active while contact releases. */
export function limitStandingContactMotion(rest:Vector3,previousUpper:Quaternion,previousFore:Quaternion,upper:Quaternion,fore:Quaternion,dt:number):boolean {
 const elapsed=Math.min(.05,Math.max(0,dt));
 const before=rest.clone().applyQuaternion(previousFore).applyQuaternion(previousUpper);
 const desired=rest.clone().applyQuaternion(fore).applyQuaternion(upper),angle=before.angleTo(desired);
 const upperAngle=previousUpper.angleTo(upper),arc=new Quaternion().setFromUnitVectors(before,desired);
 if(upperAngle>3.6*elapsed)upper.copy(previousUpper.clone().rotateTowards(upper,3.6*elapsed));
 if(angle>6*elapsed)desired.copy(before).applyQuaternion(new Quaternion().slerp(arc,6*elapsed/angle));
 const limited=upperAngle>3.6*elapsed+1e-7||angle>6*elapsed+1e-7;
 if(limited)fore.setFromUnitVectors(rest,desired.applyQuaternion(upper.clone().invert()));
 return limited;
}

import {Quaternion,Vector3} from 'three';

/** At nearly opposite upper/forearm directions, their cross product has no
 * reliable plane: tiny tracker noise can reverse it. Transport the last
 * credible plane through this interval, then release it at bounded speed. */
export class StandingElbowPlane {
 private axis:Vector3|null=null;
 private upper:Vector3|null=null;
 private held=false;
 reset(){this.axis=null;this.upper=null;this.held=false;}
 direction(upper:Vector3,fore:Vector3,side:1|-1,gain:number,dt:number):Vector3 {
  const angle=upper.angleTo(fore),bend=Math.min(2.4,angle*gain);
  const raw=new Vector3().crossVectors(upper,fore);
  if(this.axis&&this.upper)this.axis.applyQuaternion(new Quaternion().setFromUnitVectors(this.upper,upper));
  if(!this.axis){
   this.axis=angle<2.75&&raw.lengthSq()>1e-6?raw.clone().normalize():new Vector3().crossVectors(upper,new Vector3(0,1,0));
   if(this.axis.lengthSq()<1e-6)this.axis.set(0,0,side);
   this.axis.addScaledVector(upper,-this.axis.dot(upper)).normalize();
  }
  this.upper=upper.clone();
  if(angle>=2.75)this.held=true;
  if(!this.held&&raw.lengthSq()>1e-6)this.axis.copy(raw).normalize();
  else if(this.held&&angle<2.5&&raw.lengthSq()>1e-6){
   raw.normalize();
   const delta=Math.atan2(upper.dot(this.axis.clone().cross(raw)),this.axis.dot(raw));
   // Near straight input the plane can change freely: its influence on the
   // visible forearm vanishes with the bend angle.
   const limit=4*Math.min(.05,Math.max(0,dt))/Math.max(.15,Math.sin(bend));
   this.axis.applyAxisAngle(upper,Math.max(-limit,Math.min(limit,delta))).normalize();
   if(Math.abs(delta)<=limit){this.axis.copy(raw);this.held=false;}
  }
  if(bend<.02)return upper.clone();
  return upper.clone().applyAxisAngle(this.axis,bend).normalize();
 }
}

import {Vector3} from 'three';

const nodes=[.033765242898424,.169395306766868,.380690406958402,.619309593041598,.830604693233132,.966234757101576];
const weights=[.085662246189585,.180380786524069,.233956967286346,.233956967286346,.180380786524069,.085662246189585];

/** One arm pose shares its bend integral and tangent basis across all vertices.
 * This evaluates the same curve as roundedElbowCenter without per-point
 * quaternion/vector allocation or repeated integration beyond the elbow. */
export class RoundedElbowFrame {
 readonly theta:number;
 readonly width:number;
 readonly start:number;
 private tangent:Vector3;
 private end:Vector3;
 private straight:boolean;
 constructor(readonly length:number,private upper:Vector3,private fore:Vector3,spread=.32){
  this.theta=upper.angleTo(fore);
  // Stop before the rigid paw (s >= .84L). The wider option reduces the
  // inner elbow's longitudinal compression without changing section radii.
  const cap=Math.min(.66,.60+Math.max(0,spread-.32)*(.06/.13));
  this.width=Math.min(length*cap,Math.max(length*.36,this.theta*length*spread));
  this.start=length*.5-this.width*.5;
  const axis=new Vector3().crossVectors(upper,fore);
  this.straight=this.theta<1e-6||axis.lengthSq()<1e-10;
  this.tangent=new Vector3().crossVectors(axis.normalize(),upper);
  this.end=this.integrate(this.width,new Vector3());
 }
 private integrate(amount:number,out:Vector3):Vector3 {
  out.copy(this.upper).multiplyScalar(this.start);
  for(let k=0;k<6;k++){
   const t=amount*nodes[k]/this.width,a=this.theta*t*t*(3-2*t),w=amount*weights[k];
   out.addScaledVector(this.upper,w*Math.cos(a)).addScaledVector(this.tangent,w*Math.sin(a));
  }
  return out;
 }
 center(s:number,out:Vector3):Vector3 {
  if(s<=this.start||this.straight)return out.copy(this.upper).multiplyScalar(s);
  if(s>=this.start+this.width)return out.copy(this.end).addScaledVector(this.fore,s-this.start-this.width);
  return this.integrate(s-this.start,out);
 }
}

/** Arc-length parameterized elbow. The radius and segment length are unchanged;
 * rotation is distributed over a short section instead of a point hinge.
 * CPU reference for the matching material function and regression checks. */
export function roundedElbowCenter(s:number,length:number,upper:Vector3,fore:Vector3):Vector3 {
 const theta=upper.angleTo(fore);
 const width=Math.min(length*.60,Math.max(length*.36,theta*length*.32)),start=length*.5-width*.5;
 if(s<=start)return upper.clone().multiplyScalar(s);
 const axis=new Vector3().crossVectors(upper,fore);
 if(theta<1e-6||axis.lengthSq()<1e-10)return upper.clone().multiplyScalar(s);
 axis.normalize();
 const amount=Math.min(s-start,width),center=upper.clone().multiplyScalar(start);
 for(let k=0;k<6;k++){
  const t=amount*nodes[k]/width,a=theta*t*t*(3-2*t);
  center.addScaledVector(upper.clone().applyAxisAngle(axis,a),amount*weights[k]);
 }
 if(s>start+width)center.addScaledVector(fore,s-start-width);
 return center;
}

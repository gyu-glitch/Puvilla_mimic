import {Vector3} from 'three';

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
 const nodes=[.033765242898424,.169395306766868,.380690406958402,.619309593041598,.830604693233132,.966234757101576];
 const weights=[.085662246189585,.180380786524069,.233956967286346,.233956967286346,.180380786524069,.085662246189585];
 for(let k=0;k<6;k++){
  const t=amount*nodes[k]/width,a=theta*t*t*(3-2*t);
  center.addScaledVector(upper.clone().applyAxisAngle(axis,a),amount*weights[k]);
 }
 if(s>start+width)center.addScaledVector(fore,s-start-width);
 return center;
}

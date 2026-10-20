import { Vector3 } from 'three';

const smooth=(a:number,b:number,x:number)=>{
  const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);
};

/** Downward human input returns the supplied 3D model's exact neutral axis.
 * Raised input follows the observed direction. No limb-length scaling. */
export function standingUpperDirection(side:1|-1,rest:Vector3,human:Vector3,maxRaise:number):Vector3 {
  const theta=Math.acos(Math.max(-1,Math.min(1,-human.y)));
  const restPolar=Math.acos(-rest.y),restAzimuth=Math.atan2(rest.z,side*rest.x);
  const thetaOut=Math.min(maxRaise,theta+restPolar*(1-smooth(0,Math.PI/2,theta)));
  const phi=Math.min(2,Math.max(-.5,Math.atan2(human.z,side*human.x)))*smooth(.25,.7,theta)
    +restAzimuth*(1-smooth(0,.7,theta));
  return new Vector3(side*Math.sin(thetaOut)*Math.cos(phi),-Math.cos(thetaOut),Math.sin(thetaOut)*Math.sin(phi));
}

import {Vector3} from 'three';

/** Retain a hand's relative orientation across a few missing finger samples.
 * Invalid samples are never accepted; a sustained loss eases back to neutral. */
export class StandingPawTracking {
  roll=0;
  readonly wrist=new Vector3();
  private rawRoll:number|null=null;
  private rollSeen=-Infinity;
  private wristSeen=-Infinity;
  reset(){this.roll=0;this.wrist.set(0,0,0);this.rawRoll=null;this.rollSeen=this.wristSeen=-Infinity;}
  update(roll:number|null,wrist:Vector3|null,now:number,dt:number){
    if(now<this.rollSeen || now<this.wristSeen)this.reset();
    const decay=Math.exp(-Math.min(.1,Math.max(0,dt))/.35);
    if(roll!==null && Number.isFinite(roll)){
      // atan2 wraps at +/- pi. Pick the nearest branch before the anatomical
      // limit, so crossing that boundary cannot flip the paw by 150 degrees.
      if(this.rawRoll===null || now-this.rollSeen>.8)this.rawRoll=roll;
      else this.rawRoll+=Math.atan2(Math.sin(roll-this.rawRoll),Math.cos(roll-this.rawRoll));
      this.roll=Math.max(-1.3,Math.min(1.3,this.rawRoll));this.rollSeen=now;
    }else if(now-this.rollSeen>.18)this.roll*=decay;
    if(wrist && [wrist.x,wrist.y,wrist.z].every(Number.isFinite)){
      this.wrist.copy(wrist).clampLength(0,.18);this.wristSeen=now;
    }else if(now-this.wristSeen>.18)this.wrist.multiplyScalar(decay);
  }
}

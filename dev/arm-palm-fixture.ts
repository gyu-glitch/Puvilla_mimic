import { armSessionFixture } from "./arm-session-fixture";

/** Palm plane stays camera-facing while the wrist travels toward the cheek.
 * Only the forearm changes direction/depth; no camera recording is used. */
export function armPalmFixture(t:number) {
  const p=((t%16)+16)%16,smooth=(x:number)=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
  const lift=p<2?smooth(p/2):p<13?1:1-smooth((p-13)/2);
  const near=p<4?0:p<7?smooth((p-4)/3):p<10?1:p<13?1-smooth((p-10)/3):0;
  const {raw}=armSessionFixture(lift<1?lift*2:3,true);
  for(const [s,e,w,index,pinky,sign] of [[11,13,15,19,17,1],[12,14,16,20,18,-1]]){
    const fore=raw.world[w],elbow=raw.world[e];
    fore.x+=(elbow.x-fore.x-sign*.13)*near*lift;
    fore.z-=.15*near*lift;
    // Index-to-pinky and wrist-to-fingers define the same palm plane throughout.
    raw.world[index]={x:fore.x-sign*.035,y:fore.y-.085,z:fore.z,visibility:1};
    raw.world[pinky]={x:fore.x+sign*.035,y:fore.y-.085,z:fore.z,visibility:1};
    for(const id of [s,e,w,index,pinky]){
      const v=raw.world[id];raw.image![id]={x:.5+v.x*.65/raw.imageAspect!,y:.88+v.y*.65};
    }
  }
  return {raw};
}

import { standingWavePose } from "../src/standingWave";
import type { RawPose } from "../src/poseTracker";

export function armSessionFixture(t:number,sustain=false) {
  const period=sustain?20:12,p=((t%period)+period)%period;
  const end=sustain?16:8,a=p<2?p/2:p<end?1:p<end+2?1-(p-end)/2:0;
  const amount=a*a*(3-2*a),l=standingWavePose(0,amount,1),r=standingWavePose(0,amount,-1);
  const pose={...r,shoulderL:l.shoulderL,elbowL:l.elbowL,wristL:l.wristL};
  const raw:RawPose={world:Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0})),
    image:Array.from({length:33},()=>({x:.5,y:.5})),imageAspect:16/9,nose:{x:.5,y:.3},shoulderW:.234};
  for(const [s,ids] of [["L",[12,14,16,24]],["R",[11,13,15,23]]] as const){
    for(const [n,joint] of (["shoulder","elbow","wrist","hip"] as const).entries()){
      const v=pose[`${joint}${s}`],id=ids[n];
      Object.assign(raw.world[id],{x:-v[0],y:-v[1],z:-v[2],visibility:1});
      raw.image![id]={x:.5-v[0]*.65/raw.imageAspect!,y:.88-v[1]*.65};
    }
  }
  if(!sustain){
    // Same measured image gesture; the left depth estimate drifts forward.
    raw.world[13].z-=.12*amount;raw.world[15].z-=.26*amount;
  }else if(p>=4&&p<14){
    for(const id of [13,14,15,16])raw.world[id].visibility=.58;
  }
  return {raw,faceHeld:!sustain||p<3.5||p>=16};
}

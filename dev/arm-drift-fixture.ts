import {standingWavePose} from "../src/standingWave";
import type {RawPose} from "../src/poseTracker";

/** Rest → weak inferred lift → real greeting → weak steady hold → lower → weak drift.
 * Synthetic landmarks, not a recording of a person. */
export function armDriftFixture(t:number, affected:"L"|"R"="L") {
  const p=((t%16)+16)%16;
  const ease=(v:number)=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
  const realLift=p<6?0:p<8?ease((p-6)/2):p<11?1:p<13?1-ease((p-11)/2):0;
  const l=standingWavePose(t,realLift,1),r=standingWavePose(t,realLift,-1);
  const pose={...r,shoulderL:l.shoulderL,elbowL:l.elbowL,wristL:l.wristL};
  const raw:RawPose={world:Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0})),
    image:Array.from({length:33},()=>({x:.5,y:.5})),imageAspect:16/9,nose:{x:.5,y:.3},shoulderW:.234};
  for(const [s,ids] of [["L",[12,14,16,24]],["R",[11,13,15,23]]] as const){
    for(const [n,joint] of (["shoulder","elbow","wrist","hip"] as const).entries()){
      const v=pose[`${joint}${s}`],id=ids[n];
      Object.assign(raw.world[id],{x:-v[0],y:-v[1],z:-v[2],visibility:1});
    }
    const drift=s===affected&&((p>=2&&p<6)||p>=13);
    if(drift){
      const theta=(p<6?(p-2)/4:(p-13)/3)*1.6;
      const sh=raw.world[ids[0]],el=raw.world[ids[1]],wr=raw.world[ids[2]];
      const sign=s==="L"?-1:1;
      // Begin at the exact resting vectors, then slowly drift each sample.
      const rest=standingWavePose(0,0,s==="L"?1:-1);
      const e=rest[`elbow${s}`],w=rest[`wrist${s}`],a=rest[`shoulder${s}`];
      const rotate=(x:number,y:number)=>[x*Math.cos(theta)+sign*y*Math.sin(theta),-sign*x*Math.sin(theta)+y*Math.cos(theta)];
      const ev=rotate(-(e[0]-a[0]),-(e[1]-a[1])),wv=rotate(-(w[0]-a[0]),-(w[1]-a[1]));
      Object.assign(el,{x:sh.x+ev[0],y:sh.y+ev[1],z:-(e[2]),visibility:.52});
      Object.assign(wr,{x:sh.x+wv[0],y:sh.y+wv[1],z:-(w[2]),visibility:.52});
    }else if(p>=8&&p<11){
      raw.world[ids[1]].visibility=raw.world[ids[2]].visibility=.58;
    }
    for(const id of ids){const v=raw.world[id];raw.image![id]={x:.5+v.x*.65/raw.imageAspect!,y:.88+v.y*.65};}
  }
  return {raw,phase:p<2?"rest":p<6?"weak false lift":p<8?"real lift":p<11?"steady raised hold":p<13?"lower":"weak drift after lowering"};
}

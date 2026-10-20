import { armSessionFixture } from "./arm-session-fixture";
/** Stationary camera input with threshold noise, followed by a real lowering.
 * First visibility flickers; then shoulder depth crosses the frontal boundary;
 * finally barely-visible hips oscillate at the old torso threshold. */
export function armJitterFixture(t:number) {
  const p=((t%16)+16)%16,frame=Math.floor(t*15);
  const {raw}=armSessionFixture(p<1?p*2:p<13?3:8+(p-13),true);
  if(p>=13){
    const lower=armSessionFixture(16+(p-13),true).raw;
    raw.world=lower.world;raw.image=lower.image;
  }
  if(p>=2&&p<6)for(const i of [13,14,15,16])raw.world[i].visibility=frame%4===0?.49:.85;
  if(p>=6&&p<10){
    const ratio=frame%2?.349:.351;
    const z=.36*ratio/Math.sqrt(1-ratio*ratio);
    raw.world[11].z=-z*.5;raw.world[12].z=z*.5;
    // A held forward arm provides distinct world/image estimates.
    raw.world[13].z=-.12;raw.world[15].z=-.26;
  }
  if(p>=10&&p<13){
    raw.world[23].z=raw.world[24].z=.28;
    raw.world[23].visibility=raw.world[24].visibility=frame%2?.49:.51;
  }
  return {raw};
}

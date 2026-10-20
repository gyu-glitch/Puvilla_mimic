import {armPalmFixture} from "./arm-palm-fixture";
/** Equal visible palm directions with only screen-left finger depth corrupted. */
export function armHandMirrorFixture(t:number) {
 const {raw}=armPalmFixture(t),p=((t%16)+16)%16;
 const amount=p<3?0:p<5?(p-3)/2:p<10?1:p<12?1-(p-10)/2:0;
 raw.world[19].z+=.045*amount;raw.world[17].z-=.045*amount;
 return {raw};
}

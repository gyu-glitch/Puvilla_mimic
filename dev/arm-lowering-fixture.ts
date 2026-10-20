import {armSessionFixture} from "./arm-session-fixture";

/** Raised hold, then a deliberately slow eight-second lowering at visibility
 * .58. World and image observations agree. No real camera recording. */
export function armLoweringFixture(t:number, confidence=.58, duration=8) {
  const phase=t%(duration+4);
  const source=phase<1?3:phase<duration+1?16+(phase-1)*2/duration:19;
  const raw=armSessionFixture(source,true).raw;
  if(phase>=1)for(const id of [13,14,15,16])raw.world[id].visibility=confidence;
  return {raw,progress:Math.min(1,Math.max(0,(phase-1)/duration))};
}

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseObj,subdivide} from '../src/character/subdivide.ts';
import {subdivisionPlans} from '../src/character/subdivisionPlan.ts';
const body=parseObj(readFileSync('public/models/pu_stand.obj','utf8')).find(p=>p.name==='pu_body');
const open={name:'boundary',positions:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],faces:[[0,1,2,3]],uvs:[],faceUvs:[null]};
for(const mesh of [body,open]){
 const plans=subdivisionPlans(mesh,2);
 for(const phase of [0,.3,1.8]){
  const positions=mesh.positions.map(([x,y,z])=>[x+Math.sin(y*.1+phase)*phase,y+Math.cos(z*.1)*phase,z]);
  let actual=new Float64Array(positions.flat());for(const p of plans)actual=p.evaluate(actual);
  const expected=subdivide({...mesh,positions},2);
  assert.deepEqual(plans.at(-1).faces,expected.faces);
  let max=0;expected.positions.flat().forEach((p,i)=>max=Math.max(max,Math.abs(p-actual[i])));
  assert.ok(max<1e-10,`${mesh.name} mismatch ${max}`);
 }
}
console.log('Subdivision plan matches original evaluator: moving body, boundary, two levels.');

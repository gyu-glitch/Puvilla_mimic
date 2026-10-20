import assert from 'node:assert/strict';
import {Vector3,Quaternion} from 'three';
import {readFileSync} from 'node:fs';
import {standingFrontPawRoll} from '../src/character/standingPawFrame.ts';
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_mirrorleft.json')),rows=[];
for(const side of [-1,1])for(const az of [0,.5,1,1.5,2]){
 const j=rig.joints[side>0?'L':'R'],rest=new Vector3(...j.hand).sub(new Vector3(...j.shoulder)).normalize();
 const up=new Vector3(side*.8,.15,.3).normalize(),u=new Quaternion().setFromUnitVectors(rest,up);
 const sample=(q,blend)=>{
  const d=new Vector3(side*Math.sqrt(q)*Math.sin(az),Math.sqrt(q)*Math.cos(az),Math.sqrt(1-q));
  const f=new Quaternion().setFromUnitVectors(rest,d.clone().applyQuaternion(u.clone().invert()));
  return standingFrontPawRoll(rest,u,f,side,-side*Math.PI/2,undefined,blend);
 };
 const delta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a))*180/Math.PI;
 const before=delta(sample(.09999,false),sample(.10001,false));
 const after=delta(sample(.09999,true),sample(.10001,true));
 assert.ok(Math.abs(after)<.001);
 for(const q of [0,.05,.099,.25,.5,.9])assert.ok(Math.abs(delta(sample(q,false),sample(q,true)))<1e-8,'unchanged region changed');
 let last=sample(.09,true),maxStep=0;
 for(let q=.0901;q<=.26;q+=.0001){const next=sample(q,true);maxStep=Math.max(maxStep,Math.abs(delta(last,next)));last=next;}
 assert.ok(maxStep<.2);
 rows.push({side,az,before,after,maxStep});
}
console.log(JSON.stringify({status:'synthetic automatic-palm boundary only',rows},null,2));

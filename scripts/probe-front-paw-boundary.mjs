import {Vector3,Quaternion} from 'three';
import {readFileSync} from 'node:fs';
import {standingFrontPawRoll} from '../src/character/standingPawFrame.ts';
const rig=JSON.parse(readFileSync('public/models/stand_connected_cage_mirrorleft.json')),rows=[];
for(const side of [-1,1])for(const az of [0,.5,1,1.5,2]){
 const j=rig.joints[side>0?'L':'R'],rest=new Vector3(...j.hand).sub(new Vector3(...j.shoulder)).normalize();
 const up=new Vector3(side*.8,.15,.3).normalize(),u=new Quaternion().setFromUnitVectors(rest,up),out=[];
 for(const q of [.09999,.10001]){
  const d=new Vector3(side*Math.sqrt(q)*Math.sin(az),Math.sqrt(q)*Math.cos(az),Math.sqrt(1-q));
  const f=new Quaternion().setFromUnitVectors(rest,d.clone().applyQuaternion(u.clone().invert()));
  out.push(standingFrontPawRoll(rest,u,f,side,-side*Math.PI/2));
 }
 rows.push({side,az,jumpDegrees:Math.atan2(Math.sin(out[1]-out[0]),Math.cos(out[1]-out[0]))*180/Math.PI});
}
console.log(JSON.stringify({status:'Unfixed automatic front-palm boundary. Not proven to be the user camera fault.',rows},null,2));

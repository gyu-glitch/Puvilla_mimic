import fs from 'node:fs';
import {parseObj,subdivide} from '../src/character/subdivide.ts';
const mesh=subdivide(parseObj(fs.readFileSync('public/models/pu_stand.obj','utf8')).find(p=>p.name==='pu_body'),2);
const rows=[];
for(let y=35;y<=110;y+=5){
 const points=new Map(),links=new Map();
 for(const face of mesh.faces){
  const ids=[];
  for(let k=0;k<face.length;k++){
   const ai=face[k],bi=face[(k+1)%face.length],a=mesh.positions[ai],b=mesh.positions[bi];
   if((a[1]<y)===(b[1]<y))continue;
   const key=ai<bi?`${ai},${bi}`:`${bi},${ai}`,t=(y-a[1])/(b[1]-a[1]);
   points.set(key,[a[0]+t*(b[0]-a[0]),a[2]+t*(b[2]-a[2])]);ids.push(key);
  }
  if(ids.length===2){for(const [a,b] of [[ids[0],ids[1]],[ids[1],ids[0]]]){if(!links.has(a))links.set(a,[]);links.get(a).push(b);}}
 }
 const seen=new Set(),parts=[];
 for(const key of points.keys()){
  if(seen.has(key))continue;const stack=[key],p=[];seen.add(key);
  while(stack.length){const k=stack.pop();p.push(points.get(k));for(const next of links.get(k)??[])if(!seen.has(next)){seen.add(next);stack.push(next);}}
  parts.push(p);
 }
 const body=parts.find(p=>Math.min(...p.map(p=>p[0]))<0&&Math.max(...p.map(p=>p[0]))>0);
 if(!body)continue;
 const xmin=Math.min(...body.map(p=>p[0])),xmax=Math.max(...body.map(p=>p[0])),zmin=Math.min(...body.map(p=>p[1])),zmax=Math.max(...body.map(p=>p[1]));
 const cz=(zmax+zmin)/2,rz=(zmax-zmin)/2;
 const estimates=body.filter(p=>Math.abs((p[1]-cz)/rz)>.6&&Math.abs((p[1]-cz)/rz)<.9).map(p=>Math.abs(p[0])/Math.sqrt(1-((p[1]-cz)/rz)**2)).sort((a,b)=>a-b);
 rows.push({y,fitRx:+estimates[Math.floor(estimates.length/2)].toFixed(3),rx:+Math.max(-xmin,xmax).toFixed(3),rz:+((zmax-zmin)/2).toFixed(3),cz:+((zmax+zmin)/2).toFixed(3),components:parts.length});
}
fs.writeFileSync('dev/torso-profile-source.json',JSON.stringify(rows,null,2));console.log(rows);

import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {FaceRecovery,recoverySearchCrop}=await import('../src/faceRecovery.ts');
let crop;
globalThis.OffscreenCanvas=class{constructor(w,h){this.width=w;this.height=h;}getContext(){return {filter:'',drawImage(input,x,y,w,h){crop={x,y,w,h};}}}};
const face={bbox:{x:.4,y:.3,w:.2,h:.3,cx:.5,cy:.45},yaw:0,pitch:0,roll:0,blend:{},eyes:{left:.2,right:.2},mouth:{open:.1,corner:0}};
for(const [width,height] of [[1280,720],[720,1280],[720,720],[300,150]]){
 const tiles=Array.from({length:12},(_,i)=>recoverySearchCrop(width,height,i));
 for(const t of tiles){assert.ok(t.x>=0&&t.y>=0&&t.x+t.size<=width&&t.y+t.size<=height);}
 for(let x=0;x<=width;x+=width/20)for(let y=0;y<=height;y+=height/20){
  assert.ok(tiles.slice(3).some(t=>x>=t.x-1e-6&&x<=t.x+t.size+1e-6&&y>=t.y-1e-6&&y<=t.y+t.size+1e-6),'enlarged views cover whole input');
 }
 for(let tile=3;tile<12;tile++){
  const r=new FaceRecovery(),source={width,height},wanted=tiles[tile];let first=-1,last;
  const detect=input=>input!==source&&crop.x===wanted.x&&crop.y===wanted.y&&crop.w===wanted.size?[face]:[];
  for(let i=0;i<12;i++){const result=r.run(source,i*250,detect);if(result.length){first=i;last=result[0];break;}}
  assert.equal(first,tile);
  assert.equal(last.bbox.cx,(wanted.x+.5*wanted.size)/width);
  assert.equal(last.bbox.cy,(wanted.y+.45*wanted.size)/height);
  const result=r.run(source,first*250+33,detect);assert.equal(result.length,1,'successful enlarged region tracked at frame cadence');
 }
}
console.log('PASS: 4 input aspects × 9 enlarged positions, full-frame coordinates, complete coverage, next-frame follow, bounded 12-pass search');

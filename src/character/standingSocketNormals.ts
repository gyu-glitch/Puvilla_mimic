import * as THREE from 'three';

/** Smooth rest-surface probes, including gradients of the skin/corrective
 * fields. A texture avoids exceeding mobile WebGL's vertex attribute limit.
 * These affect lighting only: no source positions or weights are changed. */
export function socketNormalProbes(geo: THREE.BufferGeometry): THREE.DataTexture {
  const p=geo.getAttribute('position'),n=geo.getAttribute('normal');
  const aw=geo.getAttribute('connectedArmWeights'),c=geo.getAttribute('connectedArmCorrective');
  const sw=geo.getAttribute('skinWeight'),si=geo.getAttribute('skinIndex');
  const groups=new Map<string,number[]>(),keys:string[]=[];
  for(let i=0;i<p.count;i++){
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>x.toFixed(5)).join(',');
    keys.push(key);const list=groups.get(key)??[];list.push(i);groups.set(key,list);
  }
  const adjacency=Array.from({length:p.count},()=>new Set<number>());
  const ix=geo.getIndex()!;
  for(let k=0;k<ix.count;k+=3){
    const ids=[ix.getX(k),ix.getX(k+1),ix.getX(k+2)];
    for(const a of ids)for(const b of ids)if(a!==b)adjacency[a].add(b);
  }
  const width=1024,height=Math.ceil(p.count*8/width),data=new Float32Array(width*height*4);
  const point=new THREE.Vector3(),normal=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3(),delta=new THREE.Vector3();
  const component=(a:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,i:number,k:number)=>a.getComponent(i,k);
  for(let i=0;i<p.count;i++){
    const mask=aw.getX(i)+aw.getY(i);
    if((mask<=.0001 || mask>=1) && Math.hypot(c.getX(i),c.getY(i),c.getZ(i))===0)continue;
    point.fromBufferAttribute(p,i);normal.fromBufferAttribute(n,i).normalize();
    u.set(Math.abs(normal.y)<.9?0:1,Math.abs(normal.y)<.9?1:0,0).cross(normal).normalize();
    v.crossVectors(normal,u).normalize();
    const selected=[0,1,2,3].map(k=>component(si,i,k));
    const fields=(j:number)=>{
      const projected=selected.map(b=>{
        let value=0;for(let k=0;k<4;k++)if(component(si,j,k)===b)value+=component(sw,j,k);return value;
      });
      return [...projected,...[0,1,2].map(k=>component(aw,j,k)),...[0,1,2].map(k=>component(c,j,k))];
    };
    const center=fields(i),bu=new Array<number>(10).fill(0),bv=new Array<number>(10).fill(0);
    let aa=0,ab=0,bb=0;
    const near=new Map<string,number>();
    for(const duplicate of groups.get(keys[i])!)for(const j of adjacency[duplicate])if(keys[j]!==keys[i])near.set(keys[j],j);
    for(const j of near.values()){
      delta.fromBufferAttribute(p,j).sub(point);const x=delta.dot(u),y=delta.dot(v),w=1/Math.max(1e-6,x*x+y*y);
      aa+=w*x*x;ab+=w*x*y;bb+=w*y*y;
      const value=fields(j);for(let k=0;k<10;k++){const d=value[k]-center[k];bu[k]+=w*x*d;bv[k]+=w*y*d;}
    }
    const determinant=aa*bb-ab*ab,eps=.02;
    for(let direction=0;direction<2;direction++){
      const values=center.map((x,k)=>x+(determinant>1e-8?eps*(direction===0?bb*bu[k]-ab*bv[k]:aa*bv[k]-ab*bu[k])/determinant:0));
      for(let k=0;k<7;k++)values[k]=Math.max(0,Math.min(1,values[k]));
      const total=values.slice(0,4).reduce((a,b)=>a+b,0)||1;for(let k=0;k<4;k++)values[k]/=total;
      const probe=point.clone().addScaledVector(direction===0?u:v,eps),offset=(i*8+direction*4)*4;
      data.set([probe.x,probe.y,probe.z,0],offset);
      data.set(values.slice(0,4),offset+4);
      data.set(values.slice(4,7),offset+8);
      data.set(values.slice(7,10),offset+12);
    }
  }
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);
  texture.needsUpdate=true;texture.magFilter=texture.minFilter=THREE.NearestFilter;
  geo.addEventListener('dispose',()=>texture.dispose());
  return texture;
}

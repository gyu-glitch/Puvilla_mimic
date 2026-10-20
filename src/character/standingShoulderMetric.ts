/** Local, pose-dependent strain limits on the connected shoulder patch.
 * Fixed body and rigid arm vertices are anchors. No rest points are changed. */
export class StandingShoulderMetric {
 private mobility:Float64Array;
 private edges:{a:number;b:number;length:number}[]=[];
 private target:Float64Array;
 private delta:Float64Array;
 private count:Float64Array;
 constructor(rest:number[][],faces:number[][],weights:number[][]){
  this.mobility=Float64Array.from(rest,(_p,i)=>{
   const w=weights[i][0]+weights[i][1];
   return w>1e-6&&w<.999 ? 4*w*(1-w) : 0;
  });
  this.target=new Float64Array(rest.length*3);this.delta=new Float64Array(rest.length*3);this.count=new Float64Array(rest.length);
  const seen=new Set<string>();
  for(const f of faces)for(let j=0;j<f.length;j++)for(let d=1;d<=2;d++){
   const a=f[j],b=f[(j+d)%f.length],key=a<b?`${a},${b}`:`${b},${a}`;
   if(seen.has(key)||!(this.mobility[a]+this.mobility[b]))continue;seen.add(key);
   this.edges.push({a,b,length:Math.hypot(...rest[a].map((v,k)=>v-rest[b][k]))});
  }
 }
 apply(points:Float64Array){
  this.target.set(points);
  for(let pass=0;pass<20;pass++){
   this.delta.fill(0);this.count.fill(0);
   for(const {a,b,length} of this.edges){
    const ia=a*3,ib=b*3,x=points[ib]-points[ia],y=points[ib+1]-points[ia+1],z=points[ib+2]-points[ia+2],current=Math.hypot(x,y,z);
    const desired=Math.min(length*1.30,Math.max(length*.80,current));
    if(Math.abs(desired-current)<1e-8||current<1e-8)continue;
    const wa=this.mobility[a],wb=this.mobility[b],k=(current-desired)/current/(wa+wb);
    for(let c=0;c<3;c++){
     const v=c===0?x:c===1?y:z;
     this.delta[ia+c]+=v*k*wa;this.delta[ib+c]-=v*k*wb;
    }
    this.count[a]++;this.count[b]++;
   }
   for(let i=0;i<this.mobility.length;i++)if(this.mobility[i]&&this.count[i]){
    const j=i*3;
    for(let c=0;c<3;c++)points[j+c]+=.8*this.delta[j+c]/this.count[i];
    const x=points[j]-this.target[j],y=points[j+1]-this.target[j+1],z=points[j+2]-this.target[j+2],distance=Math.hypot(x,y,z),limit=5*this.mobility[i];
    if(distance>limit)for(let c=0;c<3;c++)points[j+c]=this.target[j+c]+(points[j+c]-this.target[j+c])*limit/distance;
   }
  }
 }
}

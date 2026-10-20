import type {PolyMesh} from './subdivide';

/** Fixed-topology Catmull-Clark evaluation. Topology is prepared once; moving
 * cage positions can then be evaluated without rebuilding meshes every frame. */
export class SubdivisionPlan {
  readonly faces:number[][];
  readonly output:Float64Array;
  private edges:{a:number;b:number;faces:number[]}[]=[];
  private incidentFaces:number[][];
  private incidentEdges:number[][];
  private boundary:number[][];
  constructor(readonly count:number,readonly sourceFaces:number[][]){
    const map=new Map<string,number>();
    this.incidentFaces=Array.from({length:count},()=>[]);
    this.incidentEdges=Array.from({length:count},()=>[]);
    this.boundary=Array.from({length:count},()=>[]);
    sourceFaces.forEach((f,fi)=>f.forEach((a,k)=>{
      this.incidentFaces[a].push(fi);const b=f[(k+1)%f.length],key=a<b?`${a},${b}`:`${b},${a}`;
      let i=map.get(key);if(i===undefined){i=this.edges.length;map.set(key,i);this.edges.push({a,b,faces:[]});}
      this.edges[i].faces.push(fi);
    }));
    this.edges.forEach((e,i)=>{
      this.incidentEdges[e.a].push(i);this.incidentEdges[e.b].push(i);
      if(e.faces.length!==2){this.boundary[e.a].push(e.b);this.boundary[e.b].push(e.a);}
    });
    const edge=(a:number,b:number)=>count+map.get(a<b?`${a},${b}`:`${b},${a}`)!;
    this.faces=sourceFaces.flatMap((f,fi)=>f.map((a,k)=>[a,edge(a,f[(k+1)%f.length]),count+this.edges.length+fi,edge(f[(k+f.length-1)%f.length],a)]));
    this.output=new Float64Array((count+this.edges.length+sourceFaces.length)*3);
  }
  evaluate(p:ArrayLike<number>):Float64Array{
    const out=this.output,fb=this.count+this.edges.length;
    for(let fi=0;fi<this.sourceFaces.length;fi++){
      const face=this.sourceFaces[fi];for(let k=0;k<3;k++){let sum=0;for(const v of face)sum+=p[v*3+k];out[(fb+fi)*3+k]=sum/face.length;}
    }
    for(let i=0;i<this.edges.length;i++){
      const e=this.edges[i];for(let k=0;k<3;k++)out[(this.count+i)*3+k]=e.faces.length===2
        ?(p[e.a*3+k]+p[e.b*3+k]+out[(fb+e.faces[0])*3+k]+out[(fb+e.faces[1])*3+k])*.25
        :(p[e.a*3+k]+p[e.b*3+k])*.5;
    }
    for(let v=0;v<this.count;v++){
      const bn=this.boundary[v],faces=this.incidentFaces[v],edges=this.incidentEdges[v],n=faces.length;
      for(let k=0;k<3;k++){
        if(bn.length===2){out[v*3+k]=(6*p[v*3+k]+p[bn[0]*3+k]+p[bn[1]*3+k])/8;continue;}
        if(bn.length||n<3){out[v*3+k]=p[v*3+k];continue;}
        let F=0,R=0;for(const fi of faces)F+=out[(fb+fi)*3+k];
        for(const ei of edges){const e=this.edges[ei];R+=(p[e.a*3+k]+p[e.b*3+k])*.5;}
        out[v*3+k]=(F/n+2*R/edges.length+(n-3)*p[v*3+k])/n;
      }
    }
    return out;
  }
}

export function subdivisionPlans(mesh:PolyMesh,levels:number):SubdivisionPlan[]{
  const plans:SubdivisionPlan[]=[];let count=mesh.positions.length,faces=mesh.faces;
  for(let i=0;i<levels;i++){const plan=new SubdivisionPlan(count,faces);plans.push(plan);count=plan.output.length/3;faces=plan.faces;}
  return plans;
}

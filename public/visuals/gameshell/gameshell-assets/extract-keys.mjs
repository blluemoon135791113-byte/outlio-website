import fs from 'node:fs';
import {STLLoader} from 'three/examples/jsm/loaders/STLLoader.js';
const b=fs.readFileSync('public/previews/gameshell-assets/GameShell_keys_only_buttons.stl');const g=new STLLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));const a=g.attributes.position.array,N=a.length/9,p=Array.from({length:N},(_,i)=>i),seen=new Map();
function root(i){while(p[i]!==i){p[i]=p[p[i]];i=p[i]}return i}
for(let i=0;i<N;i++)for(let v=0;v<3;v++){let k=Array.from(a.slice(i*9+v*3,i*9+v*3+3),x=>Math.round(x*1e7)).join(',');let old=seen.get(k);if(old!==undefined)p[root(i)]=root(old);else seen.set(k,i)}
let groups=new Map();for(let i=0;i<N;i++){let r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i)}
let summary=[];for(let [id,ts] of groups){if(ts.length<30)continue;let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let t of ts)for(let v=0;v<3;v++)for(let d=0;d<3;d++){let x=a[t*9+v*3+d];min[d]=Math.min(min[d],x);max[d]=Math.max(max[d],x)}summary.push({id,n:ts.length,min,max,size:max.map((x,i)=>(x-min[i])*1000),center:max.map((x,i)=>(x+min[i])/2)});fs.writeFileSync('work/key-'+id+'.json',JSON.stringify(ts.flatMap(t=>Array.from(a.slice(t*9,t*9+9)))))}
fs.writeFileSync('work/key-parts.json',JSON.stringify(summary));console.log(summary.sort((a,b)=>b.n-a.n));

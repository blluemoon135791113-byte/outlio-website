const fs=require('fs');const parts=JSON.parse(fs.readFileSync('work/key-parts.json'));
for(const [id,name] of [[86140,'dpad'],[656,'button-x'],[14926,'button-y'],[11381,'button-b'],[41893,'button-a']]){const p=parts.find(x=>x.id===id),a=JSON.parse(fs.readFileSync('work/key-'+id+'.json'));const v=new Float32Array(a.map((x,i)=>(x-(i%3===2?p.min[2]:p.center[i%3]))*30));fs.writeFileSync('public/previews/gameshell-assets/'+name+'.bin',Buffer.from(v.buffer))}
fs.copyFileSync('work/gameboy-before-reference.js','public/previews/gameshell-study.js');

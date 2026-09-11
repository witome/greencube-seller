const fs=require('fs'),path=require('path');
function walk(d,out=[]){for(const f of fs.readdirSync(d)){const p=path.join(d,f);const s=fs.statSync(p);if(s.isDirectory())walk(p,out);else if(f.endsWith('.controller.ts'))out.push(p);}return out;}
const root=path.join(__dirname,'..','..','backend');
const files=walk(path.join(root,'src'));
let adminOnly=[], withAgent=[], other=[];
for(const f of files){
  const src=fs.readFileSync(f,'utf8');
  const lines=src.split(/\r?\n/);
  const cm=src.match(/@Controller\(['"`]([^'"`]*)['"`]\)/);
  const base=cm?cm[1]:'?';
  lines.forEach((ln,i)=>{
    const m=ln.match(/@Roles\(([^)]*)\)/);
    if(!m) return;
    const args=m[1].trim();
    let method='?';
    for(let j=i+1;j<Math.min(i+8,lines.length);j++){
      const mm=lines[j].match(/(?:async\s+)([A-Za-z0-9_]+)\s*\(/) || lines[j].match(/^\s{2}([A-Za-z0-9_]+)\s*\(/);
      if(mm){method=mm[1];break;}
    }
    const rec={file:path.relative(root,f).replace(/\\/g,'/'),line:i+1,base,method,args};
    if(/^Role\.ADMIN$/.test(args)) adminOnly.push(rec);
    else if(args.includes('BUSINESS_AGENT')) withAgent.push(rec);
    else other.push(rec);
  });
}
console.log('=== ADMIN-ONLY total:',adminOnly.length);
const byMod={};adminOnly.forEach(r=>{byMod[r.base]=(byMod[r.base]||0)+1});
console.log(Object.entries(byMod).sort().map(([k,v])=>`  ${k}: ${v}`).join('\n'));
console.log('\n=== WITH BUSINESS_AGENT total:',withAgent.length);
withAgent.forEach(r=>console.log(`  ${r.base}  ${r.method}  ${r.file}:${r.line}`));
console.log('\n=== OTHER total:',other.length);
console.log('\n=== ADMIN-ONLY detail ===');
adminOnly.forEach(r=>console.log(`  ${r.base}  ${r.method}  ${r.file}:${r.line}`));

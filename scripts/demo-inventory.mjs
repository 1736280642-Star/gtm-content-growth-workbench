import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
const target = process.argv[2] || 'pages';
if (target === 'pages') {
  for (const file of files(path.join(root,'src/app')).filter(f => /[\\/]page\.tsx$/.test(f))) {
    const text = readFileSync(file,'utf8');
    console.log(JSON.stringify({file:path.relative(root,file).replaceAll('\\','/'), client:/["']use client["']/.test(text), redirect:[...text.matchAll(/(?:redirect|replace)\(([^\n]+)/g)].map(m=>m[1].slice(0,180)), imports:[...text.matchAll(/from ["'](@\/[^"']+)["']/g)].map(m=>m[1])}));
  }
} else if (target === 'api') {
  for (const file of [...files(path.join(root,'src/app')), ...files(path.join(root,'src/components')), ...files(path.join(root,'src/lib'))].filter(f => /\.(tsx|ts)$/.test(f) && !f.includes(`${path.sep}api${path.sep}`))) {
    const text=readFileSync(file,'utf8');
    const matches=[...text.matchAll(/["'`]((?:\/api\/)[^"'`\n]+)["'`]/g)].map(m=>m[1]);
    if(matches.length) console.log(JSON.stringify({file:path.relative(root,file).replaceAll('\\','/'),paths:[...new Set(matches)]}));
  }
} else {
  for (const file of process.argv.slice(2)) {
    const text=readFileSync(file,'utf8');
    console.log('\n'+file+'\n'+text);
  }
}

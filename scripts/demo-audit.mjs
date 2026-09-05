import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const walk=dir=>existsSync(dir)?readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(dir,item.name)):[path.join(dir,item.name)]):[];
const checks=[];
function check(name,run){try{const detail=run();checks.push({name,ok:true,detail});}catch(error){checks.push({name,ok:false,error:error.message});}}
check('Same shared UI, with only the requested hosted history enhancement',()=>{
  const changed=execFileSync('git',['diff','2b84ec2','--name-only','--','src/app','src/components'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  const sharedEnhancement=['src/app/hosted-mode.module.css','src/app/hosted/success/page.tsx','src/app/hosted/email/page.tsx','src/app/hosted/review/[token]/page.tsx'];
  assert.deepEqual(changed.filter(file=>file!=='src/app/layout.tsx'&&!file.startsWith('src/app/demo-')&&!sharedEnhancement.includes(file)&&!file.startsWith('src/app/hosted/history/')&&!file.startsWith('src/app/hosted/_components/')&&!file.startsWith('src/app/api/v5/hosted/orders/[orderId]/history/')),[]);
  return 'Hosted result history is a shared feature; there is no separate Demo workbench UI.';
});
check('Authored Demo code contains no recognizable credentials or personal contact data',()=>{
  const sources=[...walk('src/demo'),...walk('src/app/demo-control'),...walk('src/app/demo-article'),...walk('public/demo-assets')].filter(file=>/\.(?:ts|tsx|svg|md)$/.test(file));
  const suspicious=[];
  for(const file of sources){const source=readFileSync(file,'utf8');if(/(?:gh[pousr]_[A-Za-z0-9]{24,}|sk-[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b1[3-9]\d{9}\b|[\w.+-]+@(?!example\.com\b)[\w.-]+\.[a-z]{2,})/i.test(source))suspicious.push(file);}
  assert.deepEqual(suspicious,[],'Inspect flagged source paths privately; never print matched values.');return {checkedFiles:sources.length};
});
const dist=process.env.DEMO_BUILD_DIR||'.next-demo-build';
check('Every compiled server API is the closed Demo stub',()=>{
  const routes=walk(path.join(dist,'server/app/api')).filter(file=>file.endsWith('/route.js')||file.endsWith('\\route.js'));
  assert.ok(routes.length>200,'Build the Demo before auditing.');
  const uncovered=routes.filter(file=>!readFileSync(file,'utf8').includes('demo_browser_session_required'));
  assert.deepEqual(uncovered,[]);return {closedServerRoutes:routes.length};
});
check('Build traces exclude dotenv, private state, knowledge files and real service clients',()=>{
  const traces=walk(dist).filter(file=>file.endsWith('.nft.json')&&!file.includes('standalone'));
  const forbidden=[];
  for(const file of traces){for(const entry of JSON.parse(readFileSync(file,'utf8')).files||[]){const resolved=path.resolve(path.dirname(file),entry).replaceAll('\\','/');if(/(?:^|\/)\.env(?:\.|$)|\/node_modules\/(?:mysql2|nodemailer)\//.test(resolved)||['data','runtime','保存','backups'].some(dir=>resolved.startsWith(path.resolve(dir).replaceAll('\\','/')+'/')))forbidden.push(file);}}
  assert.deepEqual([...new Set(forbidden)],[],'Build trace references a forbidden path.');
  assert.ok(!existsSync(path.join(dist,'standalone/.env')));return {traceFiles:traces.length};
});
check('Deployment ignores environment files and unrelated local artifacts',()=>{
  const ignore=readFileSync('.vercelignore','utf8');for(const entry of ['.env*','data/','runtime/','artifacts/','保存/','.tmp/'])assert.ok(ignore.split(/\r?\n/).includes(entry));assert.ok(!ignore.includes('!.env'));
  return 'No local configuration or enterprise source material is packaged.';
});
const report={passed:checks.filter(c=>c.ok).length,total:checks.length,checks};
mkdirSync('artifacts/demo-runtime',{recursive:true});writeFileSync('artifacts/demo-runtime/audit-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=checks.some(c=>!c.ok)?1:0;

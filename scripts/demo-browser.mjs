import { chromium } from '../.tmp/demo-browser-tools/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root=process.cwd(),base=process.env.DEMO_BASE_URL||'http://127.0.0.1:3064';
const module=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('src/demo/routes.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022})).toString('base64'));
const all=[...module.demoPageCases,...module.demoExtraCases];
const selected=process.argv.includes('--all')?all:all.filter(c=>['/','/products','/content-automation','/hosted/email','/products/[productId]','/products/[productId]/research/[runId]','/knowledge/[id]','/free-production','/free-production/assets','/settings','free-result','product-strategy','monitor-ai','monitor-website','settings-rules'].includes(c.route));
const output=path.resolve('artifacts/demo-runtime');mkdirSync(path.join(output,'screenshots'),{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-extensions','--disable-background-networking']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{window.__demoCalls=[];window.addEventListener('demo-api-result',e=>window.__demoCalls.push(e.detail));});
let errors=[];
const results=[];
try {
  for(const item of selected){
    const page=await context.newPage();errors=[];page.on('pageerror',e=>errors.push(e.message));const start=Date.now();let detail='';
    try{await page.goto(base+item.href,{waitUntil:'domcontentloaded',timeout:60000});if(item.route==='/knowledge/rule-packages')await page.getByRole('tab',{name:'已有规则包'}).click();await page.waitForFunction(expected=>document.body.innerText.includes(expected),item.expected,{timeout:20000});await page.waitForTimeout(1000);}catch(e){detail=e.message.split('\n')[0];}
    const text=await page.locator('body').innerText().catch(()=>'');
    if(item.route==='/drafts/[taskId]'&&!await page.locator('textarea').evaluateAll(nodes=>nodes.some(node=>node.value.includes('虚拟'))))detail='Draft editor has no synthetic article body';
    const calls=await page.evaluate(()=>window.__demoCalls||[]).catch(()=>[]);
    const failures=calls.filter(c=>c.status>=400 && c.status!==401);
    const visibleErrors=/NaN|undefined|Invalid Date|Application error|演示适配尚未覆盖|演示数据初始化失败|暂时无法读取结果|产品信息读取失败/.test(text);
    const ok=!detail&&!errors.length&&!failures.length&&!visibleErrors;
    const file=item.route.replaceAll(/[^a-zA-Z0-9-]/g,'_')||'home';
    await page.screenshot({path:path.join(output,'screenshots',file+'.png'),fullPage:true}).catch(()=>{});
    const result={route:item.route,href:item.href,finalUrl:page.url().replace(base,''),expected:item.expected,ok,errors,apiFailures:failures,detail,durationMs:Date.now()-start,text:text.slice(0,20000)};results.push(result);
    await page.close();
    console.log(JSON.stringify({route:item.route,ok,errors,apiFailures:failures,detail}));
    writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({mode:process.argv.includes('--all')?'all':'core',total:results.length,passed:results.filter(r=>r.ok).length,results},null,2));
  }
}finally{await browser.close();}
console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length}));
process.exitCode=results.some(r=>!r.ok)?1:0;

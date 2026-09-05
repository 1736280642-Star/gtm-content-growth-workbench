import { chromium } from '../.tmp/demo-browser-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const base=process.env.DEMO_BASE_URL||'http://127.0.0.1:3064';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();page.setDefaultTimeout(20000);
const output='artifacts/demo-runtime/history';mkdirSync(output,{recursive:true});
const results=[];let errors=[];page.on('pageerror',error=>errors.push(error.message));
const waitText=text=>page.waitForFunction(text=>document.body.innerText.includes(text),text);
const go=async(path,text)=>{await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:60000});await waitText(text);if(path.startsWith('/hosted/success'))await page.getByRole('heading',{name:'正式托管回执',exact:true}).waitFor();};
async function check(name,run){errors=[];try{await run();assert.deepEqual(errors,[]);results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.message,errors});}await page.screenshot({path:`${output}/${String(results.length).padStart(2,'0')}.png`,fullPage:true}).catch(()=>{});console.log(JSON.stringify(results.at(-1)));writeFileSync(`${output}/report.json`,JSON.stringify({passed:results.filter(item=>item.ok).length,total:results.length,results},null,2));}
const receipt='/hosted/success?orderId=demo-order-orbitdesk';
try {
  await check('receipt retains clickable results for all five steps',async()=>{
    await go(receipt,'正式托管回执');const links=page.getByRole('link',{name:/^查看结果/});assert.equal(await links.count(),5);
    const hrefs=await links.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
    for(let i=0;i<hrefs.length;i++){
      await go(receipt,'正式托管回执');await page.getByRole('link',{name:/^查看结果/}).nth(i).click();await waitText('历史结果 · 只读');
      assert.equal(new URL(page.url()).searchParams.get('resultId'),new URL(base+hrefs[i]).searchParams.get('resultId'));
      assert.equal(await page.getByRole('button',{name:/确认策略，生成样文|确认样文，开始托管|保存核心表达/}).count(),0);
      if([2,3].includes(i))await waitText('从资料到可检查的结果');if(i===4)await waitText('已公开 3 篇');
      await page.screenshot({path:`${output}/step-${i+1}.png`,fullPage:true});
    }
    await page.getByRole('link',{name:'返回托管回执'}).click();await waitText('正式托管回执');
  });
  await check('email page links to publishing history and back to current results',async()=>{
    await go('/hosted/email?orderId=demo-order-orbitdesk','公开结果与状态');await page.getByRole('link',{name:'查看历史回执'}).click();await waitText('当时的公开结果与状态');
    assert.equal(await page.getByRole('link',{name:/查看公开文章/}).count(),3);
    await page.getByRole('link',{name:'查看当前发布结果'}).click();await waitText('公开结果与状态');
  });
  await check('revision history can switch between decisions and keeps the original text after refresh',async()=>{
    await go('/hosted/review/demo-strategy','核心表达');
    await page.evaluate(async()=>{const response=await fetch('/api/v5/hosted/reviews/demo-strategy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'changes_requested',comment:'历史演示：请保留旧版本并聚焦运营场景。'})});if(!response.ok)throw new Error('Review failed');});
    const token=await page.evaluate(()=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')).mails[0].href.split('/').at(-1));
    await go('/hosted/review/'+token,'核心表达');await page.locator('textarea').first().fill('新版虚拟表达：面向运营场景。');await page.getByRole('button',{name:'保存核心表达'}).click();await waitText('三项核心表达已写入');await page.getByRole('button',{name:'确认策略，生成样文'}).click();await waitText('这项确认已经完成');
    await go('/hosted/history?orderId=demo-order-review&step=strategy','历史结果 · 只读');await waitText('新版虚拟表达：面向运营场景。');
    const versions=page.getByRole('complementary',{name:'历史版本'}).getByRole('link');assert.equal(await versions.count(),2);await versions.nth(1).click();await waitText('历史演示：请保留旧版本');
    assert.ok(!(await page.locator('main').last().innerText()).includes('新版虚拟表达'));const url=page.url();await page.reload();await waitText('历史演示：请保留旧版本');assert.equal(page.url(),url);
    await page.getByRole('navigation',{name:'结果步骤'}).getByRole('link',{name:/生成代表样文/}).click();await waitText('留存正文');
    await page.getByRole('navigation',{name:'结果步骤'}).getByRole('link',{name:/确认代表样文/}).click();await waitText('尚无可查看的历史结果');
  });
  await check('older browser data upgrades without resetting edits and supplies all five baseline results',async()=>{
    await page.evaluate(()=>{const key='gtm-demo-runtime.v1',state=JSON.parse(localStorage.getItem(key));delete state.hostedHistory;state.orders[0].notificationPreferences.dailyDigest=false;localStorage.setItem(key,JSON.stringify(state));});
    await go(receipt,'正式托管回执');assert.equal(await page.getByRole('link',{name:/^查看结果/}).count(),5);
    await page.getByRole('link',{name:/^查看结果/}).nth(1).click();await waitText('旧演示数据升级时补存的当前可见版本');await waitText('旧记录未留存确认决定');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')).orders[0].notificationPreferences.dailyDigest),false);
  });
  await check('mobile history is readable without whole-page horizontal overflow',async()=>{
    await page.setViewportSize({width:390,height:844});await go('/hosted/history?orderId=demo-order-orbitdesk&step=sample-review','留存正文');
    const dimensions=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));
    await page.getByRole('link',{name:'返回托管回执'}).click();await page.getByRole('heading',{name:'正式托管回执',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:/^查看结果/}).count(),5);
  });
  await check('invalid record gives an explicit error with a recovery link',async()=>{
    await go('/hosted/history?orderId=demo-order-orbitdesk&step=strategy&resultId=missing','无法打开历史结果');await waitText('不存在或不属于当前任务');assert.ok(await page.getByRole('link',{name:'返回托管回执'}).isVisible());
  });
} finally { await browser.close(); }
process.exitCode=results.some(item=>!item.ok)?1:0;

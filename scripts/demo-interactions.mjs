import { chromium } from '../.tmp/demo-browser-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const base=process.env.DEMO_BASE_URL||'http://127.0.0.1:3064';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();page.setDefaultTimeout(20000);
let errors=[];page.on('pageerror',e=>errors.push(e.message));
const results=[];mkdirSync('artifacts/demo-runtime/interactions',{recursive:true});
const onlyIndex=process.argv.indexOf('--only'),only=onlyIndex>=0?process.argv[onlyIndex+1]:'';
const reportPath=`artifacts/demo-runtime/interaction${only?'-focused':''}-report.json`;
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')));
const waitText=text=>page.waitForFunction(value=>document.body.innerText.includes(value),text);
const go=async(path,text)=>{await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:60000});await waitText(text);};
async function step(name,action){if(only&&!name.includes(only))return;errors=[];try{await action();assert.deepEqual(errors,[]);results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:error.message.slice(0,2000),pageErrors:errors,text:(await page.locator('body').innerText().catch(()=>'' )).slice(0,10000)});}console.log(JSON.stringify(results.at(-1)));await page.screenshot({path:'artifacts/demo-runtime/interactions/'+(only?'focused-':'')+String(results.length).padStart(2,'0')+'.png',fullPage:true}).catch(()=>{});writeFileSync(reportPath,JSON.stringify({total:results.length,passed:results.filter(r=>r.ok).length,results},null,2));}
try{
  await step('结果邮件的三篇正文链接全部能打开',async()=>{
    await go('/hosted/email','公开结果与状态');
    const links=await page.getByRole('link',{name:'查看公开文章'}).evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));assert.equal(links.length,3);
    for(const link of links){const tab=await context.newPage();try{await tab.goto(base+link,{waitUntil:'domcontentloaded'});await tab.getByText('从资料到可检查的结果',{exact:false}).first().waitFor();assert.ok((await tab.locator('body').innerText()).includes('虚拟'));}finally{await tab.close();}}
  });
  await step('编辑策略、确认策略与样文、邮件和监控联动',async()=>{
    await go('/hosted/review/demo-strategy','核心表达');
    await page.locator('textarea').first().fill('HarborFlow 是用于交接任务与核对结果的虚拟流程助手。');
    await page.getByRole('button',{name:'保存核心表达'}).click();await waitText('三项核心表达已写入');
    await page.getByRole('button',{name:'确认策略，生成样文'}).click();await waitText('这项确认已经完成');
    await go('/hosted/review/demo-sample','代表样文');await page.getByRole('button',{name:'确认样文，开始托管'}).click();await waitText('这项确认已经完成');
    const current=await state();assert.equal(current.orders.find(o=>o.orderId==='demo-order-review').status,'running');
    await go('/hosted/email?orderId=demo-order-review','已获得 1 个公开结果');assert.equal(await page.getByRole('link',{name:'查看公开文章'}).count(),1);
    await go('/content-monitor?tab=content','内容表现明细');await waitText('HarborFlow');
  });
  await step('通知偏好保存并刷新保留',async()=>{
    await go('/hosted/preferences/demo-preferences','保存通知偏好');const before=(await state()).orders.find(o=>o.orderId==='demo-order-orbitdesk').notificationPreferences.dailyDigest;
    await page.getByRole('switch').first().click();await page.getByRole('button',{name:'保存通知偏好'}).click();
    await page.waitForFunction(old=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')).orders.find(o=>o.orderId==='demo-order-orbitdesk').notificationPreferences.dailyDigest!==old,before);
    await page.reload();await waitText('保存通知偏好');assert.equal((await state()).orders.find(o=>o.orderId==='demo-order-orbitdesk').notificationPreferences.dailyDigest,!before);
  });
  await step('从 main 首页发起一个新虚拟产品的推广',async()=>{
    await go('/','发起新的推广批次');await page.getByRole('button',{name:'发起新的推广批次'}).click();
    await page.getByRole('button',{name:/新增产品/}).click();await page.getByPlaceholder('例如：WorkBuddy').fill('DemoFlow 演示产品');await page.getByPlaceholder('https://example.com/product').fill('https://example.com/demo-flow');
    const channel=page.locator('#setup-channels button').filter({hasText:'知乎'}).first();if(await channel.getAttribute('aria-pressed')!=='true')await channel.click();
    await page.getByRole('button',{name:'确认委托，开始调研'}).click();await waitText('委托已创建');
    const current=await state();assert.ok(current.products.some(p=>p.displayName==='DemoFlow 演示产品'));assert.equal(current.orders[0].status,'pending_strategy_review');assert.ok(current.mails[0].href.includes(current.orders[0].orderId));
  });
  await step('生成正文、选择封面、修改正文和排版、写入草稿箱',async()=>{
    await go('/free-production','使用此类型');await page.getByRole('button',{name:'使用此类型'}).first().click();
    await page.getByPlaceholder('例如：强调产品的核心竞争力，或通过什么观点引出产品重点。').fill('虚拟团队怎样把任务交接到可检查的结果');await page.getByRole('button',{name:/生成正文/}).click();await waitText('核对正文与来源');await page.getByRole('button',{name:'采用此封面'}).first().waitFor();
    await page.getByRole('button',{name:'采用此封面'}).first().click();await waitText('当前封面');
    await page.getByRole('button',{name:/编辑正文/}).click();const dialog=page.getByRole('dialog');await dialog.locator('input').first().fill('演示修改：从任务到结果');await dialog.getByRole('button',{name:'保存并更新预览'}).click();await dialog.waitFor({state:'hidden'});
    const frame=page.frameLocator('iframe.wechat-official-preview-frame');await frame.getByRole('heading',{name:'演示修改：从任务到结果',exact:true}).waitFor();
    await page.locator('.wechat-layout-picker .ant-select-selector').click();await page.getByText('官方蓝图型',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('iframe.wechat-official-preview-frame')?.getAttribute('srcdoc')?.includes('official-blueprint'));
    const html=await page.locator('iframe.wechat-official-preview-frame').getAttribute('srcdoc');assert.ok(html.includes('data-wechat-layout'));assert.ok(!/(?:src|data-src)="https?:/.test(html));
    await page.getByRole('button',{name:/发送到草稿箱/}).click();await waitText('草稿箱');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')).freeBatches[0].status==='draft_created');
    const current=await state();const batch=current.freeBatches[0];assert.equal(batch.publishedUrl,undefined);assert.ok(batch.draftUrl);
    await go('/free-production/tasks','任务与发布');await waitText('演示修改：从任务到结果');
  });
  await step('来源采集开关更新并持久化',async()=>{
    await go('/products/sources','今日采集');await page.getByRole('tab',{name:/采集来源/}).click();const before=(await state()).collectionSources[0].enabled;await page.getByRole('switch').first().click();await page.waitForFunction(old=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')).collectionSources[0].enabled!==old,before);await page.reload();await waitText('今日采集');assert.equal((await state()).collectionSources[0].enabled,!before);
  });
  await step('研究目录支持单项确认，不自动选择其他问题',async()=>{
    await go('/products/orbitdesk/research/run-orbitdesk','确认并纳入 GEO 监控');
    await page.getByRole('checkbox').nth(1).check();await page.getByRole('button',{name:'确认并纳入 GEO 监控'}).click();await waitText('已将 1 个');const catalog=(await state()).research.orbitdesk.runWorkspace.questionCatalog;assert.equal(catalog.importedCount,1);assert.equal(catalog.items.filter(q=>q.reviewStatus==='confirmed').length,1);
  });
  await step('外部调用和服务器真实 API 被阻断',async()=>{
    const external=await page.evaluate(async()=>({status:(await fetch('https://example.com/no-real-request')).status}));assert.equal(external.status,403);
    const server=await page.request.get(base+'/api/v5/hosted/orders');assert.equal(server.status(),403);assert.equal((await server.json()).error.code,'demo_browser_session_required');
  });
  await step('不同浏览器会话互不污染',async()=>{
    const separate=await browser.newContext();const other=await separate.newPage();try{await other.goto(base+'/');await other.waitForFunction(()=>localStorage.getItem('gtm-demo-runtime.v1'));const seed=await other.evaluate(()=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')));assert.equal(seed.orders.length,2);assert.ok(!seed.products.some(p=>p.displayName==='DemoFlow 演示产品'));}finally{await separate.close();}
  });
  await step('异常场景一键重置，补充资料恢复任务',async()=>{
    await go('/demo-control','演示场景');await page.getByRole('button',{name:'异常处理',exact:true}).click();await page.getByRole('button',{name:'确认重置',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')).scenario==='attention');await go('/knowledge/kb-orbitdesk','虚拟产品说明');
    assert.equal((await state()).orders[0].status,'action_required');
    await page.getByRole('button',{name:/导入资料/}).first().click();const modal=page.getByRole('dialog');await modal.getByLabel('资料名称',{exact:true}).fill('演示效果数据说明');await modal.getByLabel('资料支持的系统理解',{exact:true}).fill('数字为合成样本，不代表实测结果。');await modal.getByRole('button',{name:'导入并更新理解'}).click();await modal.waitFor({state:'hidden'});await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')).orders[0].status==='running');assert.equal((await state()).tasks.filter(t=>t.failureReason).length,0);
  });
  await step('规则包已有结果可编辑并确认生效',async()=>{
    await go('/knowledge/rule-packages','产品表达规则包');await page.getByRole('tab',{name:'已有规则包'}).click();await waitText('OrbitDesk');await page.getByRole('button',{name:/编\s*辑/}).first().click();await page.getByRole('tab',{name:'编辑与确认'}).click();
    await page.getByLabel('规则摘要',{exact:true}).fill('演示规则：仅允许有来源的虚拟产品表述。');await page.getByRole('button',{name:'保存草稿'}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')).knowledge[0].productExpressionRuleDraft.summary.includes('演示规则：'));await page.getByRole('button',{name:'确认生效'}).click();await waitText('已生效');
  });
  await step('活动纪实按输入的虚拟事实生成正文',async()=>{
    await go('/free-production','活动纪实');await page.getByRole('button',{name:'使用此类型'}).nth(2).click();
    await page.getByLabel('时间',{exact:true}).fill('2026-09-05');await page.getByLabel('地点',{exact:true}).fill('演示会议室');await page.getByLabel('人物',{exact:true}).fill('虚拟运营负责人');await page.getByLabel('事件',{exact:true}).fill('完成项目交接演练，并逐项核对输出。');await page.getByRole('checkbox',{name:'已确认以上事实可以公开'}).check();await page.getByLabel('表达重点',{exact:true}).fill('项目交接中的人工判断');await page.getByRole('button',{name:/生成正文/}).click();await waitText('核对正文与来源');
    const current=await state(),batch=current.freeBatches[0];assert.equal(batch.sourceMode,'facts');assert.ok(batch.draftArtifacts[0].articleBody.includes('完成项目交接演练'));await page.frameLocator('iframe.wechat-official-preview-frame').getByText('完成项目交接演练',{exact:false}).first().waitFor();
  });
  await step('首次使用从虚拟邮箱登录，不需要真实收信',async()=>{
    await go('/demo-control','演示场景');await page.getByRole('button',{name:'首次使用',exact:true}).click();await page.getByRole('button',{name:'确认重置',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gtm-demo-runtime.v1')).scenario==='first-use');await go('/','发送登录链接');
    await page.getByPlaceholder('name@company.com').fill('presenter@example.com');await page.getByRole('button',{name:/发送登录链接/}).click();await waitText('登录邮件已发送');await go('/demo-control','演示登录链接');
    const login=(await state()).mails.find(m=>m.kind==='login');assert.ok(login);await go(login.href,'OrbitDesk');assert.equal((await state()).identity.email,'presenter@example.com');
  });
}finally{await browser.close();}
console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.ok).length}));process.exitCode=results.some(r=>!r.ok)?1:0;

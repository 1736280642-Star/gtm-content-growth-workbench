import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createDemoState } from '../src/demo/fixtures/core.ts';
import { dispatchDemoRequest } from '../src/demo/gateway.ts';
import { orderBatches } from '../src/demo/handlers/hosted.ts';
import { questionMetric, monitorOverview } from '../src/demo/fixtures/monitoring.ts';
import { demoPageCases } from '../src/demo/routes.ts';
import { renderDemoArticle } from '../src/demo/fixtures/production.ts';
import { spawnSync } from 'node:child_process';

function call(state,path,method='GET',body={},key){
  const candidate=structuredClone(state);
  const result=dispatchDemoRequest(candidate,{path,method,body,headers:new Headers(key?{'x-idempotency-key':key}:{})});
  if(result.status<400&&method!=='GET')Object.assign(state,candidate);
  return result;
}
function success(...args){const result=call(...args);assert.ok(result.status<400,JSON.stringify(result));return result.body.data??result.body;}
const initial=()=>createDemoState('populated',new Date('2026-09-05T02:30:00Z'));

test('65 maintained routes are inventoried without replacing production pages',()=>{
  const walk=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(dir+'/'+item.name):item.name==='page.tsx'?[dir.replace('src/app','')||'/']:[]);
  const routes=walk('src/app').filter(route=>!route.startsWith('/demo-'));
  assert.equal(routes.length,65);assert.deepEqual(new Set(demoPageCases.map(p=>p.route)),new Set(routes));
});
test('synthetic state uses one calendar month, and all record links are local',()=>{
  const state=initial();assert.equal(state.month,'2026-09');
  for(const batch of state.freeBatches){assert.equal(batch.monthStart,'2026-09-01');assert.equal(batch.monthEnd,'2026-09-30');}
  for(const task of state.tasks){if(task.scheduledAt)assert.ok(task.scheduledAt.startsWith(state.month));if(task.publicUrl)assert.ok(task.publicUrl.startsWith('/demo-article/'));}
  assert.ok(JSON.stringify(state).includes('虚拟'));
  assert.ok(!/https?:\/\/(?!example\.com|demo\.invalid)/.test(JSON.stringify(state)));
});
test('email totals and monitor ledger agree with canonical tasks',()=>{
  const state=initial(),batch=orderBatches(state,state.orders[0])[0];
  assert.equal(batch.plannedCount,6);assert.equal(batch.publishedCount,3);assert.equal(batch.pendingCount,2);assert.equal(batch.failedCount,1);
  assert.equal(batch.plannedCount,batch.publishedCount+batch.pendingCount+batch.failedCount);
  const monitor=monitorOverview(state);assert.equal(monitor.content.length,batch.publishedCount);
  assert.equal(monitor.metrics.publications.value,monitor.content.length);
  assert.equal(monitor.trend.reduce((sum,row)=>sum+row.totals.publications,0),monitor.content.length);
});
test('metric numerator/denominator and prior month stay in range',()=>{
  const state=initial();for(const previous of [false,true])for(const question of state.monitoringQuestions){const metric=questionMetric(question,state.month,previous);assert.equal(metric.relationshipAccuracyRate,metric.relationshipAccurateCount/metric.brandMentionCount);assert.ok(metric.ownedCitationRate<=1);assert.ok(metric.brandMentionRate<=1);}
});
test('new hosted submission, two human gates, email and publication results form a closed loop',()=>{
  const state=initial();const {order}=success(state,'/api/v5/hosted/orders','POST',{productName:'虚拟演示新产品',channels:[{channel:'zhihu',dailyCap:2},{channel:'csdn',dailyCap:1}]},'new-order');
  assert.equal(order.status,'pending_strategy_review');assert.equal(orderBatches(state,order)[0].publishedCount,0);
  const strategyLink=state.mails[0].href;assert.ok(strategyLink.includes(order.orderId));
  success(state,'/api/v5/hosted/reviews/'+strategyLink.split('/').at(-1),'POST',{decision:'approve'},'strategy-approve');
  assert.equal(state.orders[0].status,'pending_sample_review');
  const sampleLink=state.mails[0].href;const payload=success(state,'/api/v5/hosted/reviews/'+sampleLink.split('/').at(-1));assert.ok(payload.sample.markdown.length>200);
  success(state,'/api/v5/hosted/reviews/'+sampleLink.split('/').at(-1),'POST',{decision:'approve'},'sample-approve');
  const batch=orderBatches(state,state.orders[0])[0];assert.equal(batch.publishedCount,2);assert.equal(state.orders[0].status,'running');
  assert.ok(state.mails[0].href.includes(order.orderId));assert.equal(orderBatches(state,state.orders.find(o=>o.orderId==="demo-order-orbitdesk"))[0].publishedCount,3);
});
test('idempotent creation and conflicting replay do not duplicate records',()=>{
  const state=initial(),body={productId:'orbitdesk',channels:[{channel:'zhihu'}]};
  const one=call(state,'/api/v5/hosted/orders','POST',body,'same');const two=call(state,'/api/v5/hosted/orders','POST',body,'same');assert.deepEqual(two,one);assert.equal(state.orders.length,3);
  assert.equal(call(state,'/api/v5/hosted/orders','POST',{...body,productId:'harborflow'},'same').status,409);
});
test('free content remains a draft, version conflicts fail, revisions can be restored',()=>{
  const state=initial();let batch=state.freeBatches[0],artifact=batch.draftArtifacts[0];const path='/api/v5/free-production/batches/'+batch.id;
  assert.equal(call(state,path+'/content','PATCH',{expectedVersion:999,title:'x',articleBody:'x'}).status,409);
  batch=success(state,path+'/content','PATCH',{expectedVersion:batch.version,artifactId:artifact.id,title:'修改后的虚拟标题',articleBody:artifact.articleBody+'\n\n新增虚拟说明。'},'edit');
  assert.equal(batch.draftArtifacts.at(-1).selectedTitle,'修改后的虚拟标题');
  batch=success(state,path+'/restore-version','POST',{expectedVersion:batch.version},'restore');assert.equal(batch.currentDraftArtifactId,artifact.id);
  batch=success(state,path+'/confirm-and-publish','POST',{expectedVersion:batch.version,contentDigest:artifact.contentDigest},'send');assert.equal(batch.status,'draft_created');assert.ok(batch.draftUrl.startsWith('/demo-article/'));assert.equal(batch.publishedUrl,undefined);assert.equal(state.tasks.filter(t=>t.status==='published').length,3);
  assert.equal(call(state,path+'/content','PATCH',{expectedVersion:batch.version,title:'x',articleBody:'x'}).status,409);
});
test('cover generation and selection match the original API contracts',()=>{
  const state=initial(),batch=state.freeBatches[0],path='/api/v5/free-production/batches/'+batch.id;
  const workspace=success(state,path+'/visual-plan');assert.equal(workspace.provider.status,'ready');assert.equal(workspace.plan.candidates.length,3);
  const plan=success(state,path+'/visual-plan','POST',{expectedVersion:batch.version,artifactId:batch.currentDraftArtifactId});
  const selected=success(state,path+'/visual-plan/selection','PATCH',{expectedVersion:batch.version,artifactId:batch.currentDraftArtifactId,planId:plan.planId,candidateId:plan.candidates[1].candidateId});assert.equal(selected.plan.status,'applied');assert.equal(selected.batch.version,batch.version+1);
});
test('material recovery updates execution and notifications consistently',()=>{
  const state=createDemoState('attention',new Date('2026-09-05T02:30:00Z'));
  success(state,'/api/v5/knowledge-bases/kb-orbitdesk/materials','POST',{expectedVersion:1,title:'虚拟效果说明',summary:'合成数据不是实测结果。'});
  assert.equal(state.tasks.filter(t=>t.failureReason).length,0);assert.equal(state.orders[0].status,'running');assert.equal(orderBatches(state,state.orders[0])[0].failedCount,0);
});
test('new content-type draft is persisted, activated and can be disabled',()=>{
  const state=initial();const profile=success(state,'/api/v5/article-type-profiles','POST',{input:{name:'演示类型',suitableQuestionDescription:'如何交接任务'}});
  assert.equal(profile.status,'draft');success(state,'/api/v5/article-type-profiles/'+profile.profileId+'/activate','POST',{expectedVersion:profile.revision});
  assert.equal(state.articleTypes.at(-1).status,'active');const active=state.articleTypes.at(-1);success(state,'/api/v5/article-type-profiles/'+profile.profileId,'PATCH',{expectedVersion:active.revision,action:'disable'});assert.equal(state.articleTypes.at(-1).status,'disabled');
});
test('unknown APIs never fall through to real execution',()=>{
  const state=initial();assert.equal(call(state,'/api/not-implemented','POST').status,501);assert.equal(call(state,'/api/v5/hosted/orders/not-found').status,404);
  const runtime=readFileSync('src/demo/browser-runtime.ts','utf8');assert.ok(runtime.includes('demo_external_request_blocked'));const middleware=readFileSync('src/middleware.ts','utf8');assert.ok(middleware.includes('demo_browser_session_required'));
});
test('scenario reset produces independent repeatable state',()=>{
  const a=initial(),b=initial();a.tasks[0].title='changed';assert.notEqual(a.tasks[0].title,b.tasks[0].title);const done=createDemoState('completed',new Date('2026-09-05T02:30:00Z'));assert.equal(orderBatches(done,done.orders[0])[0].publishedCount,6);
});

test('fact-based content reflects confirmed facts, not unrelated knowledge',()=>{
  const state=initial(),expression=state.expressions[2].activeVersion;
  const body={expressionTypeVersionId:expression.freeContentExpressionTypeVersionId,productId:expression.productId,expressionFocus:'一次虚拟交接活动',factItems:[{time:'2026-09-05',location:'虚拟会议室',people:'演示负责人',event:'完成资料交接与结果检查',publicConfirmed:true}]};
  const batch=success(state,'/api/v5/free-production/batches/from-expression','POST',body);
  assert.equal(batch.sourceMode,'facts');assert.deepEqual(batch.knowledgeSnapshotIds,[]);assert.ok(batch.draftArtifacts[0].articleBody.includes('完成资料交接与结果检查'));assert.equal(batch.sourceExcerpts[0].sourceType,'human_fact');
  body.factItems[0].publicConfirmed=false;assert.equal(call(state,'/api/v5/free-production/batches/from-expression','POST',body).status,422);
});

test('shared HTML renderer produces distinct layouts and only local image results',()=>{
  const official=renderDemoArticle('虚拟标题','## 虚拟段落\n\n保留人工确认。');
  const natural=renderDemoArticle('虚拟标题','## 虚拟段落\n\n保留人工确认。','natural-calm');
  assert.notEqual(official,natural);assert.ok(natural.includes('natural-calm'));assert.ok(official.includes('星屿实验室'));
  assert.ok(!/(?:src|data-src)="https?:/.test(official));
  assert.ok(!/[\w.+-]+@(?!example\.com)[\w.-]+\.[\w.-]+/.test(official));
});

test('filtering channels cannot change the metrics of the same publication',()=>{
  const state=initial(),all=monitorOverview(state).content;
  for(const channel of ['wechat','zhihu','csdn','juejin'])for(const row of monitorOverview(state,[channel]).content)assert.deepEqual(row.latestMetrics,all.find(item=>item.publishResultId===row.publishResultId).latestMetrics);
});

test('research imports only selected findings and makes them monitorable',()=>{
  const state=initial(),before=state.monitoringQuestions.length,catalog=state.research.orbitdesk.runWorkspace.questionCatalog;
  success(state,'/api/v5/products/orbitdesk/research-runs/run-orbitdesk/question-catalog','POST',{expectedQuestionPoolVersion:state.revision,findingIds:[catalog.items[0].findingId]});
  assert.equal(state.research.orbitdesk.runWorkspace.questionCatalog.importedCount,1);assert.equal(state.monitoringQuestions.length,before+1);assert.ok(state.questions.some(q=>q.questionId===catalog.items[0].id));
});

test('sample regeneration does not change published originals, feedback preserves prior content',()=>{
  const state=initial(),published=structuredClone(state.tasks.filter(t=>t.status==='published'));
  const result=success(state,'/api/v5/products/orbitdesk/sample-article','POST',{});
  assert.equal(result.items.length,2);assert.deepEqual(state.tasks.filter(t=>t.status==='published'),published);
  const item=result.items[0],task=state.tasks.find(t=>t.taskId===item.taskId),draftId=task.formalDraftId;
  success(state,'/api/v5/drafts/'+draftId+'/sample-review','POST',{decision:'changes_requested',revisionInstruction:'明确加入虚拟数据的适用边界。',expectedVersion:1});
  const detail=success(state,'/api/v5/products/orbitdesk/sample-articles/'+task.taskId);
  assert.equal(detail.versions.length,2);assert.ok(detail.currentVersion.markdown.includes('明确加入虚拟数据'));assert.equal(detail.versions[1].versionNumber,1);
});

test('legacy expression rules can generate, activate and roll back',()=>{
  const state=initial(),path='/api/knowledge-bases/kb-orbitdesk/product-expression';
  success(state,path,'POST',{action:'regenerate'});assert.equal(state.knowledge[0].productExpressionRuleDraft.version,'2');
  success(state,path,'POST',{action:'activate'});assert.equal(state.knowledge[0].productExpressionRuleDraft.status,'active');
  success(state,path,'POST',{action:'rollback'});assert.equal(state.knowledge[0].productExpressionRuleDraft.version,'1');
});

test('incidental credential fields are removed before state and replay persistence',()=>{
  const state=initial();success(state,'/api/workspace-settings','POST',{apiKey:'synthetic-input-do-not-retain',models:{password:'synthetic-password-do-not-retain'}},'settings');
  const serialized=JSON.stringify(state);assert.ok(!serialized.includes('synthetic-input-do-not-retain'));assert.ok(!serialized.includes('synthetic-password-do-not-retain'));assert.ok(serialized.includes('demo-not-a-credential'));
});

test('Demo Next workers skip reading dotenv files entirely',()=>{
  const script=`require('./scripts/demo-env-guard.cjs'); const fs=require('fs'); const original=fs.readFileSync; fs.readFileSync=function(file,...args){if(/(?:^|[\\\\/])\\.env/.test(String(file)))throw Error('Unexpected dotenv read');return original.call(this,file,...args);}; const result=require('@next/env').loadEnvConfig(process.cwd(),false,console,true);if(result.loadedEnvFiles.length)process.exit(1);`;
  const result=spawnSync(process.execPath,['-e',script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});

test('git-triggered Demo previews choose isolation while main keeps production build',()=>{
  const probe=`require('node:child_process').spawn=(command,args)=>{console.log(JSON.stringify(args));return{on(){}};}; import('./scripts/build-workbench.mjs');`;
  for(const [env,expected] of [[{VERCEL:'1',VERCEL_GIT_COMMIT_REF:'codex/demo-runtime'},['scripts/demo-run.mjs','build']],[{VERCEL:'1',VERCEL_GIT_COMMIT_REF:'main'},['node_modules/next/dist/bin/next','build']],[{APP_RUNTIME_MODE:'demo'},['scripts/demo-run.mjs','build']]]){
    const result=spawnSync(process.execPath,['-e',probe],{encoding:'utf8',env});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),expected);
  }
});

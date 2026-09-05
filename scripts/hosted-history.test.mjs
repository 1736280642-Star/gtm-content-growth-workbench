import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoState } from '../src/demo/fixtures/core.ts';
import { initializeDemoHistory } from '../src/demo/hosted-history.ts';
import { dispatchDemoRequest } from '../src/demo/gateway.ts';
import { hostedHistorySteps, hostedHistoryHref } from '../src/lib/v5/hosted-history-contracts.ts';
import { archiveHostedResult } from '../src/lib/v5/hosted-history-repository.ts';
const initial=()=>createDemoState('populated',new Date('2026-09-05T02:30:00Z'));
function call(state,path,method='GET',body={},key){
  const copy=structuredClone(state),result=dispatchDemoRequest(copy,{path,method,body,headers:new Headers(key?{'x-idempotency-key':key}:{})});
  if(result.status<400&&method!=='GET') Object.assign(state,copy);
  return result;
}
function ok(...args){const result=call(...args);assert.ok(result.status<400,JSON.stringify(result));return result.body;}
const historyPath='/api/v5/hosted/orders/demo-order-orbitdesk/history';
test('formal archive serializes a separate immutable payload within existing audit column limits',async()=>{
  const writes=[],connection={query:async(sql,values)=>{writes.push({sql,values});return [];}};
  const snapshot=structuredClone(initial().hostedHistory[0]);snapshot.resultId='r'.repeat(90);
  await archiveHostedResult(connection,snapshot,'test-history-actor');
  assert.equal(writes.length,1);assert.ok(writes[0].sql.includes('INSERT INTO governance_audit_event'));
  assert.ok(writes[0].values.at(-1).length<=64);
  const archived=JSON.parse(writes[0].values[9]);snapshot.summary='new value';assert.notEqual(archived.summary,snapshot.summary);
  assert.equal(archived.resultId,'r'.repeat(90));
});
test('all five completed steps have concrete, scoped, read-only snapshots',()=>{
  const state=initial(),before=JSON.stringify(state),data=ok(state,historyPath);
  assert.deepEqual(new Set(data.entries.map(item=>item.step)),new Set(hostedHistorySteps));
  for(const step of hostedHistorySteps){const view=ok(state,historyPath+'?step='+step);assert.equal(view.result.step,step);assert.ok(view.result.summary.length);assert.ok(!JSON.stringify(view).includes('token'));}
  assert.equal(JSON.stringify(state),before);assert.equal(call(state,historyPath,'POST').status,405);
  const sample=ok(state,historyPath+'?step=sample-review').result;assert.ok(sample.article.markdown.length>200);assert.equal(sample.decision,'approve');
});
test('later product strategy and draft edits cannot rewrite stored results',()=>{
  const state=initial(),before=JSON.stringify(state.hostedHistory);
  state.strategies.orbitdesk.contentPlan.coreExpressions.productIdentity='后来的虚拟表述';state.tasks[0].currentDraft.markdown='后来的正文';state.tasks[0].title='后来的标题';
  assert.equal(JSON.stringify(state.hostedHistory),before);assert.ok(!JSON.stringify(ok(state,historyPath+'?step=sample-generation').result).includes('后来的'));
});
test('new order only acquires later results after each human gate',()=>{
  const state=initial(),{order}=ok(state,'/api/v5/hosted/orders','POST',{productId:'orbitdesk',channels:[{channel:'zhihu'}]},'create-history');
  const path=`/api/v5/hosted/orders/${order.orderId}/history`;
  assert.deepEqual(ok(state,path).entries.map(item=>item.step),['research']);
  const strategy=state.mails[0].href.split('/').at(-1);
  ok(state,`/api/v5/hosted/reviews/${strategy}`,'POST',{decision:'approve'},'approve-strategy');
  assert.deepEqual(new Set(ok(state,path).entries.map(item=>item.step)),new Set(['research','strategy','sample-generation']));
  const sample=state.mails[0].href.split('/').at(-1);
  ok(state,`/api/v5/hosted/reviews/${sample}`,'POST',{decision:'approve'},'approve-sample');
  assert.deepEqual(new Set(ok(state,path).entries.map(item=>item.step)),new Set(hostedHistorySteps));
  const count=state.hostedHistory.length;ok(state,`/api/v5/hosted/reviews/${sample}`,'POST',{decision:'approve'},'approve-sample');assert.equal(state.hostedHistory.length,count);
});
test('changes requested and later approval remain separate versions with original content',()=>{
  const state=initial(),path='/api/v5/hosted/reviews/demo-strategy';
  ok(state,path,'POST',{decision:'changes_requested',comment:'请收窄到虚拟运营用户。'},'revise');
  const first=ok(state,'/api/v5/hosted/orders/demo-order-review/history?step=strategy').result;
  const token=state.mails[0].href.split('/').at(-1),pack=state.strategies.harborflow;
  ok(state,'/api/v5/hosted/reviews/'+token,'PATCH',{expectedVersion:pack.rowVersion,edit:{productIdentity:'只面向虚拟运营用户的助手'}});
  ok(state,'/api/v5/hosted/reviews/'+token,'POST',{decision:'approve'},'approve-revised');
  const entries=ok(state,'/api/v5/hosted/orders/demo-order-review/history').entries.filter(item=>item.step==='strategy');assert.equal(entries.length,2);
  const archived=ok(state,'/api/v5/hosted/orders/demo-order-review/history?step=strategy&resultId='+encodeURIComponent(first.resultId)).result;
  assert.deepEqual(archived,first);assert.equal(archived.comment,'请收窄到虚拟运营用户。');assert.equal(archived.decision,'changes_requested');
  const acted=ok(state,path);assert.ok(!acted.strategy.summary.coreExpressions.productIdentity.includes('只面向'));assert.equal(call(state,path,'PATCH',{edit:{productIdentity:'x'}}).status,409);
});
test('history rejects foreign record IDs, missing orders and invalid steps',()=>{
  const state=initial(),foreign=state.hostedHistory.find(item=>item.orderId==='demo-order-review');
  assert.equal(call(state,historyPath+'?resultId='+encodeURIComponent(foreign.resultId)).status,404);
  assert.equal(call(state,historyPath+'?step=other').status,400);assert.equal(call(state,historyPath+'?resultId=gone').status,404);
  assert.equal(call(state,'/api/v5/hosted/orders/gone/history').status,404);
});
test('publication changes append receipts without changing earlier failed or pending results',()=>{
  const state=initial(),old=ok(state,historyPath+'?step=publishing').result;
  ok(state,'/api/v5/knowledge-bases/kb-orbitdesk/materials','POST',{expectedVersion:1,title:'虚拟说明',summary:'合成数据的依据'});
  const latest=ok(state,historyPath+'?step=publishing').result;assert.notEqual(latest.resultId,old.resultId);
  assert.ok(latest.summary.includes('未完成 0 篇'));assert.deepEqual(ok(state,historyPath+'?resultId='+encodeURIComponent(old.resultId)).result,old);
  const count=state.hostedHistory.length;ok(state,'/api/v5/hosted/orders/demo-order-orbitdesk/settings','PATCH',{expectedVersion:state.orders[0].rowVersion,dailyDigest:false});assert.equal(state.hostedHistory.length,count);
});
test('older browser state migrates additively, labels baseline and does not invent decisions',()=>{
  const state=initial();delete state.hostedHistory;state.tasks[0].title='用户已修改的标题';const before=structuredClone(state);
  initializeDemoHistory(state,true);assert.deepEqual(state.tasks,before.tasks);assert.deepEqual(state.orders,before.orders);
  assert.equal(new Set(state.hostedHistory.filter(item=>item.orderId==='demo-order-orbitdesk').map(item=>item.step)).size,5);
  assert.ok(state.hostedHistory.every(item=>item.summary.includes('补存')));assert.ok(state.hostedHistory.every(item=>!item.decision));
  const stable=JSON.stringify(state);initializeDemoHistory(state,true);assert.equal(JSON.stringify(state),stable);
  const reloaded=JSON.parse(JSON.stringify(state));assert.deepEqual(ok(reloaded,historyPath).entries,ok(state,historyPath).entries);
});
test('pending scenarios do not show fabricated approval or publication archives',()=>{
  const state=createDemoState('first-use',new Date('2026-09-05T02:30:00Z'));
  assert.ok(state.hostedHistory.every(item=>item.step==='research'));
  assert.equal(ok(state,historyPath+'?step=sample-review').result,undefined);
});
test('formal archive writes share source transactions; history endpoint authenticates before reading',()=>{
  const route=readFileSync('src/app/api/v5/hosted/orders/[orderId]/history/route.ts','utf8');
  assert.ok(route.indexOf('await requireHostedIdentity')<route.indexOf('await assertWorkspaceOrderAccess'));
  assert.ok(route.indexOf('await assertWorkspaceOrderAccess')<route.indexOf('await Promise.all'));
  assert.ok(!/getHostedPromotionOrder|reconcileHosted|buildHostedReviewToken/.test(route));
  for(const file of ['hosted-review-repository.ts','hosted-daily-batch-repository.ts']){const source=readFileSync('src/lib/v5/'+file,'utf8');assert.ok(source.includes('archiveHostedResult(connection'));assert.ok(source.includes('withV5GovernanceTransaction'));}
  const repo=readFileSync('src/lib/v5/hosted-history-repository.ts','utf8');assert.ok(!/UPDATE |DELETE |INSERT IGNORE/.test(repo));assert.ok(repo.includes("object_id = ?"));
  assert.equal(hostedHistoryHref('a&b','research','x/y'),'/hosted/history?orderId=a%26b&step=research&resultId=x%2Fy');
});

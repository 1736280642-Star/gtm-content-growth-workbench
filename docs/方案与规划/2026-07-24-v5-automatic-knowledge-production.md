# V5 自动知识生产链路

## 结论

V5 的事实链路已收敛为系统内部自动流程：可信资料导入后自动建立 SourceRevision、提取原子 Claim、裁决版本与冲突、构建索引、冻结 EvidencePack、生成正文并执行事实校验。页面不再提供向量化或正文生成按钮，也不新增人工复核队列。

正式环境仍要求 MySQL、OpenSearch、真实 Embedding Provider 和正文 Provider。任一依赖缺失时返回 `pending_config`，不会用测试向量或演示正文冒充生产结果。

## 实现逻辑

```text
code-controlled source registry
-> SourceAsset / SourceRevision
-> deterministic Claim extraction
-> authority + sourceUpdatedAt conflict policy
-> automatic SourceSnapshot / rule package / monthly readiness
-> approved Manifest
-> real Embedding + OpenSearch index
-> approved/blocked Claim retrieval replay
-> active IndexSnapshot
-> task retrieval and EvidencePack
-> model draft
-> claim/original quote/condition validator
-> remove unsupported passages
-> traceable draft
```

来源裁决顺序为：权威等级、来源更新时间、明确版本。最高优先级仍无法区分时，冲突双方都标记为 `disputed`，不进入生产 EvidencePack。条件事实保留为 `conditional`，允许生成，但系统强制正文同时展示条件或限制。

每条事实追溯结构固定为：

```text
fact sentence
-> evidenceItemId
-> claimId
-> sourceRevisionId
-> headingPath / paragraphIndex / characterRange
-> exact originalQuote
```

## JOTO x ADP 来源策略

- `structured/01-workbuddy-structured.md`：`A2/current`，可信官网结构化快照。
- `structured/02-tencent-adp-structured.md`：`A2/current`，可信官网结构化快照。
- `腾讯云ADP × JOTO 联合解决方案.md`：`B1/unknown`，历史方案，只参与历史背景和冲突治理。
- 新版“腾讯云合作伙伴但不扩写为腾讯云 ADP 官方合作伙伴”覆盖旧版“腾讯云 ADP 官方合作伙伴”。
- WorkBuddy 价格、席位、套餐能力必须连同“可能变化、以当期页面/报价单/合同为准”输出。

默认目录为 `D:/GTM/工作台/保存/JOTO x ADP`，可通过 `RAG_SOURCE_ROOT_JOTO_ADP` 覆盖。

## 更新与失效

同一 Source 的内容 Hash 变化时创建新 SourceRevision，并在同一事务内：

1. 将旧 Chunk 标记为 `superseded`。
2. 将引用旧修订的 EvidencePack 标记为 `invalidated`。
3. 将尚未完成的矩阵任务退回重新检索状态。
4. 写入 `knowledge_refresh` 后台任务。
5. 后台内容 worker 使用任务版本幂等键领取新的 `ready_for_generation` 任务。

## 验收

```powershell
npm.cmd run test:v5-knowledge-e2e
npm.cmd run test:v5-rag
npm.cmd run test:v5-single-article:contracts
npm.cmd run test:v5-monthly-production
npm.cmd run typecheck
npm.cmd run validate:structure
```

`test:v5-knowledge-e2e` 读取指定 JOTO x ADP 目录中的真实代表资料。测试内的向量和模型适配器明确为确定性验收实现，只验证业务语义；正式索引仍走 OpenSearch 与真实 Embedding Provider。

## 后台运行

生产调度依次运行 `worker:v5-rag:source-import -- --write`、`worker:v5-rag:knowledge-refresh`、`worker:v5-rag:index` 和 `worker:v5-content-production`。来源更新后，系统自动冻结新快照与规则版本，回放 approved/blocked Claim，硬指标全部通过后激活新索引，再将受影响任务释放为 `ready_for_generation`。

这条链路不在业务页面增加向量化、生成或人工复核按钮。缺少 MySQL、OpenSearch、Embedding 或正文 Provider 时保持 `pending_config` 并自动重试，不伪造通过结果。

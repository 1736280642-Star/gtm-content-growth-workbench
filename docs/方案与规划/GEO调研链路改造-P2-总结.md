# GEO 调研链路改造 P2 阶段总结

> 阶段范围：M7 下游候选扩展、M8 提及率 KPI 闭环
> 完成日期：2026-08-19
> 验证结果：`npm.cmd run typecheck` 通过；`npm.cmd run validate:structure` 536/536 通过；GEO 相关测试套件全绿（foundation 14、multi-search 20、probe-compiler 4、result-pack 4、source-quality 4）

## 一、本阶段目标回顾

P2 是"落地与闭环"阶段：把 P0/P1 在调研链路内部产生的渠道化数据（faqBoard、channelDistribution、contentCluster、channelCitationStats）**下沉给下游消费入口**，并让工作台的唯一推广目的——提升 AI 提及率——成为**可测量、可归因、可驱动下一轮调研的 KPI 闭环**，而不是停留在蓝图文字里。

## 二、完成内容

### M7 下游候选扩展（[geo-research-downstream.ts](../../src/lib/v5/geo-research-downstream.ts)、[geo-research-result-pack.ts](../../src/lib/v5/geo-research-result-pack.ts)、[geo-research-service.ts](../../src/lib/v5/geo-research-service.ts)）

| 下游入口 | 新增字段 | 来源与规则 |
|---|---|---|
| 问题池候选 questionPool | `faqBoard` | live_question_discovery 输出的问题板块映射（按归一化问题文本匹配），无映射时为 uncategorized |
| 策略包候选 strategyPack | `channelDistribution[]` | result pack 的 `citationLandscape.channelCitationStats`（被 AI 引用 URL 的渠道分布：channelKey / citedUrlCount / citedUrlShare），策略包据此决定渠道优先级 |
| 内链集群候选 contentCluster（新增入口） | `clusterTheme` / `memberArticleTypes` / `internalLinkRationale` | blueprint_synthesis 的 `contentClusterPlan`，状态恒为 candidate，需随策略包人工批准 |
| 监控候选 monitoring | `retestAligned` | P0 探针命中批准蓝图 retestBaseline 问题时为 true；复测独有问题自动补充为 P0 监控候选（candidateId 前缀 `geo-monitor-retest:`） |

- result pack 新增 `citationLandscape.channelCitationStats` 解析（frontend_baseline aggregate 的渠道引用统计，确定性校验：非法 channelKey 丢弃、share 夹在 [0,1]、contentTypes 上限 8）；
- `buildGeoResearchDownstreamCandidates` 新增 `faqBoardByQuestion` / `contentClusterPlan` / `retestBaselineQuestions` 三个输入；
- `getGeoResearchRunDetails` 从 live_question_discovery 任务抽取问题→板块映射、从 blueprint_synthesis 抽取内链集群与复测基线，全部投影到候选；
- 运行详情页（[page.tsx](../../src/app/products/[productId]/research/[runId]/page.tsx)）下游候选面板升级为五入口（新增"内链集群候选"），提示语同步更新为"不会自动写入问题池、策略包、官网整改、内链集群或月度监控"。

### M8 提及率 KPI 闭环

**1. 基线持久化（DB + 契约 + 仓储）**

- 迁移 [20260819_037_v5_geo_research_mention_baseline.sql](../../database/migrations/20260819_037_v5_geo_research_mention_baseline.sql)：`geo_research_run` 新增 `mention_baseline` JSON 列；
- 契约新增 `GeoMentionBaseline`（capturedAt / questionCount / targetMentionedCount / targetMentionRate / mentionedQuestions / unmentionedQuestions / unevaluableQuestions / competitors / channelCitationStats / providerBreakdown / measurementSource），`GeoResearchRun.mentionBaseline` 可选字段；失败或不支持的 Provider 观测不进入问题分母，整轮无成功观测则拒绝形成复测 KPI；
- `buildGeoMentionBaselineFromObservations`（[geo-research-result-pack.ts](../../src/lib/v5/geo-research-result-pack.ts)）：直接由 `runMultiProviderProbeAnswers` 返回的逐问题、逐 Provider 真实观测确定性推导，模型语义总结不再作为新 run 的 KPI 事实源；旧 run 只保留 `legacy_semantic_output` 兼容读取；frontend_baseline 完成时随事务写入 run 行。

**2. post_publish_retest 触发类型激活**

- [geo-probe-compiler.ts](../../src/lib/v5/geo-probe-compiler.ts) 新增 `overrideGeoProbeSetQuestions`：用批准蓝图 `retestBaseline.questions` 覆盖探针集（全部 P0、scenario_anchored、scoringDimensions=target_mentioned、evidenceExpectation=ai_observation_only），重算 snapshotHash/probeSetId；
- `createGeoResearchRunRecord` 中 post_publish_retest run 的探针集改为复测问题集，**fail-closed**：无已批准蓝图抛 409 `retest_blueprint_missing`；蓝图无复测问题抛 409 `retest_baseline_questions_missing`；
- 复测 run 必须绑定批准蓝图、原始基线 run、由该蓝图策略包产生的已闭合发布批次和优化快照；发布批次未闭合、早于蓝图批准、策略包不属于当前蓝图或绑定不一致时拒绝创建；
- 复测使用独立单任务图，仅执行 `frontend_baseline`，完成后 run 直接进入 `completed`，不会再次生成待批准蓝图，也不会形成递归复测；
- 修复既有缺口：`readGeoResearchTaskExecutionContext` 此前从不返回 probeSetSnapshot（探针集快照表只写不读，探针应答从未真正执行）——现从 run plan_json 中读取并返回，前台基线探针应答链路（`runMultiProviderProbeAnswers`）至此贯通，普通 run 与复测 run 均受益。

**3. 差值归因（[geo-research-service.ts](../../src/lib/v5/geo-research-service.ts)）**

- `readGeoMentionBaselineByRunId`：复测按绑定的 `baselineRunId` 读取原始基线，不再用“时间上最近一次”近似归属；旧数据仍保留最近基线回退；
- `buildMentionDeltaAttribution`（确定性计算）：baselineMentionRate → retestMentionRate 的 `mentionRateDelta`、`newlyMentionedQuestions`（新增被提及）、`lostMentionQuestions`（失去提及），问题文本归一化（去标点/空白/大小写）后对比；
- `getGeoResearchRunDetails` 返回顶层 `mentionKpi`：普通 run 携带 mentionBaseline；post_publish_retest run 额外携带 mentionDelta 与 previousBaselineRun；
- 运行详情页新增两处展示：概要卡"目标提及率基线"（x% · n/N 个问题被 AI 提及）；复测 run 专属"提及率复测归因（发布后 KPI 闭环）"卡片（前次/本次提及率、增量涨跌着色、新增与失去提及问题清单、"差值由结构化基线确定性计算，不经 LLM"说明）。

**4. 编排周期升级（`runAutomaticGeoResearchOrchestration`）**

编排周期升级为三态：

1. **批准蓝图对应的发布批次已闭合，且从“蓝图批准/批次闭合”较晚时间起已过复测间隔（`GEO_RETEST_INTERVAL_DAYS`，默认 7 天），同时尚无相同蓝图+批次绑定的复测 run** → 排队 `post_publish_retest` run（status=queued_retest）；
2. **已有复测 run 且提及率低于蓝图 targetMentionRate**（未达标）→ 过复测间隔后自动触发 `manual_refresh` 新一轮调研（产出改进策略），间隔内保持 monitoring 并注明"等待复测间隔后触发下一轮"；
3. **达标或超周期前** → 维持原有 monitoring / 30 天周期行为。

约束保持：同一快照失败不自动重试（failedAgainstCurrentSnapshot 检查在前）；复测 run 以 `blueprintVersionId + batchKey + inputEvidenceHash` 显式绑定归属；幂等键绑定蓝图版本和发布批次，重复编排不重复建 run。批次优化快照存在 `P0` 或阻断动作时，先要求修复/补证/继续监控，不用新一轮内容调研掩盖根因。

## 三、闭环全景

```text
正常调研 run ──frontend_baseline──▶ mention_baseline（固化基线+channelCitationStats）
      │                                    │
      ▼                                    │
蓝图批准（retestBaseline.questions+targetMentionRate）
      │                                    │
      ▼                                    ▼
内容发布 ──存活与 AI 样本闭合批次──▶ 编排器（7天间隔）──▶ post_publish_retest（仅前台探针任务）
                                     │
                                     ▼
                          mention_delta 归因（新增/失去提及、提及率增量）
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
                 达标 → monitoring          未达标 → 新一轮 manual_refresh
                                                （策略迭代，闭环继续）
```

## 四、行为兼容性

- 未配置规则包 / 未运行复测时：mentionKpi 仅在有 frontend_baseline 产出时出现，复测归因卡片不渲染，编排行为与升级前一致；
- `post_publish_retest` 此前只是契约中的预留枚举（API 传入即原样落库但不生效），现在有完整语义与 fail-closed 门禁；手动通过 API 传 `triggerType: "post_publish_retest"` 同样走新链路；
- 普通调研保持既有 7 步任务图；`post_publish_retest` 使用仅含 `frontend_baseline` 的复测任务图，`geo_research_probe_set_snapshot` 表继续作为不可变持久层。

## 五、验证记录

| 命令 | 结果 |
|---|---|
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run validate:structure` | 536/536 通过 |
| `npm.cmd run test:v5-geo-research` | 14/14 |
| `npm.cmd run test:v5-geo-multi-search` | 20/20 |
| `node --loader ./workers/typescript-loader.mjs --test scripts/v5-geo-probe-compiler.test.mjs` | 4/4 |
| `node --loader ./workers/typescript-loader.mjs --test scripts/v5-geo-result-pack.test.mjs` | 4/4（新增复测探针集覆盖测试：P0 探针重建、哈希重算、空问题集抛错） |

## 六、遗留到后续阶段

- M9（P3）：就绪检查微调——`targetChannels` 非空时校验对应渠道规则包已激活，缺包 blocked（fail-closed）。

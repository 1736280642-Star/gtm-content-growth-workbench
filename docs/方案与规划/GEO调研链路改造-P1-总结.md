# GEO 调研链路改造 P1 阶段总结

> 阶段范围：M4 任务指令扩展、M5 双轨校验重构、M6 实体命名表
> 完成日期：2026-08-19
> 验证结果：`npm.cmd run typecheck` 通过；`npm.cmd run validate:structure` 535/535 通过；GEO 相关测试套件全绿（foundation 14、multi-search 20、probe-compiler 4、result-pack 2、source-quality 4、product-strategy 15、parallel-geo-monitoring 10、website-geo-closed-loop 3）

## 一、本阶段目标回顾

P1 是"指令与门禁"阶段：让 LLM 的任务指令产出新结构（faqBoard / selectionAlternatives / platformStrategy 等），并用**双轨门禁**守住信任边界——硬门禁 fail-closed 保实体信任，软门禁标注不拦截保策略灵活性。

## 二、完成内容

### M4 任务指令扩展（[geo-research-provider.ts](../../src/lib/v5/geo-research-provider.ts) `taskInstruction`）

| 任务 | 新增输出契约 |
|---|---|
| `live_question_discovery` | questions 增加 `faqBoard`（从规则包板块枚举映射，无规则包时为 uncategorized）、`misconception`（误区型问题必须引用证明误区存在的来源）、`quantifiableAnswer`（仅公开证据支持数字表述时为 true）；40 条上限与分片合并不变 |
| `live_competitor_discovery` | 新增 `selectionAlternatives[]`（开源自建/其他厂商，entityClassification=category_related，需显式替代决策证据）；新增 `comparisonDimensionEvidence[]`（按规则包维度标注 available/partial/missing）；verified_competitor 硬规则不变 |
| `frontend_baseline` | aggregate 增加 `channelCitationStats[]`（channelKey / citedUrlCount / citedUrlShare / dominantContentTypes）——**KPI 归因核心数据**：被 AI 引用的 URL 有多少落在治理平台上 |
| `blueprint_synthesis` | 新增第 8 模块 `platformStrategy[]`（channelKey/objective/suitableArticleTypes/structureRequirements/titlePatterns/ctaVariantRef/authorAccountPolicy/hypothesis/evidenceBasis）；新增 `contentClusterPlan[]`（内链集群，每个文章类型恰好归一个集群）；articleTypes 增加 `expectedMentionRationale`（必须说明凭什么能提升提及率）与 `retestProbeRefs`（指向 retestBaseline 问题） |

指令层同时注入渠道上下文：faqBoards 枚举、comparisonDimensions 枚举、治理渠道 channelKeys 列表与"携带 channelKey 的候选是平台活体收录样本"的语义说明。

### M5 双轨校验重构（[geo-research-provider.ts](../../src/lib/v5/geo-research-provider.ts) `enforceTaskEntityRules`、[geo-evidence-verifier.ts](../../src/lib/v5/geo-evidence-verifier.ts)）

**硬门禁（信任，fail-closed）：**

- 实体命名校验：`live_competitor_discovery` 与 `blueprint_synthesis` 输出的实体名称字段（competitors / selectionAlternatives / articleTypes / competitorLandscape 内嵌集合）必须通过命名表校验，混入生造复合实体名（如"品牌方+产品名"拼接但不在别名集合）直接抛 422 `geo_entity_naming_violation`——生造复合名会让 AI 实体确权失败，是信任类问题；
- 数据级修正：竞品/选型替代名称等于目标产品自身规范名的条目直接删除（实体混淆）；
- 编造渠道：platformStrategy 引用不存在的治理 channelKey 属信任类，数据级删除。

**软门禁（质量，标注不拦截）：**

- 平台声明挂靠：platformStrategy 的 evidenceBasis 无 candidateIds 且无 sourceUrls 支撑时标 `hypothesis=true`，保留不拦截；引用修剪后支撑被清空同样降级为 hypothesis；
- 量化数字门禁：articleTypes.definition 与 platformStrategy.objective 中含无证据挂靠的成效数字（%/倍）句子自动转入 `evidenceRequirements.claimsRequiringEvidence`，去重合并不拦截。

**引用修剪扩展（`pruneGeoResearchCitations`）：**

- 顶层 `selectionAlternatives[]`：无合法引用即删除（与竞品同规则）；
- 顶层与 competitorLandscape 内嵌 `comparisonDimensionEvidence[]`：修剪 URL，available 但引用清空降级为 missing（软修正不删条目）；
- `platformStrategy[].evidenceBasis.sourceUrls`：修剪，清空后无 candidateIds 支撑则 hypothesis=true。

### M6 实体命名表（[geo-product-identity.ts](../../src/lib/v5/geo-product-identity.ts)）

- `deriveEntityNamingStandard(identity)`：由身份卡**确定性派生**（代码生成、不进 prompt）——canonicalNames = 产品名/显示名/别名 + 品牌名/官方主体/服务商名；forbiddenPatterns = 角色名×产品名的拼接/空格组合（不在别名集合内），上限 24 条；
- `findEntityNamingViolations(names, standard)`：精确匹配违规（归一化空格、大小写不敏感），空数组=通过；作为 M5 硬校验依据，后续亦作下游内容生成术语表。

## 三、行为兼容性

- 未配置 `GEO_CHANNEL_RULE_PACK_JSON` 时：faqBoardEnum/comparisonDimensionEnum/platformGuidance 均为空串，指令新增字段照常要求（LLM 输出空值不触发校验），实体命名硬校验与数字软门禁**始终生效**（不依赖规则包）；
- 配置后：faqBoard 按规则包板块映射、comparisonDimensionEvidence 按规则包维度评分、platformStrategy 只允许治理渠道；
- 既有硬门禁（URL 白名单、缺引用拦截、verified_competitor 规则）全部保持不动。

## 四、验证记录

| 命令 | 结果 |
|---|---|
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run validate:structure` | 535/535 通过 |
| `npm.cmd run test:v5-geo-research` | 14/14 |
| `npm.cmd run test:v5-geo-multi-search` | 20/20（含补充轮定向、引用修剪、实体拆分回归） |
| `npm.cmd run test:v5-geo-probe-compiler` | 4/4 |
| `npm.cmd run test:v5-geo-result-pack`（result-pack 为探针快照套件） | 2/2 |
| `npm.cmd run test:v5-geo-source-quality` | 4/4 |
| `npm.cmd run test:v5-product-strategy` | 15/15 |
| `npm.cmd run test:v5-parallel-geo-monitoring` | 10/10 |
| `npm.cmd run test:v5-website-geo-closed-loop` | 3/3 |

## 五、遗留到后续阶段

- M7：下游候选扩展——result pack / 策略包把 faqBoard、channelDistribution、contentCluster 下沉给内容生成与月度策略；
- M8：提及率 KPI 闭环——mention_baseline 快照 + post_publish_retest 激活，channelCitationStats 进入归因；
- M9：就绪检查微调——渠道规则包配置校验纳入 readiness。

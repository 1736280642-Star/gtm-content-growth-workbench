# GEO 调研链路修改方案

> 状态：已完成并于 2026-08-20 完成一致性整改（P0 → P3 全部落地，阶段总结见 `GEO调研链路改造-P{N}-总结.md`，整改结论见 `GEO调研链路改造-2026-08-20-整改总结.md`）
> 范围：`src/lib/v5/geo-*`、`workers/geo-research-worker.mjs` 及相关契约
> 制定日期：2026-08-19

## 一、背景与目标

### 1.1 唯一推广目的（公理）

工作台的唯一推广目的：**提升品牌/产品的 AI 提及率**。获客是提及率提升的下游结果。因此：

- `targetMentionRate` 不是七个任务里的普通指标，而是**整个系统的唯一 KPI**；
- 复测提及率 delta 是**唯一质量裁判**：前置门禁只拦"撒谎"，质量交给闭环数据。

### 1.2 现状差距

当前链路（`context_validation → research_planning → live_question_discovery / live_competitor_discovery → frontend_baseline → evidence_alignment → blueprint_synthesis`）是"产品身份中心"的，缺失三大能力：

| 差距 | 说明 |
|---|---|
| 平台收录格局未被调研 | 查询词全部开放式全网查询，无 `site:` 类平台约束查询；候选来源不识别目标平台域名 |
| 分内容类型的证据采集缺失 | 复盘类要踩坑+量化数据、对比类要开源替代、FAQ 类要误区——查询意图不区分内容类型证据需求 |
| 综合输出 schema 不支撑编排 | 蓝图无平台策略模块、无实体术语表、无内容集群计划 |

### 1.3 设计约束（不可违背）

- 领域代码不硬编码产品名、平台规则、CTA 文案、服务 URL（AGENTS.md 规则 8）——平台规则走**受治理的渠道规则包配置**；
- Agent 输出不能创建人工批准或激活规则包（AGENTS.md 规则 4）；
- 写操作要求幂等、乐观并发、执行者身份、审计原因、来源可追溯（AGENTS.md 规则 6）。

## 二、双轨门禁原则

| 轨道 | 管什么 | 处置 |
|---|---|---|
| **硬门禁（信任，fail-closed）** | 编造引用（URL 不在本次证据包内）、实体混淆（同名≠同实体）、单源证据（<2 家 Provider / <2 个独立来源）、混用实体名称 | 命中即拦截重试 |
| **软处理（质量，标注不拦截）** | 平台证据不足、成效数字无公开来源、大胆策略假设 | 降级为标注（`hypothesis` / `claimsRequiringEvidence` / 复测探针），放行交给 30 天 delta 裁判 |

分工总原则：**代码判"对错"（信任与计分），模型产"好坏"（归因与策略），人工定"批准"（治理与担责）**。

## 三、修改模块清单（M1–M9）

### M1. 渠道规则包（P0，新增）

新文件 `src/lib/v5/geo-channel-rule-pack.ts`：

- `GeoChannelRulePack` 契约：`channels[]` 含 `channelKey / domains / inclusionPatterns / structureRequirements / comparisonDimensions / ctaVariantRefs / authorAccountPolicy / evidenceCandidateIds`；
- 规则包为受治理配置（版本化、人工激活），**域名与文案不进领域代码**；
- 初期实现为环境变量驱动的内置默认包 + 读取接口 `getActiveGeoChannelRulePack()`，后续接入治理存储表。

### M2. 查询编译器扩展（P0）

文件：`geo-product-identity.ts`、`geo-search-contracts.ts`。

1. `GeoSearchQuery` 增加 `channelKey?: string`；
2. 新增五类查询意图（expectedEvidenceRole）：
   - `platform_inclusion_landscape` — 平台收录格局（`site:{domain}` 约束查询）
   - `pitfall_evidence` — 踩坑/失败教训（复盘类原料）
   - `selection_alternative` — 开源自建/其他厂商替代（对比类原料）
   - `metric_benchmark` — 量化成效基准（复盘/场景类原料）
   - `misconception` — 采购/落地误区（FAQ 类原料）
3. 核心查询预算上限为 6 条；目标第三方渠道的 `site:` 查询使用独立预算，每个目标渠道至少一条，避免被核心查询截断；
4. 补充轮从固定后缀改为**按证据缺口定向**（缺平台证据补 `site:` 查询、缺独立来源补变体查询）；
5. `stopCondition` 支持按 channelKey 表达平台级停止条件。

### M3. 平台打标（P0）

文件：`geo-search-adapters.ts`。

- `sourceClassification` 增加：域名命中渠道规则包 → 候选携带 `channelKey`（authority 分级不变）；
- `mergeCandidates` 合并时保留 channelKey 并集；
- `MultiSearchEvidencePack` 新增 `channelStats`（各平台的候选数/通过实体校验数）——"各平台在收录什么"的原始答案。

### M4. 任务指令扩展（P1）

文件：`geo-research-provider.ts` 的 `taskInstruction`。

| 任务 | 改动 |
|---|---|
| `live_question_discovery` | questions 增加 `faqBoard`（映射规则包板块）、`misconception`（误区型须引用证明误区存在的来源）、`quantifiableAnswer`；40 条上限与分片合并不变 |
| `live_competitor_discovery` | 新增输出 `selectionAlternatives[]`（开源自建/其他厂商，走 category_related 分类但显式输出）；新增 `comparisonDimensionEvidence`（按规则包维度标注证据有无）；verified_competitor 硬规则不变 |
| `frontend_baseline` | aggregate 增加 `channelCitationStats`（被引 URL 平台占比+内容类型分布）——KPI 归因核心数据 |
| `blueprint_synthesis` | 新增第 8 模块 `platformStrategy`（每渠道 objective/suitableArticleTypes/structureRequirements/titlePatterns/ctaVariantRef/evidenceBasis）；新增 `contentClusterPlan`（内链集群）；articleType 增加 `expectedMentionRationale` 与 `retestProbeRefs` |

### M5. 双轨校验重构（P1）

文件：`geo-evidence-verifier.ts`、`geo-research-provider.ts`。

- 保持现有硬门禁不动（URL 白名单、缺引用拦截）；
- **新增硬校验：实体命名**——`blueprint_synthesis` 输出中实体表述必须属于命名表派生集合，混用简称/生造复合实体名直接拦截；
- **新增软校验：平台声明挂靠**——platformStrategy 声明须引用带该 channelKey 的候选，否则标 `hypothesis: true`，不拦截；
- **新增软校验：量化数字门禁**——蓝图中无证据引用的成效数字自动移入 `claimsRequiringEvidence`，不拦截；
- `pruneGeoResearchCitations` 的集合处理扩展覆盖 `platformStrategy[].evidenceBasis`、`selectionAlternatives[].sourceUrls`。

### M6. 实体命名表（P1，确定性派生）

文件：`geo-product-identity.ts` 新增 `deriveEntityNamingStandard(identity)`：

- `canonicalNames[]`：允许出现的全部规范表述（由身份卡确定性派生）；
- `forbiddenPatterns[]`：禁止的拼接/简称变体；
- 代码生成、不进 prompt、LLM 只能引用不能发明；同时作为 M5 校验依据和下游内容生成术语表。

### M7. 下游候选扩展（P2）

文件：`geo-research-downstream.ts`。

- `questionPool` 候选携带 `faqBoard`；
- `strategyPack` 候选携带 `channelDistribution`；
- 新增 `contentCluster` 候选（内链集群）；
- `monitoring` 候选与蓝图 retestProbes 对齐；
- 全部维持 `humanApprovalRequired: true` 不变。

### M8. 提及率 KPI 闭环（P2，核心增量）

文件：`geo-research-service.ts`、`geo-research-repository.ts`、worker。

1. `geo_research_run` 新增 `mention_baseline`（JSON：真实逐 Provider 观测推导的 targetMentionRate + channelCitationStats + providerBreakdown + measurementSource），DB 迁移；
2. 激活已预留的 `post_publish_retest` 触发类型：复测 run 探针集从批准蓝图 `retestBaseline.questions` 编译，且必须绑定已闭合发布批次；复测只执行 `frontend_baseline` 单任务并产出 `mention_delta` 归因；
3. `runAutomaticGeoResearchOrchestration` 仅在发布批次闭合且达到复测间隔后触发复测；未达标时先服从批次优化快照中的 P0/阻断动作，无根因阻断才触发下一轮调研；
4. 同一快照失败不自动重试的规则不变。

### M9. 就绪检查微调（P3）

文件：`geo-research-service.ts`。

- 五项检查结构不变；
- `targetChannels` 含第三方渠道时，在就绪检查与 run 创建写路径双重校验对应渠道规则包已激活且覆盖，缺包/激活元数据无效均 blocked（fail-closed）。

## 四、契约与数据库变更汇总

| 位置 | 变更 |
|---|---|
| `geo-search-contracts.ts` | `GeoSearchQuery + channelKey`；`GeoSearchEvidenceCandidate + channelKey`；`MultiSearchEvidencePack + channelStats` |
| `geo-research-contracts.ts` | 蓝图 JSON 列扩展（platformStrategy/entityNamingStandard/contentClusterPlan），无表迁移 |
| DB 迁移 | `geo_research_run + mention_baseline JSON` |
| 新文件 | `geo-channel-rule-pack.ts` |

## 五、不动清单（明确保护）

- 普通调研的 `RESEARCH_TASK_GRAPH` 七步依赖；复测使用独立单任务图，避免重复生成蓝图和递归复测；
- 三家交叉验证门禁（≥2 Provider + ≥2 独立来源）、禁止模型记忆替代；
- 实体消歧"名称≠身份"、≥2 非名称锚点；
- `claimAssessment` 硬校验与引用白名单修剪；
- 人工批准闸门（四角色）、问题池导入四重门禁；
- worker 租约/幂等/乐观并发模型。

## 六、实施顺序与验证

| 阶段 | 内容 | 验证 |
|---|---|---|
| P0 | M1 渠道规则包、M2 查询编译器、M3 平台打标 | `npm.cmd run typecheck` + `npm.cmd run validate:structure` + geo 相关测试 |
| P1 | M4 指令扩展、M5 双轨校验、M6 命名表 | 同上 |
| P2 | M7 下游候选、M8 KPI 闭环 | 同上 + DB 迁移 |
| P3 | M9 就绪检查 | 同上 |

每阶段完成后在 `docs/方案与规划/` 落一份阶段总结（`GEO调研链路改造-P{N}-总结.md`）。

## 七、链路逻辑图（文字版）

```text
公理：唯一目的 = 提升 AI 提及率（KPI = 裁判）
  ↓
输入层：官网身份解析(代码) × 研究边界(人工:市场/语言/渠道) × 知识配置(渠道规则包/内容类型库)
  ↓
流水线（7 步任务图不变）：
  1 就绪检查(代码) → 2 查询编译(代码,身份×内容类型×平台) → 3 三源联网搜索(代码,智谱/豆包/千问)
  → 4 实体消歧(模型+代码) → 5 三大发现(模型,含提及基线=KPI计分) → 6 归因分析(模型) → 7 策略综合(模型)
  ↓
双轨门禁：硬(信任:fail-closed) | 软(质量:标注放行)
  ↓
人工闸门(批准/担责) → GEO 内容策略蓝图(文章类型×平台×结构+术语表+集群+复测探针)
  ↓
内容生产·发布·批次存活/AI 样本闭合·按间隔复测提及率 delta
  ↓ (紫色回流线)
delta 达标→放大 | 未达→归因修正 | 差距→驱动下一轮调研
```

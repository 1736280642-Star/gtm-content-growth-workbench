# V5 真实 RAG 知识库与内容生产稳定链路开发接入方案

版本：v1.0.0

日期：2026-07-16

状态：待开发
目标：一次开发完成可长期运行、可版本化、可回滚、可评测的 V5 真实知识检索与正文生产链路，不建设过渡版或伪 RAG。

## 1. 结论

V5 最终生产链路必须严格实现：

```text
真实来源快照
-> 第二阶段知识治理与 ragIngestionManifest
-> Claim 感知 Chunk
-> 分产品、分权限、分版本的生产索引
-> 月度矩阵 EvidencePreview
-> 平台表达和标题确认
-> 月度矩阵人工批准与任务冻结
-> Final EvidencePack
-> Prompt + 产品规则包 + 渠道规则正文生成
-> 事实、边界和自然表达质检
-> 草稿人工确认
```

正文模型不得直接访问全库，不得使用 EvidencePreview 生成正式正文，不得由调用方提交任意 EvidencePack，不得在材料不足时使用模型常识补产品能力、案例、场景、实现步骤或结果。

本方案以 `D:/GTM/工作台/docs/V5 07-07/agent-knowledge-base-foundation/03-再设计RAG优化策略` 全部 7 份文档为 RAG 架构真源。

## 2. 本次固定知识来源

### 2.1 Pharaoh Command 官网

```text
D:/GTM/工作台/保存/command.jotoai.com-2026-07-07-xcrawl
```

盘点结果：9 个页面，11 个 Markdown 文件。

准入策略：

- `pages/006-page-6.md`：产品首页，`official_product_page`，默认 A2。
- `pages/001-005-solutions-*.md`：行业方案页，分别切成独立场景与能力 Claim，默认 A2。
- `pages/008-terms-html.md`、`pages/009-privacy-html.md`：正式条款与隐私来源，默认 A1，用于限制、权限、部署和数据边界。
- `pages/007-register.md`：注册页面，不进入内容生产索引。
- `combined.md`：聚合重复文件，不作为独立 SourceAsset。
- `raw/`、`source-maps/`、`coverage-notes.md`、`urls.json`、`manifest.json`：仅作抓取、审计和原始资产追溯。

### 2.2 Noteflow 官网与历史博客

```text
D:/GTM/工作台/保存/note.jotoai.com-2026-07-09-xcrawl
```

盘点结果：301 个公开 URL，8 个普通页面、293 篇博客，Markdown 共 305 个。

准入策略：

- `public-rendered-full/pages/`：产品、功能、隐私、企业能力等正式页面，默认 A1/A2，根据页面类型确认。
- `public-rendered-full/blog/`：历史博客，默认 B2；优先服务 `context_chunk`、`scenario`、`faq`、`industry_background` 和 `change_history`，不能单独证明当前产品能力、规划状态、隐私边界和性能结果。
- 隐私政策与产品页出现冲突时，建立 `conflictGroupId`，采用更保守口径；未裁决前相关强表达进入 `needs_review/blocked`。
- `Noteflow：终于有一个 AI 知识库，能把你的资料真正用起来了.md`：来源身份未在抓取 Manifest 中确认，默认进入 `governance_preview`，人工确认来源与版本后再决定是否准入。
- `combined.md`、Playwright 原始 HTML/Text、sitemap 样本、列表和 Manifest 不作为独立生产 Chunk。

### 2.3 唯客 AI 护栏官网与安全文章

```text
D:/GTM/工作台/保存/sec.jotoai.com-2026-07-07-xcrawl
```

盘点结果：317 个正文页面，5 个普通页面、312 篇文章，Markdown 共 319 个。

准入策略：

- `public-html-full/pages/`：产品定义、功能、部署、隐私、版本等正式页面，默认 A1/A2。
- `public-html-full/articles/`：默认 B2，并优先标记为 `industry_background`、`scenario`、`faq` 或安全知识；文章中的行业攻击类型、法规和风险不能自动生成唯客产品能力 Claim。
- 提示词攻击、PII、恶意链接、Dify 集成、延迟和检测效果等产品能力，只能使用明确绑定唯客产品的正式 Claim。
- 未附测试环境的延迟、检出率、误报率、客户数量和绝对安全口径禁止进入生产 Claim。
- `combined.md`、raw HTML、列表页、抓取说明和 Manifest 只作审计与原始资产引用。

### 2.4 JOTO / Pharaoh Command 微信公众号历史文章

```text
D:/GTM/工作台/保存/wechat-joto-pharaoh-command-2026-07-09
```

盘点结果：Manifest 中确认抓取 3 篇 JOTO / Pharaoh Command 文章；目录另含二次改写稿、图片和视频资产。

准入策略：

- `01.md`、`02.md`、`03.md`：正式抓取文章，类型为 `official_channel_history`，默认 B2，可服务场景、用户问题、品牌表达和渠道历史。
- 微信文章不能单独证明当前产品能力、性能、兼容范围、客户效果和数据边界；相关事实必须回到官网 Claim。
- `04-new-angle-ai-netops-system.md`、`article.md`、`article.cleaned.md`：二次创作或加工稿，默认进入 `governance_preview`，不得自动进入 `production_public`。
- `coverage-notes.md`、`video-index.md`、Manifest、图片、视频、海报和 contact sheets 不进入正文文本索引；媒体资产只保留关系和后续配图用途。

## 3. 来源权威与使用策略

| 来源类型 | 默认等级 | 可支撑内容 | 禁止直接支撑 |
| --- | --- | --- | --- |
| 正式隐私、条款、部署政策 | A1 | 权限、数据流、隐私、部署和限制 | 营销效果与行业趋势 |
| 正式产品页、功能页、方案页 | A2 | 产品定义、当前能力、场景、CTA | 未说明条件的性能与客户结果 |
| 官方历史博客/安全文章 | B2 | 背景、FAQ、场景、问题、变化历史 | 当前产品能力、绝对效果、隐私承诺 |
| 官方公众号历史文章 | B2 | 场景、品牌表达、用户问题、渠道历史 | 当前能力和效果的唯一证据 |
| 本地二次改写稿 | C/治理预览 | 表达参考、Badcase、Prompt 评测 | 生产事实与公开引用 |
| 抓取元数据与原始 HTML | 审计资产 | SourceRevision 追溯 | 独立检索结果 |

所有等级必须经过第二阶段治理确认，表中仅为导入默认值，不自动授予生产资格。

## 4. 最终职责边界

### 第二阶段知识治理

负责：

- SourceAsset、SourceRevision 和产品实体确认。
- DocumentType、AuthorityLevel、LifecycleStatus、Visibility 和安全分类。
- ProductClaim 提取、冲突识别、人工确认与规则包激活。
- 生成唯一 `ragIngestionManifest`。

不负责检索排序和正文生成。

### 第三阶段 RAG

负责：

- 消费 Manifest。
- Claim 感知切片。
- 索引构建、评测、激活、失效与回滚。
- 检索路由、硬过滤、混合召回、重排和多样性。
- EvidencePreview 与 Final EvidencePack。
- Evidence Gate、运行监控和 Badcase。

不重新裁决 Claim，不修改产品规则包，不生成正式正文。

### 第四阶段正文生产

负责：

- 消费冻结任务、平台表达快照、规则包快照和 Final EvidencePack。
- 执行 6 类公众号 Prompt。
- 生成结构化正文、事实追溯、硬规则与软质量结果。

不得重新全库检索，不得使用 EvidencePreview 或随机 Top-K，不得修改事实状态和证据等级。

## 5. 目标七层架构

```text
1. Manifest 准入层
2. Claim 感知加工层
3. 版本化索引层
4. 任务检索路由层
5. 混合召回与规则重排层
6. EvidencePreview / Final EvidencePack 组装层
7. 评测、监控与 Badcase 治理层
```

### 5.1 存储与基础设施决策

为保证一次建设后稳定运行，正式方案采用：

- MySQL：治理真源、Manifest、Source/Claim、索引快照、路由、运行记录、EvidencePack、评测和审计。
- OpenSearch：版本化 BM25、向量 kNN、标签、结构化过滤和关系字段检索。每个 IndexSnapshot 对应不可变索引或别名版本。
- 本地/对象存储：原始 HTML、渲染文本、规范 Markdown 和其他 RawAsset；数据库只保存不可变引用、Hash 和定位。
- 现有 AI Provider Embedding：只使用真实向量；记录 Provider、Model、维度、规范化版本和时间。
- MySQL 持久任务队列：索引构建、Embedding、去重、评测和全量重建使用带租约的后台 Job，不依赖 Next.js 请求生命周期。

不采用：

- JSON 文件作为正式索引真源。
- Hash/Fallback 向量。
- 只用向量 Top-K。
- 由 LLM Reranker 绕过权限、产品、状态和冲突硬过滤。

## 6. 核心数据模型

### 6.1 第二阶段交接

新增 `rag_ingestion_manifest`：

```text
manifest_id
product_id
knowledge_base_ids
active_rule_package_version_id
approved_source_revision_ids
approved_claim_ids
blocked_claim_ids
unresolved_conflict_ids
authority_policy_version
monthly_production_readiness_id
matrix_scope_version
manifest_hash
status
generated_at
```

### 6.2 索引与 Chunk

新增：

- `rag_index_snapshot`
- `rag_knowledge_chunk`
- `rag_chunk_relation`
- `rag_chunk_embedding`
- `rag_index_job`
- `rag_index_activation`

Chunk 类型：

- `source_parent`
- `claim_chunk`
- `context_chunk`
- `official_citation`
- `limitation_chunk`

生产 Chunk 必须包含：

```text
indexSnapshotId
namespace
productId/productName
knowledgeBaseIds
sourceId/sourceRevisionId
parentChunkId
primaryClaimId/claimIds
sourceLocator
semanticType
chunkTitle/summary/content/originalQuote
documentType/authorityLevel
lifecycleStatus/visibility
supportMode/claimScope/capabilityStatus
conditions/limitations
scenario/capability/audience/problem/channel tags
distilledTermIds/questionCandidateIds
conflictGroupIds
contentHash/semanticHash/duplicateClusterId
status/chunkerVersion
```

### 6.3 检索、Preview 与 Pack

新增：

- `retrieval_route`
- `retrieval_request`
- `retrieval_run`
- `retrieval_candidate`
- `evidence_preview`
- `evidence_preview_item`
- `evidence_gate_run`
- `final_evidence_pack_version`
- `final_evidence_pack_item`

扩展当前 `final_evidence_pack`，增加：

```text
monthly_plan_id
matrix_version_id
matrix_item_id
retrieval_run_id
index_snapshot_ids
route_id/route_version
retrieval_policy_version
embedding_provider/model
reranker_model
task_snapshot
governance_snapshot
retrieval_snapshot
claim_plan
evidence_groups
decision
source_snapshot_hash
supersedes_pack_id
invalidated_at/invalidation_reason
```

### 6.4 评测与反馈

新增：

- `rag_evaluation_case`
- `rag_evaluation_run`
- `rag_evaluation_result`
- `rag_badcase`
- `rag_human_evidence_feedback`

反馈必须绑定：

```text
retrievalRequestId
evidencePreviewId/finalEvidencePackId
chunkId
claimId
feedbackType
actor/reason
```

## 7. Manifest 与索引生命周期

生产唯一入口为 `ragIngestionManifest`。未进入 Manifest 的文件即使存在于四个目录，也不能进入 `production_public`。

命名空间：

- `production_public`
- `production_internal`
- `governance_preview`
- `evaluation_sandbox`
- `isolated`

索引分区键：

```text
namespace + productId + language + indexVersion
```

`IndexSnapshot` 状态：

```text
pending_config
-> building
-> validating
-> ready
-> active
-> superseded / rollback_target / archived
```

只有 `active` Snapshot 能生成正式 EvidencePack。

下列事件立即让旧 Chunk 停止生产命中：

- 来源隔离、过期或删除授权。
- Claim 被拒绝、替代或进入阻断冲突。
- 规则包回滚。
- visibility 从 public 降级。
- 产品实体或版本发生实质变化。

先从生产路由排除，再异步重建，不能等待新索引完成后才停止错误内容。

## 8. Claim 感知切片

切片顺序严格采用：

```text
章节结构
-> Claim 边界
-> 条件与限制
-> FAQ/案例完整性
-> 长度控制
```

以下信息不能分开：

- 数字与测试环境、样本和时间。
- 案例结果与授权、匿名范围和实施条件。
- 私有部署与外部依赖、数据路径。
- 自动执行与权限、审批和回滚。
- 合规帮助与不能替代法律判断的限制。

切片后自动检查：

- 产品、Claim、原文定位缺失。
- 规划或 Beta 状态丢失。
- 数字没有条件。
- 行业背景被标为产品能力。
- 限制 Claim 未关联能力。
- 重复、过长、过短或模板污染。

问题 Chunk 进入 `review_required`，不进入生产索引。

## 9. 检索路由与内容类型证据槽位

检索请求必须来自已经冻结或正在审核的月度矩阵对象，不允许检索器重新决定产品、标题、渠道和蒸馏词。

### 9.1 公众号六类路由

| platformContentType | 必需语义类型/证据槽位 | 重点排除 |
| --- | --- | --- |
| `explicit_product_intro` | 产品定义、用户问题、场景、能力、限制、官方引用 | 历史博客单独证明能力、无证据效果 |
| `explicit_launch_matrix` | release/change_history、当前状态、矩阵分工、限制、官方引用 | 未确认规划、普通产品页冒充发布记录 |
| `implicit_personal_review` | 真实作者、过程、环境、结果、不足、授权 | 产品资料改写成“我体验过” |
| `implicit_painpoint_education` | user_problem、scenario、capability、limitation、官方引用 | 无产品绑定行业文章、虚构案例 |
| `implicit_tool_guide` | capability、integration/deployment/faq、步骤依据、limitation | 根据能力名推断按钮、接口和步骤 |
| `implicit_trend_judgment` | industry_background、变化证据、产品定义、当前能力、限制 | 单一产品发布推导行业必然 |

个人体验和新品发布在当前四个知识源中若缺真实体验/发布证据，应稳定返回 `needs_material`，不能为了凑齐六类而生成。

### 9.2 产品路由保护

Pharaoh Command：

- 行业方案按教育、企业 IT、零售、医疗、MSP 分开。
- 自动执行强制补权限、审批和回滚限制。
- 微信文章提供场景和表达历史，产品能力回到官网 Claim。

Noteflow：

- 正式 pages 优先于 293 篇博客。
- 规划功能进入 `planned/change_history`，不进入当前能力路由。
- 隐私查询强制同时召回官方隐私政策和产品声明。

唯客 AI 护栏：

- 312 篇安全文章默认是行业背景。
- 产品检测能力必须使用产品 Claim。
- 延迟、检出率、PII 数量、Dify 集成范围强制要求版本或评测证据。

## 10. 硬过滤、混合召回与重排

### 10.1 硬过滤优先

相似度计算前完成：

1. namespace 与调用权限匹配。
2. productId 匹配；普通任务禁止跨产品。
3. Chunk `status=active`。
4. visibility 不越权。
5. lifecycleStatus 与任务一致。
6. Claim 不在 blocked 或阻断冲突。
7. rulePackageVersion 与任务一致。
8. validFrom/validUntil 有效。
9. 产品定义和能力任务排除无产品绑定背景文章。

权限、产品、状态和冲突不能使用降权代替排除。

### 10.2 四路召回

```text
BM25 Keyword
+ Vector kNN
+ Tag/Entity/Claim Relation
+ Rule-required Evidence
```

初始候选池：

```text
BM25 30
+ Vector 30
+ Tag/Entity 20
+ Rule-required 10
-> RRF 融合
-> 规则重排 Top 20
-> 多样性和证据槽位选择
```

数字为初始参数，必须由固定评测集校准。

### 10.3 重排因素

```text
相关性
+ 实体匹配
+ 路由匹配
+ 来源权威
+ Claim 支持度
+ 新鲜度
+ 官方引用加分
+ 限制覆盖加分
- 重复、低权威、过期和风险惩罚
```

限制、条件和官方引用使用规则强制补取，不依赖自然相似度。

### 10.4 多样性

- 同一 duplicateCluster 默认最多 1 条。
- 同一来源页默认最多 2–3 条，除非承担不同槽位。
- 正式产品页、限制、场景、FAQ、案例分别设配额。
- Noteflow 博客和唯客行业文章不得占满 Top-K。
- 跨产品任务每个产品独立配额与 ClaimPlan。

## 11. EvidencePreview 与 Final EvidencePack

### 11.1 EvidencePreview

生成时点：月度策略已批准并生成矩阵草稿后，月度矩阵人工审核前。

输出：

- 可用核心 Claim。
- 可证明角度。
- 需要带条件的能力。
- 官方引用。
- 禁止用于标题的数字、案例和强主张。
- 证据缺口、冲突与配置状态。

状态：

```text
preview_ready
needs_material
needs_review
blocked
pending_config
```

EvidencePreview 只服务标题、内容类型、平台表达准备和三项检查，不授予正文生成权限。

### 11.2 Final EvidencePack

生成前提：月度矩阵人工批准，ContentMatrixItem 已形成冻结任务。

组成：

- taskSnapshot
- governanceSnapshot
- retrievalSnapshot
- claimPlan
- evidenceGroups
- gaps/conflicts/outdatedEvidence/unverifiedClaims
- decision

EvidenceItem 必须包含：

```text
chunkId
primaryClaimId/claimIds
sourceId/sourceRevisionId/sourceLocator
title/summary/originalQuote/canonicalUrl
documentType/authorityLevel/supportMode/claimScope/status/version
conditions/limitations/validity
selectionReason
allowedUsage/forbiddenUsage
```

决策状态：

- `generatable`
- `generatable_with_downgrade`
- `needs_material`
- `needs_review`
- `blocked`
- `pending_config`

生成许可按 ClaimPlan 的必需证据槽位判断，不按 Chunk 数量判断。

## 12. 正文生产接入

生产接口：

```text
POST /api/v5/content-tasks/:taskId/generate
```

接口只接收任务 ID、幂等键、操作者和审计原因。服务端执行：

```text
读取 FrozenContentTask
-> 读取 task.finalEvidencePackId
-> 校验 Pack 状态、版本、规则包、索引快照和失效状态
-> 读取 PromptGroupVersion、平台表达快照、规则包快照、渠道规则
-> 形成不可变 GenerationInput
-> 调用真实 Provider
-> 事实追溯、硬规则和软质量检查
-> 保存 DraftVersion
```

禁止：

- 前端提交完整 EvidencePack。
- 正文 Service 直接访问 OpenSearch。
- 使用 EvidencePreview 生成正式正文。
- Pack 为 `needs_material/needs_review/blocked/pending_config` 时调用模型。
- 修改标题或平台表达后继续使用旧 Pack。

## 13. API 与后台任务

### 索引治理

```text
POST /api/rag/manifests
POST /api/rag/index-snapshots
GET  /api/rag/index-snapshots/:id
POST /api/rag/index-snapshots/:id/validate
POST /api/rag/index-snapshots/:id/activate
POST /api/rag/index-snapshots/:id/rollback
```

### 检索与证据

```text
POST /api/rag/retrieve
POST /api/rag/evidence-previews
GET  /api/rag/evidence-previews/:id
POST /api/rag/evidence-packs
GET  /api/rag/evidence-packs/:id
POST /api/content-matrix/:id/evidence-gate
```

### 评测与 Badcase

```text
POST /api/rag/evaluation-runs
GET  /api/rag/evaluation-runs/:id
POST /api/rag/badcases
PATCH /api/rag/badcases/:id
POST /api/rag/evidence-feedback
```

后台任务：

- source normalization
- Claim-aware chunking
- keyword indexing
- embedding
- exact/near/semantic deduplication
- evaluation
- snapshot validation/activation/rollback
- evidence preview batch build
- final evidence pack build
- stale pack invalidation

任务状态统一：

```text
queued
running
pending_config
awaiting_validation
completed
partial_failed
failed
cancelled
```

## 14. 代码模块规划

建议新增：

```text
src/lib/v5/rag/
  contracts.ts
  source-registry.ts
  manifest-service.ts
  chunking-service.ts
  index-repository.ts
  opensearch-adapter.ts
  index-lifecycle-service.ts
  retrieval-route-registry.ts
  retrieval-service.ts
  rerank-service.ts
  evidence-preview-service.ts
  claim-plan-service.ts
  final-evidence-pack-service.ts
  evidence-gate-service.ts
  evaluation-service.ts
  badcase-service.ts
  permissions.ts

workers/
  rag-index-worker.mjs
  rag-evaluation-worker.mjs
  rag-evidence-worker.mjs
  rag-invalidation-worker.mjs
```

Repository 接口与 OpenSearch/MySQL 实现分离。业务 Service 不直接拼 SQL、OpenSearch DSL 或读取本地目录。

## 15. 开发执行顺序

### M0：契约、配置和基础设施

1. 新增 RAG 合同、错误码、权限和状态机。
2. 新增 MySQL migration。
3. 新增 OpenSearch 与真实 Embedding 配置诊断，缺失时 `pending_config`。
4. 建立 Job Worker、租约、重试、幂等和审计。

验收：基础设施配置状态真实；不读取或展示密钥；无配置不伪成功。

### M1：四目录来源注册与第二阶段准入

1. 建立 SourceRegistry，固化四个根目录、产品归属和默认资料类型。
2. 导入规范 Markdown，Raw/HTML/Manifest 只建立资产关系。
3. 生成 SourceAsset、SourceRevision、内容 Hash 和 canonical URL。
4. 执行资料分类、产品实体确认、Claim 提取、冲突识别和规则包关联。
5. 人工确认后生成 ragIngestionManifest。

验收：所有生产来源都能回到文件、URL 和修订；重复聚合稿不重复进入；公众号和历史文章不升级产品事实。

### M2：Claim 感知切片与生产索引

1. 按产品和语义类型切片。
2. 建立能力与限制、案例与范围、隐私声明与冲突关系。
3. 执行质量检查与重复聚类。
4. 建立五个命名空间。
5. 写入 BM25、向量和过滤索引。
6. 形成不可变 IndexSnapshot。

验收：Chunk 的 Claim 与原文定位完整率 100%；产品串库、规划误入和行业背景冒充能力为 0。

### M3：检索路由、混合召回与重排

1. 为任务意图和 6 类公众号内容建立 RetrievalRoute。
2. 实现硬过滤、四路召回、RRF、规则重排和来源配额。
3. 实现限制、父子上下文和官方引用强制补取。
4. 实现可解释 RetrievalRun。

验收：每次检索能复现索引、路由、候选、排除原因和最终选择。

### M4：EvidencePreview 与平台表达准备

1. 月度策略批准并形成矩阵草稿后批量生成 Preview。
2. Preview 驱动标题、内容类型、证据依据和三项前置检查。
3. 月度矩阵页面展示业务摘要和缺口；治理页展示 Chunk/Claim 详情。
4. Preview 更新导致平台表达重新确认。

验收：Preview 不进入正文；无可证明角度时矩阵项不能批准。

### M5：Final EvidencePack 与 Evidence Gate

1. 矩阵批准后形成 ClaimPlan。
2. 按最终标题和平台表达重新检索与组装。
3. 判断充分性、降级、冲突、配置缺失和权限。
4. 冻结 Pack 并写入正式 Evidence Gate。
5. 标题、任务、规则包、索引和权限变化触发 Pack 失效。

验收：非 generatable Pack 不能进入 BatchGenerationRun；任意 Pack 可完整复现。

### M6：正式正文生成接入

1. 新增正式 task generate API。
2. Generation Service 只通过 Pack ID 读取不可变快照。
3. 接入 6 类公众号 Prompt、产品规则包、ChannelRule 和 ProviderPolicy。
4. 增加事实引用、产品边界、自然表达和发布许可分层。

验收：正文中每个产品事实能追溯到 Pack；知识不足不生成；测试 Seed 不进入正式接口。

### M7：评测、监控、Badcase 与上线

1. 建立三个产品固定正向、边界和阻断样本。
2. 运行旧/新索引对比。
3. 未达标 Snapshot 不允许激活。
4. 记录人工替换、删除、补资料和取消生成。
5. Badcase 回到第二、三、四或第五阶段正确责任模块。

验收：安全、隔离和阻断指标单独达标，不被平均分掩盖。

## 16. 固定评测集

每个产品至少覆盖：

1. 产品定义。
2. 当前能力与规划能力。
3. 场景与限制。
4. 匿名案例。
5. 性能数字。
6. 隐私和数据流冲突。
7. 产品串库。
8. 低权威博客压过正式页面。
9. 官方引用。
10. 规则包回滚与索引失效。

微信公众号额外覆盖：

- 官网事实 + 微信场景组合。
- 微信旧稿中的夸大表达不能覆盖官网保守口径。
- 二次改写稿不能成为产品事实。
- 公众号痛点科普和产品介绍使用不同证据槽位。

## 17. 强制验收指标

| 指标 | 门槛 |
| --- | ---: |
| 未批准来源进入 production | 0 |
| 产品串库 | 0 |
| 权限越界召回 | 0 |
| blocked Claim 召回 | 0 |
| planned/beta 误作 current | 0 |
| Claim 与原文定位完整率 | 100% |
| 数字、案例范围和限制保留率 | 100% |
| 核心 Claim Recall@10 | >=95% |
| 条件能力限制召回率 | 100% |
| 官方引用需求命中率 | 100% |
| 同重复簇 Top-5 占位 | <=1 |
| Preview 风险提示准确率 | >=95% |
| Final EvidencePack 决策准确率 | >=95% |
| 阻断漏判 | 0 |

## 18. 端到端验收场景

至少使用 3 个真实月度矩阵项：

1. Pharaoh Command 公众号场景痛点科普：官网产品与方案页提供产品事实，微信历史文章仅提供场景与表达背景，限制证据必须包含权限、审批、兼容和回滚。
2. Noteflow 公众号工具方法指南：正式 pages 提供当前能力，博客提供背景和 FAQ，隐私/部署内容必须同时召回限制，规划能力不得进入步骤。
3. 唯客 AI 护栏公众号显性产品介绍：产品 pages 提供检测与策略能力，安全文章只提供行业背景，限制必须覆盖检测范围、性能、Dify 版本和不能替代完整治理。

每个场景完成：

```text
Source -> Claim -> Chunk -> IndexSnapshot -> RetrievalRun
-> EvidencePreview -> 平台表达确认 -> Final EvidencePack
-> GenerationInput -> DraftVersion -> QA
```

人工随机核对每篇至少 8 个事实句，必须全部能回到 EvidenceItem、Claim 和原文；任何虚构场景、按钮、接口、客户结果和实现细节均判定失败。

## 19. 安全、权限与展示边界

- 普通内容页只显示可生成状态、关键事实、必须带条件表达和缺什么资料。
- 完整 Chunk、得分、Embedding、候选池和检索日志只在治理/开发视图展示。
- restricted/confidential 证据不得进入公开任务和公开导出。
- 不记录、不返回、不展示 API Key、Token 和 Provider 原始响应。
- 不把用户输入的完整 EvidencePack 当可信数据。
- 所有激活、回滚、人工选证据和风险接受必须记录操作者与原因。

## 20. 失效、缓存与回滚

缓存键必须包含：

```text
taskFingerprint
+ indexSnapshotId
+ rulePackageVersionId
+ retrievalPolicyVersion
+ callerPermissionScope
```

以下变化使 Preview、Pack 和缓存失效：

- 标题、产品、渠道、内容类型、主蒸馏词或任务版本变化。
- RulePackage 激活、回滚或失效。
- IndexSnapshot 切换或回滚。
- Source/Claim 被隔离、替代、过期或进入冲突。
- 权限范围变化。
- Embedding、Chunk schema、Chunker 或 RetrievalPolicy 版本变化。

回滚只切换 active Snapshot，不删除历史索引、Pack 和生成记录；历史生成继续保留当时快照用于审计。

## 21. 不允许的实现捷径

1. 不把四个目录全部 Markdown 固定 Token 切片后直接向量化。
2. 不让 293/312 篇历史文章压过正式产品页。
3. 不把微信公众号旧稿当产品能力真源。
4. 不用 keyword contains + Top 4 作为正式检索。
5. 不用调用方选择的任意 Chunk 直接生成正文。
6. 不用 EvidencePreview 代替 Final EvidencePack。
7. 不在 Embedding 缺失时用伪向量或正式 Pack 降级。
8. 不让 LLM 自行裁决冲突、权限、产品归属和能力状态。
9. 不在索引和 Pack 稳定前开放正式复制、分发和排程。

## 22. Definition of Done

本项目完成必须同时满足：

- 四个指定来源目录已完成 SourceAsset/Revision 导入和准入分类。
- 三产品均有 active `production_public` IndexSnapshot。
- Claim 感知 Chunk、真实 BM25、真实 Embedding 和硬过滤实际运行。
- EvidencePreview 已进入月度矩阵审核前链路。
- Final EvidencePack 已进入矩阵批准后的冻结任务链路。
- 正式正文生成只能读取不可变 Final EvidencePack。
- 三篇真实公众号草稿完成端到端生成与人工事实核对。
- 固定评测集达到本文件所有强制指标。
- 索引、规则、来源、权限、Preview、Pack、生成和 Badcase 均可追溯和回滚。
- 配置缺失、证据不足和风险冲突均 fail-closed，不伪装成功。

达到以上条件后，V5 才算真正实现：

```text
真实知识库
-> 可治理生产索引
-> 可证明的内容矩阵
-> 可审计 EvidencePack
-> 稳定的公众号正文生产
```

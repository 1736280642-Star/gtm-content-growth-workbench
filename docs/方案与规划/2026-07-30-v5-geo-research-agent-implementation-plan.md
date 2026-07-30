# V5 新产品 GEO 调研助手闭环实施方案

> 日期：2026-07-30
> 目标：在一个新产品进入月度内容策略之前，自动完成可追溯的联网研究、AI 前台基线测试、竞品与引用来源分析，并沉淀为经人工批准的产品 GEO Blueprint。

## 1. 结论

V5 不应把这项需求实现成“新增产品时顺便生成几条关键词”，而应新增一个独立的产品准入阶段：

```text
新产品与资料
-> GEO 调研助手
-> 人工批准 Product GEO Blueprint
-> 问题池、内容类型、规则包和知识准备度
-> MonthlyPlan 与月度内容策略包
-> 内容生产、发布和 AI 前台复测
-> MonthlyReview
-> 下一自然月 Proposal
```

推荐实现为“受控智能体工作流”，而不是让一个模型自由运行：

1. 模型负责制定研究计划、扩展查询、归纳发现和形成草案。
2. 搜索、网页抓取、前台采集、知识检索、证据比对均由白名单工具执行。
3. 每个任务、查询、来源、回答、判断和版本均持久化。
4. 智能体只能产生候选问题、研究发现和规则草案，不能自行激活规则包、批准月度策略或发布内容。
5. 只有经人工批准的 `GeoBlueprintVersion` 才能进入月度策略生成。

这是当前 V5 最可行的闭环，因为它最大程度复用现有的产品实体、知识治理、问题池、内容类型、Evidence Gate、AI 前台测试和 MonthlyPlan，同时补上“新增产品后先研究什么、为何这样研究、研究结果如何进入生产”的缺口。

## 2. 当前 V5 的适用性判断

### 2.1 当前内容类型是否从 ADP、WorkBuddy 出发

结论：业务样本明显来自 ADP、WorkBuddy 和 JOTO 企业服务场景，但正式内容类型结构并未绑定这两个产品。

当前 `ArticleTypeProfileVersion` 使用的是通用字段：

- 语义定义与适用问题；
- 目标读者与内容目标；
- 结构模块与必需章节；
- CTA、篇幅、风格；
- 案例和证据偏好；
- 渠道提示；
- 版本化 Prompt 约束快照。

默认模板包括：

- 选型与比较；
- 实施指南；
- 场景解决方案；
- 案例与证据；
- FAQ；
- 技术实践。

这些类型与 ADP、WorkBuddy 的企业选型、实施交付、场景和技术内容高度吻合，所以其初始业务假设来自这两个产品；但模板语义本身适用于大多数 B2B AI、SaaS、企业软件和专业服务产品。

### 2.2 能否直接迁移到其他产品

结论：可以复用“类型骨架”，不能把当前模板和规则原样复制后直接生产。

可直接复用：

- `productId` 隔离的产品实体、Claim、知识库和规则包；
- 自定义内容类型及版本冻结；
- 问题与内容类型的语义匹配；
- Evidence Gate 和证据不足时的失败关闭；
- 月度策略、内容矩阵、发布回传、前台观察和 MonthlyReview；
- 选型、实施、场景、FAQ、技术实践等通用内容方法。

必须先产品化改造：

1. 默认内容类型 CTA 仍硬编码 `JOTO`。
2. `deriveKeywords` 仍直接匹配 ADP、WorkBuddy 和企业知识管理词。
3. 托管资料导入仍依赖代码内产品列表，不能由产品实体注册表动态驱动。
4. RAG 的 `platformContentType` 仍是六个固定推广枚举，无法表达调研后新增的产品特定证据槽位。
5. 旧工作台层仍存在固定 `ProductKey` 和标签映射。
6. AI 前台采集正式适配器目前只有 ChatGPT；元宝、豆包、Kimi 显示为未支持，且当前平台枚举没有 DeepSeek、通义千问和 Perplexity。
7. 前台回答分析目前主要判断目标实体是否出现、是否有自有引用，还没有竞品识别、推荐位置、关系准确性、能力准确性和“回答陈述—引用页面内容”对齐。

因此，新增调研助手之前必须先完成“产品注册动态化 + 研究结果版本化 + 前台观察增强”三项基础改造。

### 2.3 哪些产品不应机械套用现有六类模板

以下产品应由研究结果生成或修改内容类型，而不是直接沿用现有模板：

- 面向个人消费者、强情绪或强社区决策的产品；
- 医疗、金融、法律等高监管产品；
- 主要依赖开放源码、开发者生态或 API 使用的产品；
- 实体商品、线下服务或本地生活产品；
- 没有可公开证据、案例或稳定产品边界的早期产品。

调研助手应把系统模板当作候选起点，并输出“保留、修改、新增、不适用”四种建议，不能自动发布新类型。

## 3. 核心业务闭环

### 3.1 用户只需要提供的内容

新增产品时只要求用户完成一屏信息：

1. 产品名称、官网和产品类别。
2. 上传资料或绑定已有知识库。
3. 产品希望重点表达的对象、场景、能力和差异。
4. 明确禁止或暂不能表达的内容。
5. 目标市场、语言和主要渠道；不填写时由系统按产品和工作区默认值推断。

已知竞品、目标用户或种子问题均为选填，系统应能通过联网研究补齐候选。

### 3.2 最终必须交付的结果

一次成功的调研运行应产生一个可追溯的 `GeoBlueprintVersion`，至少包含：

1. 产品实体与表达边界摘要。
2. 适用的用户问题分类体系。
3. 问题池及每条问题的来源、意图、受众、证据准备度和优先级。
4. AI 前台基线：平台、搜索模式、原始回答、可见引用、提及、推荐、准确性和稳定性。
5. 竞品及服务商占位图。
6. 高价值被引用页面及其内容结构、证据方式和可复用方法。
7. 我方内容、证据、规则和渠道缺口。
8. 推荐内容类型：复用现有、修改现有或新建。
9. 每种内容类型的结构、证据槽位、边界、渠道提示和样稿验收规则。
10. 产品表达规则包草案和需补资料清单。
11. 进入 MonthlyPlan 的优先问题、内容类型组合、渠道建议和配额建议。
12. 发布后的固定复测问题、平台、条件和触发时间。

Blueprint 不是产品事实真源。产品事实仍必须来自正式知识库、SourceRevision 和 Claim；竞品页面只能作为市场研究证据，不能支持我方产品能力表达。

## 4. 调研助手主链路

### L1 触发：创建产品研究项目

用户新建产品并提交资料与表达重点。系统创建 `product_entity`、知识库绑定和 `GeoResearchProject`。

系统先检查：

- 产品名称、官网、别名是否与现有实体冲突；
- 是否有至少一个可解析资料源；
- 是否明确公开范围和产品表达重点；
- 上传内容是否含敏感信息。

不满足条件时返回具体缺口，不启动联网任务。

### L2 输入预处理：建立可信产品上下文

系统复用现有知识治理链路：

1. 资料进入 SourceRevision。
2. 提取产品 Claim、能力、条件、限制和冲突。
3. 生成产品身份与表达边界草案。
4. 建立本次研究使用的只读 `sourceSnapshotHash`。

研究模型只能读取这个快照。模型不得把网页搜索到的第三方说法直接写成我方产品事实。

### L3 模型规划：生成受控研究计划

Planner 根据产品上下文输出结构化 `ResearchPlan`，包括：

- 需要回答的研究问题；
- 搜索主题与查询组合；
- 适用的问题分类；
- 需要覆盖的目标用户；
- 前台测试问题组；
- 目标 AI 平台；
- 竞品发现与页面拆解任务；
- 完成条件和失败降级策略。

计划必须通过 JSON Schema 校验，并由规则引擎强制加入：

- 无品牌品类发现问题；
- 场景与实施问题；
- 品牌准确性问题；
- 明确开启联网搜索；
- 新会话和无诱导要求；
- 来源追溯和脱敏要求。

模型不能删除这些硬性任务。

### L4 联网研究：用户问题与公开信源发现

Executor 并行执行两类联网任务：

#### A. 问题发现

来源包含：

- 搜索联想和相关问题；
- 官方文档、帮助中心和 FAQ；
- 问答社区、评论区和公开讨论；
- 竞品网站与服务商页面；
- AI 搜索返回的相关追问；
- 用户上传的脱敏销售、售前和客服问题。

每条候选问题保存：

- 原始问题；
- 发现查询；
- 来源 URL 与时间；
- 问题分类、受众和意图；
- 是否带品牌诱导；
- 与现有问题的聚类关系；
- 证据准备度；
- 建议优先级。

#### B. 页面与竞品发现

保存搜索结果排名、标题、URL、摘要、抓取时间、网页正文快照和内容哈希。高价值页面进一步拆解：

- 首屏是否直接回答；
- 内容结构；
- 可引用元素；
- 实体关系清晰度；
- 证据、来源和更新时间；
- 限制与责任边界；
- 可能被引用的具体段落；
- 我方内容缺口。

联网搜索是硬门禁：没有真实搜索调用、公开 URL 和可复核来源的运行不能进入 `completed`。

### L5 AI 前台基线测试

问题池版本冻结后，对目标平台创建全新的前台测试任务。

标准条件：

- 新会话；
- 原始问题；
- 不添加品牌诱导；
- 联网搜索或搜索增强已开启；
- 保留平台、模型标签、地区、语言和测试时间；
- 保存回答正文、可见引用、公开 URL 和脱敏截图；
- 高优先级问题至少使用独立新会话复测一次。

这里必须分清两种数据：

1. `research_api_answer`：通过联网模型 API 得到，适合自动化研究和大规模交叉验证。
2. `frontend_observation`：通过真实产品前台采集，代表用户实际看到的界面结果。

API 结果不能冒充豆包、Kimi、DeepSeek 等前台结果。前台未公开的内部检索页面也不能被描述成“AI 看过的网页”；系统只能确认公开 API trace 或前台可见的来源卡片。

### L6 回答、引用和竞品分析

对每条有效回答执行版本化分析：

1. 切分回答陈述。
2. 提取品牌、产品、服务商、竞品和替代方案。
3. 判断目标产品是否被提及。
4. 判断产品、品牌、服务商关系是否准确。
5. 判断能力表达是否被产品 Claim 支持。
6. 判断推荐类型：明确推荐、普通列举、无关提及、未提及。
7. 提取推荐位置、回答倾向和事实错误。
8. 将陈述与可见引用页面的具体内容片段对齐。
9. 标记 `supported`、`partial`、`unsupported` 或 `unverifiable`。
10. 统计引用域、页面类型、竞品占位和重复回答稳定性。

“引用页面支持了回答中的什么”可以通过证据对齐判断；“该页面是否真的进入模型内部索引”通常无法从外部证明，产品文案和指标必须使用“可见引用”“来源支持”而不是“已被收录”。

### L7 方案综合：形成 GEO Blueprint 草案

Synthesizer 只消费已持久化的研究发现和证据，不直接再次自由搜索。它输出：

- 问题机会；
- 内容机会；
- 证据缺口；
- 竞品内容方法；
- 内容类型建议；
- 产品表达规则草案；
- 月度策略输入建议；
- 发布后复测计划。

Evaluator 再执行一次确定性检查：

- 每条高优先级建议是否有来源；
- 产品事实是否只来自正式 Claim；
- 是否把提及、引用和收录混为一谈；
- 是否复制竞品表达；
- 是否存在无证据的能力、价格、案例、效果或合规承诺；
- 问题池是否只包含品牌诱导问题；
- 内容类型是否有清晰证据槽位和失败降级方式。

不通过时只允许回到对应研究任务重跑，不允许模型用更肯定的措辞绕过证据缺口。

### L8 人工批准与月度策略接入

用户在一个证据审阅页完成最终判断：

- 确认产品身份和表达边界；
- 接受、修改或拒绝问题与内容类型建议；
- 确认竞品仅用于研究；
- 批准 `GeoBlueprintVersion`；
- 决定是否激活对应规则包和内容类型新版本。

批准后系统：

1. 将确认问题写入正式问题池并保留研究来源。
2. 创建或关联内容类型草稿，仍需单独激活。
3. 将产品规则包草案送入现有规则包审批。
4. 生成月度策略候选输入，但不自动创建或批准 MonthlyPlan。
5. 将基线问题和前台条件保存为发布后复测模板。

## 5. 技术架构

### 5.1 分层

```text
Product Onboarding UI
        |
        v
Geo Research Orchestrator
  |- deterministic state machine
  |- model planner
  |- policy and budget guard
  |- durable task queue
        |
        +--> Live Search Adapters
        +--> Web Fetch and Snapshot
        +--> Existing Knowledge/RAG
        +--> Frontend Capture Runner
        +--> Evidence Alignment
        +--> Competitor/Page Analyzer
        |
        v
Research Findings + GeoBlueprintVersion
        |
        +--> Question Pool
        +--> Article Type Drafts
        +--> Rule Package Draft
        +--> Monthly Strategy Candidate Input
        +--> Retest Baseline
```

### 5.2 为什么不用一个自由 Agent

自由 Agent 会带来四个不可接受的问题：

- 无法证明每条结论来自哪次搜索和哪个页面；
- 中断后难以恢复，容易重复搜索或重复写入；
- 容易把竞品说法混入我方产品事实；
- 容易越过规则包激活、月度批准和发布等人工权限。

推荐沿用 V5 已有 Repository、Service、Worker、幂等键、乐观并发和审计模式，新增持久化状态机。首版不必引入 LangGraph 或 Temporal；当前 MySQL 租约 Job 模式已经能够支撑可恢复长任务。只有在跨实例编排、数百并发研究项目或复杂人工等待成为真实瓶颈时，再迁移到专用工作流引擎。

### 5.3 Provider 分层

当前 `callAiProvider` 仅支持普通 Chat Completions，不能承担本需求。应拆成：

1. `ReasoningModelProvider`：计划、聚类、抽取、综合。
2. `LiveSearchProvider`：返回搜索 trace、查询、结果、URL、标题和摘要。
3. `WebPageProvider`：抓取公开页面并生成不可变快照。
4. `FrontendObservationProvider`：驱动真实前台并采集可见回答和引用。
5. `EvidenceAlignmentProvider`：陈述与来源片段匹配。

优先接入至少两个独立联网搜索来源，一个偏中文生态，一个用于跨源验证。Provider 必须返回统一数据契约，业务层不依赖厂商私有格式。

### 5.4 前台采集架构

复用现有：

- `capture-runner/` 本地回环 Runner；
- `browser-extension/` 浏览器伴侣；
- `FrontendCaptureTask`、Artifact、Answer、Citation 和 Comparison；
- 登录、验证码和平台风控人工接管机制。

需要改造：

1. 将 `AiFrontendPlatform` 从 TypeScript 固定联合类型改为数据库平台注册表。
2. 新增 DeepSeek、通义千问、Perplexity，并逐步实现豆包、Kimi、元宝适配器。
3. 每个平台适配器必须检测“新会话”和“联网搜索已开启”状态。
4. DOM 变化时返回 `adapter_mismatch`，不得使用旧选择器生成伪成功。
5. 平台登录态只保存在本机浏览器 profile，不上传 Cookie、Token 或完整会话。
6. 采集只覆盖当前任务页，并在截图前遮罩账号、头像、侧边栏和个人信息。

真实前台适配器是本方案维护成本最高的部分，但也是无法被普通搜索 API 替代的核心证据层。

## 6. 数据模型

### 6.1 直接复用的正式对象

- `product_entity`
- `knowledge_base_product_link`
- `ingestion_batch`
- `source_revision`
- `product_claim`
- `source_snapshot`
- `product_expression_rule_package`
- `rule_package_version`
- `question_candidate`
- 正式问题版本
- `ArticleTypeProfileVersion`
- `FrontendCaptureTask`
- `CapturedAnswer`
- `CapturedCitation`
- `ObservationGap`
- `monthly_plan`
- `monthly_strategy_package_version`

### 6.2 新增核心对象

#### `geo_research_project`

一个产品对应一个长期研究项目。

关键字段：

- `id`
- `product_id`
- `status`
- `research_market`
- `languages`
- `target_channels`
- `expression_focus`
- `forbidden_focus`
- `current_approved_blueprint_version_id`
- `row_version`

#### `geo_research_run`

一次完整研究运行。

关键字段：

- `id`
- `project_id`
- `run_version`
- `trigger_type`
- `input_source_snapshot_hash`
- `plan_json`
- `plan_schema_version`
- `status`
- `live_search_required`
- `live_search_verified`
- `started_at`
- `completed_at`
- `failure_code`
- `row_version`

#### `geo_research_task`

持久化每个计划、搜索、抓取、采集、分析和综合节点。

关键字段：

- `id`
- `run_id`
- `task_type`
- `dependency_ids`
- `provider`
- `provider_model`
- `tool_name`
- `request_json`
- `response_artifact_id`
- `status`
- `attempt`
- `max_attempts`
- `lease_owner`
- `lease_expires_at`
- `idempotency_key`
- `failure_code`

#### `geo_research_evidence`

统一保存搜索结果、网页快照、前台回答、引用卡片和证据片段的引用关系。

关键字段：

- `id`
- `run_id`
- `evidence_type`
- `source_url`
- `source_title`
- `publisher`
- `query_text`
- `snapshot_hash`
- `content_locator`
- `captured_at`
- `verification_status`
- `visibility`
- `artifact_id`

#### `geo_research_finding`

保存带证据的结构化发现。

`finding_type` 至少包括：

- `question_opportunity`
- `competitor_mention`
- `citation_pattern`
- `content_gap`
- `evidence_gap`
- `relationship_error`
- `capability_error`
- `article_type_recommendation`
- `channel_recommendation`
- `retest_requirement`

每条 finding 必须包含 `evidence_ids`、`confidence`、`review_status` 和 `analyzer_version`。

#### `geo_blueprint_version`

研究结果的不可变版本。

关键字段：

- `id`
- `project_id`
- `run_id`
- `version_number`
- `status`
- `question_strategy`
- `competitor_landscape`
- `citation_strategy`
- `content_type_strategy`
- `evidence_requirements`
- `rule_package_draft_ref`
- `monthly_strategy_input`
- `retest_baseline`
- `research_snapshot_hash`
- `approved_by`
- `approved_at`
- `immutable_at`

### 6.3 必须增加的关联

- `question_candidate.research_run_id`
- `question_candidate.source_evidence_ids`
- `FrontendCaptureTask.research_run_id`
- `FrontendCaptureTask.search_mode`
- `CapturedAnswer.entity_analysis_versions`
- `CapturedAnswer.recommendation_analysis_versions`
- `CapturedAnswer.citation_alignment_versions`
- `ArticleTypeProfileVersion.research_blueprint_version_id`
- `monthly_strategy_package_version.geo_blueprint_version_ids`

月度策略必须冻结 Blueprint 版本，但 Blueprint 不取代规则包、知识快照或 EvidencePack。

## 7. 页面与 API

### 7.1 页面

建议把入口放在“问题与知识准备”区域：

- `/products`：产品列表和 GEO 准入状态。
- `/products/new`：新产品、资料和表达重点。
- `/products/[productId]/research`：研究运行列表和当前 Blueprint。
- `/products/[productId]/research/[runId]`：任务进度、证据、问题、前台测试、竞品和失败恢复。
- `/products/[productId]/geo-blueprint/[versionId]`：最终审阅、差异和批准。

用户主路径只保留三个主要动作：

1. 开始调研。
2. 处理明确阻塞。
3. 批准并进入月度策略。

Provider、任务重试、快照哈希和模型 trace 放在开发管理员或审计抽屉中，不暴露给普通 GEO 运营人员。

### 7.2 API

- `POST /api/v5/products`
- `GET /api/v5/products/[productId]`
- `POST /api/v5/products/[productId]/research-runs`
- `GET /api/v5/products/[productId]/research-runs/[runId]`
- `POST /api/v5/products/[productId]/research-runs/[runId]/retry`
- `POST /api/v5/products/[productId]/research-runs/[runId]/cancel`
- `GET /api/v5/products/[productId]/geo-blueprints/[versionId]`
- `POST /api/v5/products/[productId]/geo-blueprints/[versionId]/approve`
- `POST /api/v5/products/[productId]/geo-blueprints/[versionId]/request-changes`
- `POST /api/v5/products/[productId]/geo-blueprints/[versionId]/handoff-to-monthly-strategy`

所有写接口沿用 V5 约束：

- `x-idempotency-key`
- `expectedVersion`
- actor identity
- `auditReason`
- 乐观并发
- 来源追溯
- 失败关闭

## 8. GEO Blueprint 如何驱动月度策略

Blueprint 获批后，不直接生成文章，而是向当前月度策略提供候选输入：

```text
已批准 Blueprint
 + 已激活产品规则包
 + 可用问题版本
 + 已激活内容类型版本
 + 知识与证据准备度
-> MonthlyPlan 策略建议
-> 人工选择目标问题、内容类型、渠道和配额
-> 现有策略预检与批准
```

策略建议排序可使用：

- 问题需求证据；
- AI 前台未覆盖或错误覆盖程度；
- 竞品占位；
- 我方内容缺口；
- 官方引用缺口；
- 证据准备度；
- 渠道适配度；
- 发布后可复测性。

不能只按“竞品多”或“品牌未提及”排序。证据不足的问题应进入补资料，而不是被高机会分数强行推进生产。

## 9. 指标与判断边界

### 9.1 分开保留的观察指标

- 目标品牌提及率；
- 关系准确率；
- 能力准确率；
- 明确推荐率；
- 自有官方引用率；
- 竞品占位率；
- 可见引用支持率；
- 首次回答稳定率；
- 问题分类覆盖度；
- 高优先级内容缺口数；
- 发布后同问题变化。

不建议生成一个统一“GEO 总分”。不同平台、问题和样本条件不可直接压缩成单一分数，且当前 V5 已明确反对用观察和官网审计形成伪精确总分。

### 9.2 研究运行质量指标

- 强制联网任务覆盖率：100%。
- 有公开 URL 或正式内部 Source ID 的高优先级发现：100%。
- 产品事实关联正式 Claim 的覆盖率：100%。
- 前台有效记录必须有平台、日期、新会话和搜索模式状态。
- 无法验证搜索模式的记录不进入正式基线指标。
- 竞品内容不得被写入产品事实或直接复制进文章规则。

## 10. 分阶段实施

### 阶段 A：产品无关化与研究底座

交付：

- 动态产品注册表替代代码内产品枚举；
- 移除内容类型模板中的 JOTO 固定 CTA；
- 问题抽取改为产品实体、别名和模型候选驱动；
- 新增 Research Project、Run、Task、Evidence、Finding 和 Blueprint 契约与 MySQL 表；
- 新增持久化 Research Worker；
- 新产品入口和运行进度页。

验收：

- 可创建一个不属于 ADP、WorkBuddy 的产品；
- 可绑定资料并形成产品 SourceSnapshot；
- 任务可中断恢复、重试且不会重复写入；
- 未联网时运行明确失败。

### 阶段 B：联网问题、页面与竞品研究

交付：

- 至少两个 Live Search Provider；
- 网页抓取、正文快照、哈希和来源分类；
- 问题扩展、去重、聚类和意图分类；
- 竞品实体、页面类型和内容结构分析；
- 研究证据审阅页。

验收：

- 每个适用问题分类至少获得 10 个有效候选问题；
- 每个重点分类至少拆解 3 至 5 个高价值页面；
- 每条建议可回到查询、URL 和页面片段；
- 断网、网页不可访问和来源冲突均有明确状态。

### 阶段 C：真实 AI 前台基线

交付：

- 扩展平台注册表；
- 完成中国市场重点平台的浏览器适配器；
- 搜索模式检测、新会话检测和隐私遮罩；
- 实体、竞品、推荐、关系和能力准确性分析；
- 陈述与引用内容对齐；
- 条件一致的重复采集比较。

验收：

- 至少 7 个稳定问题；
- 至少 4 个目标 AI 前台；
- 至少 28 条有效基线记录；
- 所有高价值回答保留脱敏截图和公开引用；
- API 回答与真实前台回答在数据和 UI 上明确区分。

### 阶段 D：Blueprint 与月度策略接入

交付：

- Blueprint 综合、确定性检查、人工批准和版本差异；
- 问题候选进入正式问题池；
- 内容类型新建或修改草案；
- 规则包草案与知识缺口；
- 月度策略候选输入；
- 发布后复测模板。

验收：

- 未批准 Blueprint 不能进入月度策略建议；
- Blueprint 不能绕过规则包激活和 Evidence Gate；
- MonthlyPlan 冻结 Blueprint、问题、内容类型、规则包和知识快照版本；
- 复测结果能进入 MonthlyReview 并形成下一自然月 Proposal。

### 阶段 E：稳定性与回归评测

交付：

- 固定产品研究样本集；
- 搜索 Provider 和前台适配器回归；
- 坏案例库；
- 成本、延迟、失败率和平台 DOM 变化监控；
- 脱敏与敏感信息扫描；
- 数据保留和删除策略。

验收：

- 使用至少一个非 ADP、非 WorkBuddy 产品完成全链路；
- 相同输入可重放并解释关键差异；
- 平台结构变化不会生成伪成功；
- 旧 Blueprint、规则包和 MonthlyPlan 不被新运行覆盖。

## 11. 推荐的首个验证产品

首个验收不应继续使用 ADP 或 WorkBuddy，否则无法证明产品无关化已经完成。

建议从当前托管产品列表中的一个非 ADP、非 WorkBuddy 产品选择真实资料，完成：

1. 新产品注册。
2. 资料导入和产品身份确认。
3. 联网问题与竞品研究。
4. 四平台前台基线。
5. Blueprint 批准。
6. 下一自然月策略候选。

通过后再把 WorkBuddy 作为回归样本，验证新链路不会破坏既有 GEO 规则。

## 12. 关键风险与处理

### 12.1 无法知道 AI 内部看过所有网页

处理：只记录 API 暴露的 search trace、搜索结果和前台可见引用。所有 UI 和报告使用“可见引用”“来源支持”“观察到”措辞。

### 12.2 浏览器前台适配器持续变化

处理：每个平台独立版本、健康检查和可靠性测试；DOM 不匹配立即失败关闭；保留人工前台上传作为受控兜底，但必须按同一数据契约记录。

### 12.3 竞品内容污染我方事实

处理：研究证据和产品事实分 namespace。竞品来源只允许支持“市场观察、内容结构和竞品行为”，不能进入我方产品 Claim 或 EvidencePack。

### 12.4 模型把相关性写成因果

处理：要求每条 finding 绑定证据，Evaluator 检查“被引用”与“被收录”、“发布后变化”与“由发布导致”的措辞差异。

### 12.5 过度自动生成内容类型

处理：AI 只产生 `draft`；现有模板优先复用，只有研究证据表明结构、受众或证据槽位显著不同才建议新类型；最终激活归人。

### 12.6 新链路绕开 MonthlyPlan

处理：调研运行不是新的规划周期。它只产生准备资产和策略候选，所有正式内容仍必须进入自然月 `MonthlyPlan` 并通过现有批准链路。

## 13. 最终实施决策

优先级顺序应为：

1. 先让产品实体、问题提取、内容类型 CTA 和资料导入真正产品无关。
2. 再实现带真实来源的联网研究与可恢复任务编排。
3. 再扩展真实 AI 前台适配器和回答证据分析。
4. 最后将经批准的 Blueprint 接到月度策略，不直接接正文生成。

这一顺序解决的是同一个核心问题：先证明“为什么要为这个产品写这些内容”，再让 V5 承担“如何在自然月内稳定生产、发布和复测这些内容”。

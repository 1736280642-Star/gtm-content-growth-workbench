# V5 正式开发与数据底座索引

## 1. 目录定位

本目录是 JOTO GTM 内容工作台 V5 的正式设计真源，用于指导数据库建设、领域服务、月度内容矩阵、批量生成、质量回归、发布排程和 Workflow Agent 治理。

V5 的周期、主流程和字段以 00-V5月度内容矩阵统一口径与字段映射.md 为最高业务口径，并与 D:/GTM/工作台/docs/V5 -07-09 保持一致。

真实开发准入结论、生产阻断项和代码规则映射见同级目录 `../01-真实开发准入审计与流程规则映射.md`。

## 2. 总体链路

    产品表达规则
    → 资料接入与 ProductClaim
    → RAG 与 EvidencePack
    → 月度目标与月度内容策略包
    → 人工审核月度策略
    → 月度内容矩阵与人工审核
    → 批量生成一个月正文
    → 硬规则与评测 Runner
    → 合格稿抽检、异常稿处理
    → 定时发布排程与人工前置确认
    → 自动发布或人工接管
    → URL 与渠道数据回传
    → 月度复盘
    → 下月策略优化

周视图和当日执行只是已批准月度矩阵的派生视图，不是独立计划真源。

## 3. 七个正式入口

### 统一月度口径

- 00-V5月度内容矩阵统一口径与字段映射.md

用途：

- 定义 MonthlyPlan、MonthlyStrategyPackageVersion、ContentMatrixItem、BatchGenerationRun、PublishSchedule 和 MonthlyReview。
- 定义旧周计划、周报、Today Publish 和人工发布队列的迁移方式。
- 定义 `contentType / channel / title / sourceProblem / rulePackageVersionId / draftVersionId` 的跨阶段唯一字段口径。

### 阶段一：产品表达规则边界

目录：01-先设计产品表达规则边界

- 01-JOTO-品牌产品表达规则边界.md
- 02-Pharaoh-Command-产品表达规则边界.md
- 03-Noteflow-产品表达规则边界.md
- 04-唯客-AI-护栏-产品表达规则边界.md
- 05-通用产品表达规则模板.md

开发用途：

- 定义产品允许表达、禁止表达、证据要求、渠道边界和月度矩阵适用范围。

### 阶段二：新增知识库接入

目录：02-再设计新增知识库接入流程

- 00-阶段二新增知识库接入最佳设计总方案.md
- 01-资料接入与来源治理.md
- 02-产品实体识别与原子事实抽取.md
- 03-规则包草稿生成与版本治理.md
- 04-资料缺口冲突与人工确认.md
- 05-数据契约接口页面与权限.md
- 06-验收测试与第三阶段交接.md

开发用途：

- 实现资料、ProductClaim、规则包草稿、月度生产准备度、缺口冲突和人工确认。
- 只有 active 规则包且月度可生产范围明确的产品才能进入月度生产池。

### 阶段三：RAG 与证据

目录：03-再设计RAG优化策略

- 00-阶段三RAG最佳设计总方案.md
- 01-RAG准入索引命名空间与生命周期.md
- 02-Claim感知Chunk数据契约与语义切片.md
- 03-检索路由混合召回重排与权限过滤.md
- 04-EvidencePack与证据充分性判断.md
- 05-RAG评测监控与Badcase闭环.md
- 06-实施迁移验收与跨阶段交接.md

开发用途：

- 为已批准月度策略生成的矩阵草稿提供 EvidencePreview。
- 月度策略审核读取策略包内的 evidenceReadinessSummary，不提前创建矩阵项。
- 为每个已批准 ContentMatrixItem 生成 Final EvidencePack，并由其写入正式 Evidence Gate 结果。
- Final Evidence Gate 决定矩阵项可生成、需降级、缺证据、需复核、阻断或待配置。

### 阶段四：内容生成稳定链路

目录：04-再设计内容生成稳定链路

- 00-阶段四内容生成稳定链路最佳设计总方案.md
- 01-GenerationInput与生成前校验.md
- 02-正文生成编排Provider与Prompt治理.md
- 03-规则引擎硬校验.md
- 04-软质量评测与自然表达校验.md
- 05-合格稿异常稿分流与修改留痕.md
- 06-实施迁移验收与第五阶段交接.md
- 07-公众号平台呈现与HTML排版层.md
- 08-公众号文章拆图与配图Prompt工作流.md
- 00-平台表达准备 目录内的内容类型、前置检查、标题体系和自然表达标准

开发用途：

- 从已批准月度矩阵项创建执行快照和 GenerationInput。
- Batch Generation Center 承担一个月正文的批量生成和自动质检。
- 当日执行不重新决定产品、渠道、标题、主蒸馏词或规则包。
- 合格 Markdown 正文先生成并人工确认文章拆图方案，再把已批准图片资产交给公众号 HTML 排版层。

### 阶段五：评测集与 Badcase

目录：05-再设计评测集与Badcase闭环

- 00-阶段五评测集与Badcase最佳设计总方案.md
- 01-EvaluationAsset与样本库数据契约.md
- 02-正向边界Badcase样本设计.md
- 03-人工修改原因与质量问题分类.md
- 04-评测Runner指标门槛与版本治理.md
- 05-Badcase归因优化动作与回归闭环.md
- 06-实施迁移验收与第六阶段交接.md

开发用途：

- 评测矩阵项、批量生成运行、异常稿、发布结果和版本准入。
- 月度复盘只展示可行动趋势；完整样本和 Runner 明细留在治理页。

### 阶段六：Workflow Agent

目录：06-最后设计Workflow-Agent调度边界

- 00-阶段六Workflow-Agent调度与权限最佳设计总方案.md
- 01-Agent能力注册权限等级与禁止边界.md
- 02-Workflow状态机任务图Checkpoint与恢复.md
- 03-工具契约幂等重试补偿与并发控制.md
- 04-异常队列人工确认SLA与角色分流.md
- 05-Agent运行审计安全可观测性与复盘.md
- 06-实施迁移验收与正式开发交接.md

开发用途：

- 生成月度策略包和矩阵草稿。
- 在人工批准后生成 Final EvidencePack，并执行 Final Evidence Gate、批量生成、质检、异常分流和发布排程。
- 生成月度复盘草稿与下月建议。
- 不得自行批准策略、矩阵、风险例外或未经排程的正式发布。

### AI 配置 / 治理日志页

页面职责：为工作台运营和开发管理员提供月度批量生产的底层治理入口，不作为普通内容发布人员默认页面。

至少包含：

- Provider 与模型能力状态。
- Prompt、规则包、RAG 索引和评测集版本。
- 月度策略包与 Workflow Agent 运行记录。
- EvidencePreview、Final EvidencePack、硬规则和评测 Runner 摘要。
- PublishSchedule、发布尝试、失败原因和人工接管记录。

业务页面只展示可行动摘要；完整 Prompt、原始 trace、密钥、rawAnswer 和底层召回分数不得在普通页面出现。

## 4. 核心数据关系

    SourceAsset
    → SourceVersion
    → ProductClaim
    → ProductExpressionRulePackage
    → MonthlyProductionReadiness
    → MonthlyPlan
    → MonthlyStrategyPackageVersion
    → ContentMatrixItem
    → EvidencePreview
    → Final EvidencePack
    → GenerationInput
    → BatchGenerationRun
    → GenerationRun
    → HardRuleResult 与 SoftEvaluationResult
    → DraftVersion
    → PublishSchedule
    → PublicationRecord
    → EvaluationAsset 与 Badcase
    → MonthlyReview

WorkflowRun 通过 ArtifactReference 引用以上产物，不复制业务真源。

## 5. 真实数据资产

知识库导出快照保留在：

    ../workflow-agent-content-production-system/assets/01-knowledge-base-layer

当前快照包含：

- 3 个知识库。
- 457 个来源。
- 1297 个 Chunk。
- 知识库、来源、Chunk 和类型分布元数据。

原始导出中的周报复盘等旧字段属于 V4 历史值，迁移时映射到 MonthlyReview 或 WeeklySnapshot，不直接修改快照。

## 6. 正式实施顺序

1. 建立 MonthlyPlan、MonthlyStrategyPackageVersion、ContentMatrixItem 和 PublishSchedule。
2. 建立 V5 数据表、稳定 ID、版本和 ArtifactReference。
3. 导入并核对知识库导出数据，生成 MonthlyProductionReadiness。
4. 实现阶段二资料治理、ProductClaim 和规则包月度准入。
5. 实现阶段三矩阵 EvidencePreview、Final EvidencePack 与正式 Evidence Gate。
6. 实现阶段四批量生成、自动质检和平台呈现。
7. 实现阶段五评测 Runner、Badcase 和版本准入。
8. 实现阶段六 Workflow、工具网关、权限、确认、异常和审计。
9. 接入定时发布排程、URL 数据回传和月度复盘。
10. 使用一个真实月份、一个产品和一个渠道灰度验证完整闭环。

## 7. 开发约束

- 月度内容矩阵是主计划真源。
- Weekly View 和 Today Execution 只能读取或轻量调整已批准矩阵。
- 月度策略和月度矩阵必须人工审核后才能批量生成。
- 每个矩阵项必须先完成人工矩阵审核，再生成 Final EvidencePack 并通过正式 Evidence Gate。
- 合格稿进入抽检与 PublishSchedule，异常稿进入异常队列。
- 定时正式发布必须有人工前置确认和真实平台配置。
- 缺 Provider、Embedding、博客源、渠道数据或发布能力时返回 pending_config。
- 不伪造证据、引用、发布 URL、渠道数据或平台能力。
- 新规则包、索引、Prompt、模型、评测标准和 WorkflowDefinition 必须人工确认后激活。
- 所有写操作必须具备幂等、版本和审计。

## 8. 验证要求

数据底座：

- 任一新任务都有 monthlyPlanId、matrixVersionId 和 matrixItemId。
- 旧 weeklyPlanId 可追溯，但不再作为 V5 新写入真源。
- 迁移支持 dry-run、重复执行和差异报告。

流程：

- 月度矩阵未批准不能创建 BatchGenerationRun。
- 周视图和当日执行不能重新决定冻结字段。
- 每个进入 BatchGenerationRun 的矩阵项都有 Final EvidencePack，且正式 Evidence Gate 已通过。
- 自动质检通过后才能进入 PublishSchedule。
- 未完成发布前置确认不能执行定时正式发布。
- 周快照不能替代月度复盘。

端到端：

- 一个月度计划可以从目标输入运行到 MonthlyReview。
- 任意中断显示真实状态并可安全恢复。
- 任意正式结果可追溯到事实、证据、矩阵项、规则、版本、工具和人工决定。

## 9. 当前实现边界

本文档描述 V5 目标设计，不代表当前 V4 代码已经完成月度迁移。

现有 weekly-plan、today、drafts、publish 和 weekly report 页面应在实施时分别降级或升级为周视图、当日执行、异常稿抽检、发布排程和周过程快照。完成代码迁移前，界面仍可能保留 V4 周度术语，但不得反向覆盖 V5 设计。

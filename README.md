# 基于GEO优化的内容增长工作台 V5

基于GEO优化面向多产品矩阵的自动生产内容与发布的工作台。V5 把“问题—知识—月度策略—文章生产—排期执行—发布回传—前台观察—月度复盘”串成一条可追溯链路。

V5 的规划与复盘周期只有自然月：`MonthlyPlan -> date execution -> publish and metrics -> MonthlyReview -> next month proposal`。日期视图只能执行已批准的月度计划，不能成为第二套规划源。

## 项目结构

```text
src/app/                  Next.js App Router 页面与 API Routes
src/components/           可复用 UI 组件
src/lib/                  领域类型、Repository、Service、Provider 适配器
src/lib/v5/               V5 月度生产、知识治理、RAG、单篇文章等核心契约
workers/                  RAG、知识刷新、内容生产、发布等后台 Worker
arcs-runner/              AI 前台采集 Runner（Python）
capture-runner/            浏览器采集服务（Node.js）
scripts/                  校验、smoke、迁移、桥接和验收脚本
data/                     本地状态、文章类型和演示/导入数据
database/                 数据库 schema 与迁移
docs/方案与规划/           方案、实现记录、验收和阶段状态
design/                   原型与交互设计资料
review/                   复盘与上下文沉淀
```

页面和 API 共用领域契约；页面负责配置、确认、查看和人工接管，后台服务负责可重复的解析、索引、证据、生成和状态流转。

## 快速开始

### 环境

- Node.js 18.17+、npm 9+；推荐当前 LTS。
- Windows PowerShell 可直接运行仓库脚本；Next.js 本身也可在其他系统运行。
- 只浏览本地页面和隔离 smoke 时，不需要外部 Provider。
- 真正的 RAG/正式生产需要 MySQL、OpenSearch、Embedding Provider、正文 Provider，以及相应的渠道配置。

```powershell
npm.cmd install
npm.cmd run dev -- --hostname 127.0.0.1 --port 3047
```

访问 <http://127.0.0.1:3047>。也可使用项目提供的 `npm.cmd run dev:local` 启动脚本。

复制 `.env.local.example` 为 `.env.local` 后，只在本机填写真实配置。密钥、Cookie、Token、密码不得写入 README、日志、截图或 Git。

### 常用验证

```powershell
npm.cmd run typecheck
npm.cmd run validate:structure
npm.cmd run build
npm.cmd run smoke:pages
npm.cmd run smoke:workflow
```

浏览器验收使用隔离状态文件的脚本，例如 `npm.cmd run smoke:browser:v5`；不要同时启动多个共用 `.next` 目录的 Next.js 服务。

## 工作台页面结构

### 总览与基础配置

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 总览 | `/` | 查看月度矩阵、生产进度、异常、回传和复盘入口；只读导航，不修改策略 |
| 问题与关键词 | `/questions-keywords` | 维护问题池、关键词和月度目标问题 |
| 知识库 | `/knowledge`、`/knowledge/[id]` | 创建工作区、查看材料、理解结果和治理待办 |
| 文档/URL 导入 | `/knowledge/import/document`、`/knowledge/import/url` | 导入 Markdown、TXT、PDF、DOCX 或 URL 来源 |
| 规则包与索引 | `/knowledge/rule-packages`、`/knowledge/vectorize` | 查看规则包、索引状态和诊断；正式索引由后台链路负责 |
| 配置 | `/configuration`、`/settings` | 查看 Provider、表达规范、渠道和默认值状态 |

### 月度计划与生产

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 月度矩阵 | `/monthly-matrix` | 查看自然月、策略包、预检、渠道配额和正式任务，完成策略批准 |
| 策略配置 | `/monthly-matrix/strategy` | 选择问题、文章类型、渠道、配额、规则包和知识库，确认版本 |
| 文章类型 | `/monthly-matrix/content-types` | 创建、复制、编辑、启停文章类型版本 |
| 批量生成中心 | `/monthly-matrix/batch-generation` | 查看后台生成、证据包、正文、自动修复和人工排程 |
| 正文详情 | `/v5/drafts/[id]`、`/drafts/[taskId]` | 查看或编辑指定任务正文与证据上下文 |
| 当日执行 | `/daily-execution` | 按日期查看已批准任务、执行状态和失败接管 |
| 月度复盘 | `/monthly-review` | 汇总问题、计划、发布结果、指标并形成下月 Proposal |

### 发布、观察与扩展能力

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 发布与回传 | `/publish`、`/publish-schedule`、`/publish-schedule/daily-execution` | 管理排期、发布结果和渠道指标回传 |
| 博客候选/监控 | `/blog-candidates`、`/blog-monitor` | 管理候选主题、官网审计和博客表现观察 |
| AI 前台测试 | `/ai-front-test`、`/ai-front-test/environment` | 创建采集任务、查看回答/引用/对比和环境诊断 |
| 自由生产 | `/free-production`、`/free-production/tasks` | 处理非月度矩阵的自由内容生产；不改写月度计划 |
| 产品与研究 | `/products`、`/products/[productId]/research` | 管理产品、研究项目和 GEO 研究结果 |
| 兼容入口 | `/today`、`/batch-generation`、`/monthly-plan` 等 | 历史入口或跳转兼容，不建立第二套规划/复盘周期 |

## 各能力边界

### 系统自动完成

- 问题归一化、聚类、去重和关键词维护建议。
- 来源版本、Claim 提取、权威性/时效性裁决、索引、EvidencePack 和证据引用映射。
- 文章类型语义匹配建议、正文生成、事实校验、无依据段落剔除和有限次数自动修复。
- 已批准任务的状态流转、排程执行、发布结果回传和月度指标聚合。
- 前台采集任务的执行、回答/引用保存、差异对比和缺口记录。

### 必须由人确认

- 目标问题、产品优先级、文章类型版本和月度策略包。
- 规则包/Claim 的审核、冲突裁决、G6 准入和生产池激活。
- 正式内容的最终编辑、排期、外部平台风险接管和正式发布。
- 下月 Proposal 是否转为新的 `MonthlyPlan`。

### 明确不承诺

- 未配置真实 MySQL、OpenSearch、Embedding/正文 Provider 时，不承诺正式生产；状态应保持 `pending_config` 或 `failed`。
- 本地 fixture、mock adapter、HTTP 200、草稿箱写入不等于外部平台正式发布。
- 不伪造平台文章 ID、公开 URL、引用、采集结果或审批记录。
- 不在工作台内保存或展示密钥，不上传浏览器 Cookie/Token，不绕过验证码、二次确认或人工接管。
- 本地 JSON 适合单机开发和 smoke，不等同于多用户并发、跨实例一致性或生产恢复能力。

## 用户工作流

```text
目标问题
  -> 正式产品/知识与 active 规则包
  -> G6 人工准入
  -> MonthlyPlan 与文章类型匹配
  -> 月度策略包预检、批准、版本冻结
  -> 正式矩阵任务
  -> RAG EvidencePack 与正文生成
  -> 人工编辑和排期
  -> 当日执行/外部发布确认
  -> URL 与渠道指标回传
  -> AI 前台观察、官网审计
  -> MonthlyReview 与下月 Proposal
```

推荐操作顺序：

1. 在 `/questions-keywords` 确认当月问题和版本。
2. 在 `/knowledge` 导入并治理可信材料，确认知识库和规则包可用。
3. 在 `/monthly-matrix/content-types` 确认文章类型版本。
4. 在 `/monthly-matrix/strategy` 配置问题、类型、渠道和配额，完成预检后批准。
5. 在 `/monthly-matrix` 查看正式矩阵；在批量生成中心查看证据和正文。
6. 人工编辑、排期，在 `/daily-execution` 执行；外部平台发布后回填可验证 URL 和指标。
7. 在 `/monthly-review` 复盘并人工决定是否采用下月 Proposal。

资料导入后的 RAG 后台链路通常为：

```text
SourceAsset/SourceRevision -> Claim -> SourceSnapshot/Manifest
-> OpenSearch index -> EvidencePack -> DraftVersion -> fact validation
```

## 团队协作说明

- `main` 是集成分支；功能开发使用短生命周期分支和 Pull Request，提交说明写清影响范围与验证命令。
- 任何涉及 `MonthlyPlan`、`MonthlyReview`、`monthStart`、`monthEnd`、`monthlyPlanId` 的改动，必须同步更新契约、API、页面、测试和文档；禁止引入 weekly planning/review 命名。
- 页面改动需同时检查桌面/移动端 DOM、可访问性、加载/空状态和 `pending_config`/`manual_takeover_required`/`failed` 状态。
- 领域逻辑放在 `src/lib` 或 `src/lib/v5`，不要把业务规则散落在页面组件；外部平台通过 adapter/bridge 接入。
- 测试数据必须标注 `demo`、`mock`、`imported`、`real`、`pending_config` 或 `local_fallback`，不得把演示状态当作生产事实。
- 提交前至少运行 `npm.cmd run typecheck` 与 `npm.cmd run validate:structure`；涉及页面或流程时追加对应 smoke/test。
- 不提交 `.env.local`、凭证、Cookie、Token、私有链接、运行时状态和临时文件。发现敏感信息立即撤销并轮换，而不是继续传播。

## 关键方案文档索引

| 文档 | 说明 |
| --- | --- |
| [`V5_PRODUCTION_USER_FLOW_RUNBOOK.md`](./V5_PRODUCTION_USER_FLOW_RUNBOOK.md) | 正式生产链路、页面顺序、治理 API 和人工审批边界 |
| [`V5_BACKEND_INTEGRATION.md`](./V5_BACKEND_INTEGRATION.md) | 后端、MySQL、RAG、Provider 和运行时集成说明 |
| [`docs/usage.md`](./docs/usage.md) | 本地启动、配置诊断、常用验证和渠道接入说明 |
| [`docs/方案与规划/分支二-月度策略与批量生产开发文档.md`](./docs/方案与规划/分支二-月度策略与批量生产开发文档.md) | 月度策略、矩阵和批量生产方案 |
| [`docs/方案与规划/2026-07-24-v5-automatic-knowledge-production.md`](./docs/方案与规划/2026-07-24-v5-automatic-knowledge-production.md) | 自动知识生产、Evidence Gate 和 RAG 链路 |
| [`docs/方案与规划/2026-07-16-v5-real-rag-knowledge-production-integration-plan.md`](./docs/方案与规划/2026-07-16-v5-real-rag-knowledge-production-integration-plan.md) | 真实 RAG 生产集成计划与验收边界 |
| [`docs/方案与规划/2026-07-30-v5-geo-research-agent-implementation-plan.md`](./docs/方案与规划/2026-07-30-v5-geo-research-agent-implementation-plan.md) | GEO 研究 Agent 方案 |
| [`docs/方案与规划/P0-自动化发布能力与渠道配置说明书.md`](./docs/方案与规划/P0-自动化发布能力与渠道配置说明书.md) | 微信、CSDN、掘金、知乎草稿/发布适配和配置边界 |
| [`docs/方案与规划/V5公众号JOTO官方排版与正式HTML链路.md`](./docs/方案与规划/V5公众号JOTO官方排版与正式HTML链路.md) | 公众号排版与正式 HTML 链路 |
| [`docs/方案与规划/v5-ui-phase-status.md`](./docs/方案与规划/v5-ui-phase-status.md) | V5 UI 阶段状态与已知缺口 |

## 许可与数据安全

仓库当前用于 JOTO GTM 工作台研发与内部协作。外部部署前请补齐身份认证、访问控制、审计、密钥托管、数据库备份和渠道合规审核；正式发布始终以平台可验证结果和人工确认作为完成条件。

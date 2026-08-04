# 基于GEO优化的内容增长工作台 V5

基于GEO优化面向多产品矩阵的自动生产内容与发布的工作台。V5 把“问题—知识—月度策略—文章生产—排期执行—发布回传—前台观察—月度复盘”串成一条可追溯链路。

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
compose.yaml              core/full 本地生产编排
Dockerfile                Web standalone 与 Worker 多阶段镜像
DEPLOYMENT.md             部署、健康验收、备份和恢复手册
```

页面和 API 共用领域契约；页面负责配置、确认、创建耐久任务、查看结果和异常处理，后台服务负责可重复的解析、索引、证据、生成、发布与状态流转。

## 自动化机器发布能力

工作台已形成知乎、CSDN、掘金的机器发布主链路：终稿准入、Publish Job、幂等执行、浏览器会话发布、只读 reconciliation、公开 URL 回填、24h/72h 存活验证和可靠性统计使用同一套状态。CSDN 与知乎已经完成真实发布和公开 URL 回填；掘金可完成平台提交，但公开结果受平台风控影响，当前不能视为稳定发布。工程链路可用于受控的单篇、低频试运行，批量扩量门槛仍为 `rolloutReady: false`。

持续运行目前依赖本机进程。生产化的最简路径是把 Workbench API、Bridge、Arcs Runner 和 `direct-publish-worker` 部署到同一台带持久磁盘和 Chromium 的单实例云执行节点，使用云端定时器触发 worker 单轮扫描；前台只负责配置、结果展示和异常处理。Runner、Bridge 继续只监听 loopback，浏览器 profile 与凭证不得进入 Git 或公网。完整部署边界与测试证据见下方文档索引。

## 快速开始

### 推荐：Docker 本地生产版

完整模式会把 Web、持久化依赖和后台任务拆成可监控、可恢复的常驻服务：

```text
docker compose up -d
        │
        ├─ workbench-web       Next.js standalone production
        ├─ mysql               状态、治理、任务队列
        ├─ opensearch          RAG 关键词与向量检索
        ├─ rag-index-worker    索引构建与激活
        ├─ knowledge-worker    来源导入、知识刷新与采集
        ├─ content-worker      EvidencePack 与正文任务
        └─ publish-worker      到期发布、重试与状态回写
```

首次启动：

```powershell
Copy-Item .env.example .env
docker compose --profile full up -d --build
docker compose --profile full ps
```

默认访问 <http://127.0.0.1:3027>。运行状态位于 `/operations`，综合健康接口为 `/api/health`；`/api/health?deep=true` 会额外执行一次真实 Embedding 验收请求。

仓库提供两档模式：

| Profile | 组件 | 用途 |
| --- | --- | --- |
| `core` | Web、MySQL | 低资源体验基础工作台，不包含正式 RAG 和生产 Worker |
| `full` | Web、MySQL、OpenSearch、全部 Worker | 完整知识、检索、正文、发布与恢复链路 |

MySQL、OpenSearch 和运行状态使用命名 Volume；服务默认 `restart: unless-stopped`，并配置健康检查与日志轮转。浏览器登录态仍由宿主机扩展持有，容器只负责排程、租约、重试和状态回写。完整配置、资源建议、备份恢复及上线验收见 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。

### 本地开发

#### 环境

- Node.js 22.14+、npm 10+；与生产镜像保持一致可减少环境差异。
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
npm.cmd run test:v5-rag
npm.cmd run test:publish-frontend
npm.cmd run test:markdown-article
npm.cmd run smoke:pages
npm.cmd run smoke:workflow
docker compose --env-file .env.example --profile full config --quiet
```

浏览器验收使用隔离状态文件的脚本，例如 `npm.cmd run smoke:browser:v5`；不要同时启动多个共用 `.next` 目录的 Next.js 服务。

## 生产模式与页面性能

- Web 使用 `next build`、standalone 输出和多阶段镜像，不在长期运行环境使用 `next dev`。
- 月度工作区默认读取 compact projection；摘要、任务列表和正文详情拆分，正文只在打开预览时请求。
- 批量正文采用分页和按需加载，Markdown 标题、列表及换行在展示层统一归一化。
- RAG、知识刷新、正文生成和发布任务由独立 Worker 承担，不占用 Web 请求进程。
- OpenSearch 单节点业务索引副本数为 `0`，避免健康状态长期停在 `yellow`。
- 检索或 Provider 不可用时任务保持 `pending_config/failed`，不会降级为无证据生成。

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
| 发布控制塔 | `/publishing` | 创建 Publish Job，查看 Worker、reconciliation、URL 回填、24h/72h 与 reliability |
| 月度复盘 | `/monthly-review` | 汇总问题、计划、发布结果、指标并形成下月 Proposal |

### 发布、观察与扩展能力

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 发布与回传 | `/publishing`、`/publish`、`/publish-schedule` | 机器发布生命周期、排期兼容入口、结果和渠道指标回传 |
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
- 已批准终稿的 Publish Job、Worker 发布、只读 reconciliation、URL 自动回填、24h/72h 存活验证和月度指标聚合。
- 前台采集任务的执行、回答/引用保存、差异对比和缺口记录。

### 必须由人确认

- 目标问题、产品优先级、文章类型版本和月度策略包。
- 规则包/Claim 的审核、冲突裁决、G6 准入和生产池激活。
- 正式内容的最终编辑与排期；确认后正常发布链路由机器执行，平台风控或登录异常按失败关闭处理。
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
  -> 当日执行创建 Publish Job
  -> Worker 发布、reconciliation 与 URL 自动回填
  -> 24h/72h 存活验证与渠道指标
  -> AI 前台观察、官网审计
  -> MonthlyReview 与下月 Proposal
```

推荐操作顺序：

1. 在 `/questions-keywords` 确认当月问题和版本。
2. 在 `/knowledge` 导入并治理可信材料，确认知识库和规则包可用。
3. 在 `/monthly-matrix/content-types` 确认文章类型版本。
4. 在 `/monthly-matrix/strategy` 配置问题、类型、渠道和配额，完成预检后批准。
5. 在 `/monthly-matrix` 查看正式矩阵；在批量生成中心查看证据和正文。
6. 人工编辑、排期，在 `/daily-execution` 创建机器发布任务；在 `/publishing` 查看 URL 回填、24h/72h 与 reliability。
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
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Docker Compose、core/full Profile、健康检查、备份恢复与上线验收 |
| [`docs/dynamic-knowledge-collection-governance.md`](./docs/dynamic-knowledge-collection-governance.md) | 指定站点与微信公众号文章的每日采集、识别归档、知识库路由和动态治理方案 |
| [`docs/usage.md`](./docs/usage.md) | 本地启动、配置诊断、常用验证和渠道接入说明 |
| [`docs/方案与规划/分支二-月度策略与批量生产开发文档.md`](./docs/方案与规划/分支二-月度策略与批量生产开发文档.md) | 月度策略、矩阵和批量生产方案 |
| [`docs/方案与规划/2026-07-24-v5-automatic-knowledge-production.md`](./docs/方案与规划/2026-07-24-v5-automatic-knowledge-production.md) | 自动知识生产、Evidence Gate 和 RAG 链路 |
| [`docs/方案与规划/2026-07-16-v5-real-rag-knowledge-production-integration-plan.md`](./docs/方案与规划/2026-07-16-v5-real-rag-knowledge-production-integration-plan.md) | 真实 RAG 生产集成计划与验收边界 |
| [`docs/方案与规划/2026-07-30-v5-geo-research-agent-implementation-plan.md`](./docs/方案与规划/2026-07-30-v5-geo-research-agent-implementation-plan.md) | GEO 研究 Agent 方案 |
| [`docs/方案与规划/P0-自动化发布能力与渠道配置说明书.md`](./docs/方案与规划/P0-自动化发布能力与渠道配置说明书.md) | 微信、CSDN、掘金、知乎草稿/发布适配和配置边界 |
| [`docs/方案与规划/2026-08-03-自动化机器发布链路能力与测试结果.md`](./docs/方案与规划/2026-08-03-自动化机器发布链路能力与测试结果.md) | 当前机器发布能力、真实测试结果、可靠性结论、卡点与云端常驻部署路径 |
| [`docs/方案与规划/2026-07-31-三平台自动化发布能力测试验证报告.md`](./docs/方案与规划/2026-07-31-三平台自动化发布能力测试验证报告.md) | 知乎、掘金、CSDN 真实自动发布测试环境、结果、能力判断与卡点 |
| [`docs/方案与规划/2026-08-04-3027自动发布前台接入说明.md`](./docs/方案与规划/2026-08-04-3027自动发布前台接入说明.md) | 3027 的统一发布结果账本、数据回传、旧 42 篇快照迁移、URL 回填、存活验证与 reliability 接线 |
| [`docs/方案与规划/V5公众号JOTO官方排版与正式HTML链路.md`](./docs/方案与规划/V5公众号JOTO官方排版与正式HTML链路.md) | 公众号排版与正式 HTML 链路 |

## 许可与数据安全

仓库当前用于 JOTO GTM 工作台研发与内部协作。外部部署前请补齐身份认证、访问控制、审计、密钥托管、数据库备份和渠道合规审核；全机器正式发布始终以平台公开结果、URL 回填和持续存活验证作为完成条件。

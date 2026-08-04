# JOTO GEO 内容增长工作台 V5

JOTO GEO 内容增长工作台是一套以“知识与产品为输入、自动化内容增长为输出”的月度运营系统。

用户只需要完成两件事：

1. 绑定需要推广的产品；
2. 上传产品知识，或配置允许持续采集的站点与微信公众号。

系统随后自动完成 GEO 调研、真实问题与关键词沉淀、策略包生成、内容矩阵、正文生产、发布排程、发布状态回传、AI 前台测试与数据复盘。所有自动结果都保留人工修改入口，但日常使用默认只处理异常和关键判断。

## 当前产品形态

侧栏只保留六个一级入口：

| 页面 | 路径 | 核心职责 |
| --- | --- | --- |
| 首页 | `/` | 每 15 秒更新关键 KPI、七阶段自动化流程、内容产线、人工待办与最近流转，并提供“绑定产品”“上传知识”快捷入口 |
| 知识库 | `/knowledge` | 统一承载产品绑定、知识导入、全网 GEO 调研、真实问题与关键词池、站点/公众号持续采集和知识治理 |
| GEO 内容中心 | `/monthly-plan` | 在同一个自然月工作区完成策略、矩阵任务、正文生成和自动排程；筛选上下文跨步骤共享 |
| 公众号生产中心 | `/free-production` | 保留 V5 单篇内容生产完整链路：表达预设、资料补充、正文生成、风险复检、人工确认与公众号发布队列 |
| GEO 监控塔 | `/geo-monitor` | 统一查看发布状态与数据回传、官网博客监控、AI 前台测试和 GEO 数据复盘 |
| 设置 | `/settings` | 模型、连接、默认规则、权限、日志五类配置，并提供公众号订阅 API 监控台；系统状态只在异常或管理员场景展示 |

旧路由继续作为兼容入口存在，但不再出现在主导航中。博客候选池已退出当前产品链路。

## 用户旅程

```text
绑定产品 + 上传知识/配置站点或公众号
          │
          ▼
全网 GEO 调研与长期站点监控
          │
          ▼
真实问题池 + 关键词池
          │
          ▼
系统生成月度策略包
          │
          ▼
内容矩阵 + 正文生产 + 自动发布排程
          │
          ▼
发布状态与数据回传
          │
          ▼
AI 前台测试 + GEO 数据复盘
          │
          └── 形成下一个自然月的策略输入
```

系统自动承担重复执行，人只保留三类介入：

- 修正自动生成的问题、关键词、策略、正文或排程；
- 处理知识冲突、证据不足、渠道登录和发布失败等异常；
- 决定产品优先级、最终内容判断和正式发布边界。

## 首页实时工作区

首页不是静态报表，而是整条链路的实时状态面板：

- KPI：知识可用量、真实问题、本月目标、已成稿、已排程、已发布、需人工处理；
- 七阶段流水线：知识采集、GEO 调研、月度策略、内容生产、自动排程、发布回传、数据复盘；
- 内容产线：月度任务完成比例及各状态分布；
- Human in the loop：只呈现真正需要人工判断的异常；
- 最近流转：展示当前自然月最新任务与状态变化。

首次读取真实数据前显示“—/读取中”，不会用演示数字冒充运行结果。部分接口失败时保留最近一次有效数据，其余接口继续刷新。

## GEO 内容中心

`/monthly-plan` 是唯一的月度内容工作区，使用自然月作为规划和复盘周期：

1. **月度策略**：系统基于产品知识、GEO 调研、问题池与关键词池生成策略包；设置在右侧抽屉完成，不跳转新页面；
2. **矩阵任务**：将策略转换为按问题、文章类型和渠道拆分的正式任务；
3. **内容生成**：后台生成 EvidencePack、正文与自动修复结果；
4. **自动排程**：系统生成发布日期与渠道安排，用户可按需调整。

业务页不再重复展示大面积 KPI 卡片，只保留紧凑状态条；完整指标统一回到首页查看。

## 公众号生产中心

`/free-production` 承接原 V5 自由内容生产的完整能力，但以“公众号生产中心”作为用户入口：

- 从表达预设中选择文章类型，也可以在当前工作区新建类型；
- 绑定产品与知识快照，补充事实、素材和会议文本；
- 生成单篇正文并保留证据、风险项、局部补充和全文复检；
- 人工确认当前终稿后进入正式公众号发布队列；
- 在 `/free-production/tasks` 查看批次状态并只重试失败任务，不覆盖已成功结果。

该页面是面向临时选题和单篇需求的人工发起链路；系统自动生成的月度矩阵仍统一在 GEO 内容中心运行。

## 站点与公众号持续导入

知识库“资料与来源”提供两个明确入口：

- **导入站点**：持续读取站点、Sitemap、RSS 或 Atom；
- **订阅公众号**：先在外部订阅服务中关注账号，再使用 `subscriptionId` 或完全一致的公众号名称导入。

两种来源共用同一条知识链路：定时发现、正文拉取、内容去重、产品归属、知识库归档、治理与索引。公众号订阅服务只提供合法授权范围内的文章列表，工作台不会绕过登录、验证码或平台访问控制。

## GEO 监控塔

`/geo-monitor` 将原发布控制塔、数据回传、官网博客监控、AI 前台测试和数据复盘合并为一个页面，负责：

- Publish Job、Worker、重试、reconciliation 和公开 URL 回填；
- 发布后 24h/72h 存活验证和渠道数据回传；
- 指定官网与博客来源的内容变化监控；
- AI 搜索前台回答、引用、品牌提及和差异观察；
- 按自然月形成 GEO 数据复盘。

外部平台是否发布成功，以平台公开结果、URL 回填和持续存活验证为准。草稿箱写入、HTTP 200 或本地模拟结果不等于正式发布。

## 仓库内置的腾讯云 ADP 内容快照

仓库中的 [`data/v5-monthly-workbench.json`](./data/v5-monthly-workbench.json) 保留了当前 2026-08 腾讯云 ADP 月度工作区快照：

| 项目 | 数量 |
| --- | ---: |
| 月度内容任务 | 42 篇 |
| 含完整正文 | 42 篇 |
| 已进入排程 | 42 篇 |
| 微信公众号 | 6 篇 |
| CSDN | 8 篇 |
| 掘金 | 8 篇 |
| 知乎/头条通用长文 | 20 篇 |

每个任务都保留知识库引用、来源快照、问题、文章类型、渠道、正文和排程信息。该文件用于本地恢复与产品验收，是一个明确时间点的数据快照，不代表外部平台的实时发布数量。

## 技术结构

```text
src/app/                  Next.js App Router 页面与 API Routes
src/components/           工作台通用 UI 与月度流程组件
src/lib/v5/               月度策略、自动化、GEO 调研、知识治理与 RAG 领域服务
workers/                  知识刷新、GEO 调研、内容生产、排程与发布 Worker
data/                     可提交的产品数据、月度内容快照和测试数据
database/                 MySQL schema 与迁移
scripts/                  校验、迁移、smoke、备份和验收脚本
compose.yaml              core/full Docker Compose 编排
Dockerfile                Web standalone 与 Worker 多阶段镜像
```

核心运行链路：

```text
Next.js Web/API
  ├─ MySQL：业务状态、任务、治理与发布记录
  ├─ OpenSearch：RAG 关键词和向量检索
  ├─ knowledge/geo workers：知识刷新、站点采集和 GEO 调研
  ├─ monthly/content workers：策略、任务、正文和排程
  └─ publish workers：渠道发布、重试、回传和存活验证
```

页面只负责配置、修改、查看结果和处理异常；可重复执行的采集、检索、生成、排程和回传都放在 Service/Worker 中。

## 快速开始

### Docker 完整模式

环境要求：Docker Desktop，以及可用于本地填写的 Provider、数据库和渠道配置。

```powershell
Copy-Item .env.example .env
docker compose --profile full up -d --build
docker compose --profile full ps
```

访问：<http://127.0.0.1:3027>

健康检查：

```text
GET http://127.0.0.1:3027/api/health?scope=web
```

Compose Profile：

| Profile | 组件 | 用途 |
| --- | --- | --- |
| `core` | Web、MySQL | 基础工作台和低资源体验 |
| `full` | Web、MySQL、OpenSearch、全部 Worker | 完整知识、调研、生产、发布与恢复链路 |

### 本地开发

要求 Node.js 22.14+、npm 10+：

```powershell
npm.cmd install
npm.cmd run dev -- --hostname 127.0.0.1 --port 3047
```

访问：<http://127.0.0.1:3047>

## 配置与数据边界

公众号订阅采集由管理员在部署环境或本地 `.env.local` 自行配置：

```text
WECHAT_COLLECTION_BASE_URL=<订阅服务 API 地址>
WECHAT_COLLECTION_API_KEY=<服务后台创建的 API Key>
```

配置后需重启 Web 与知识采集 Worker。设置页“连接 → 公众号订阅监控台”只展示是否配置、来源数量与异常数，不接收、不保存、也不回显实际 API 地址和密钥。

- `.env.example`、`.env.local.example` 只提供字段模板，可以提交；
- `.env`、`.env.local`、任何真实密钥、Token、Cookie、密码和浏览器 profile 不得提交；
- MySQL/OpenSearch Volume 属于运行时数据，不直接进入 Git；需要迁移时使用脱敏快照或项目备份脚本；
- `data/v5-monthly-workbench.json` 是经过确认、允许随代码交付的月度内容快照；
- Provider 未配置时保持 `pending_config/failed`，不降级为无证据生成；
- 运行状态、公开 URL 和渠道结果不得伪造。

## 验证

提交前至少执行：

```powershell
npm.cmd run typecheck
npm.cmd run validate:structure
npm.cmd run build
```

涉及具体领域时可继续执行：

```powershell
npm.cmd run test:v5-rag
npm.cmd run test:publish-frontend
npm.cmd run test:markdown-article
npm.cmd run smoke:pages
npm.cmd run smoke:workflow
```

项目只使用 `MonthlyPlan`、`MonthlyReview`、`monthStart`、`monthEnd` 和 `monthlyPlanId` 表达规划与复盘周期，不引入其他独立规划或复盘来源。

## 关键文档

| 文档 | 用途 |
| --- | --- |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Docker、健康检查、备份恢复和上线验收 |
| [`V5_PRODUCTION_USER_FLOW_RUNBOOK.md`](./V5_PRODUCTION_USER_FLOW_RUNBOOK.md) | 正式生产链路与人工边界 |
| [`V5_BACKEND_INTEGRATION.md`](./V5_BACKEND_INTEGRATION.md) | MySQL、RAG、Provider 和运行时集成 |
| [`docs/usage.md`](./docs/usage.md) | 本地启动、配置诊断与渠道接入 |
| [`docs/dynamic-knowledge-collection-governance.md`](./docs/dynamic-knowledge-collection-governance.md) | 指定站点与公众号的持续采集治理 |
| [`docs/方案与规划/2026-08-04-3027自动发布前台接入说明.md`](./docs/方案与规划/2026-08-04-3027自动发布前台接入说明.md) | 3027 发布结果账本、回传和旧内容迁移 |

## 安全与合规

仓库用于 JOTO GTM 工作台研发与内部协作。外部部署前需补齐身份认证、访问控制、操作审计、密钥托管、数据库备份和渠道合规审核。任何真实凭证如果曾进入 Git 历史，应立即撤销并轮换，不能仅通过后续删除文件解决。

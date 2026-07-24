# 基于GEO优化的自动化内容生产工作台 V5

基于GEO优化的自动化内容生产工作台面向企业内容增长、GEO 运营、知识维护和发布协作团队。V5 将问题、知识、月度策略、内容生产、发布结果、AI 前台观察和月度复盘连接成一条可追溯链路。

它不是通用 AI 写作器，也不把“生成一篇文章”当作终点。系统的目标是让内容从事实依据出发，经人工批准后生产，并用真实发布与观察结果推动下一个月的决策。

## 1. V5 主流程

V5 只使用自然月作为规划和复盘周期：

```text
问题与知识准备
-> MonthlyPlan 与内容策略包
-> 月度内容矩阵
-> Evidence Gate
-> 批量生成与自动修复
-> 人工排程与日期执行
-> 发布 URL 和渠道指标回传
-> AI 前台测试与官网审计
-> MonthlyReview
-> 下月 Proposal
-> 人工批准新的 MonthlyPlan
```

核心规则：

- `MonthlyPlan` 是规划真源。日期和工作日只用于查看、排程和执行已批准内容。
- 月度周期从当月第一天开始，到当月最后一天结束。
- 问题版本、知识快照、内容类型版本、规则包和证据快照在进入生产时冻结，后续更新不覆盖历史计划。
- Evidence Gate 未通过的任务不能进入正式正文生成。
- 系统可以自动归类、推荐、修复和重试，但策略批准、风险例外、正式发布和下月计划仍由人决定。
- 缺少真实 Provider、数据库、浏览器伴侣或发布连接时返回明确阻塞状态，不伪造正文、引用、采集或发布成功。

## 2. 当前交付状态

| 能力层 | 当前状态 | 说明 |
| --- | --- | --- |
| 问题、关键词、知识库、表达预设 | 已提供 V5 页面、契约、Service 和 API | 默认可使用隔离本地状态；正式资料、索引和模型能力取决于外部配置 |
| 月度策略与内容矩阵 | 已提供配置、预检、批准、版本冻结和渠道任务展开 | 未批准策略不能生产；真实生成仍依赖 MySQL、RAG、EvidencePack 和正文 Provider |
| 内容类型库 | 已提供自定义类型、版本、启停和语义匹配 | AI 只提供待确认建议，不自动覆盖或发布用户配置 |
| 批量生成与排程 | 已提供页面、状态机、自动修复和技术重试契约 | 缺少正式生产 Repository 时保持阻塞状态，不写入伪正文 |
| 日期执行与数据回传 | 已提供兼容执行、URL 回填和指标导入链路 | 真实发布是否可用取决于各平台适配器，HTTP 200 不等于公开发布成功 |
| AI 前台测试 | 已提供任务、回答、引用、对比、缺口复核、浏览器伴侣和本地 Runner | P0 仅定义 ChatGPT DOM 适配器；其他平台未达到支持标准时必须显示“尚未支持” |
| 月度复盘 | 已提供问题级聚合和下月 Proposal | Proposal 不会自动创建下月任务，也不会回写已批准策略 |
| 官网审计 | 已合并到官网博客监控页签 | 与 AI 前台测试保持独立对象、状态和指标，不生成统一总分 |
| 权限 | 已提供五类业务角色和页面可见范围 | 这是业务权限边界，不是完整企业 IAM；公网部署前必须补充统一认证 |

## 3. 快速启动

### 环境要求

- Node.js 18.17 或更高版本，推荐当前 LTS。
- npm 9 或更高版本。
- Windows PowerShell。Next.js 可运行在其他系统，但部分仓库脚本按 Windows 设计。
- Chrome。只有浏览器 smoke、AI 前台采集或平台浏览器适配需要。
- MySQL 8.x。只有启用正式 V5 持久化和生产链路时需要。

### 安装与运行

```powershell
npm.cmd install
npm.cmd run dev:local
```

默认本地地址：

```text
http://127.0.0.1:3047
```

也可以指定端口：

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3047
```

不配置外部服务也可以查看页面和本地流程。依赖真实能力的区域会显示 `pending_config`、待连接或尚未支持，不应通过 mock 掩盖缺失配置。

## 4. 页面功能与边界

### 4.1 总览与基础准备

| 页面 | 路由 | 主要功能 | 能力边界 |
| --- | --- | --- | --- |
| 首页数据看板 | `/` | 汇总本月矩阵量、生成进度、异常、回传和复盘待办，提供主流程入口 | 只做读取和导航，不在首页修改策略、正文或发布状态 |
| 问题与关键词池 | `/questions-keywords` | 聚合业务信号、自动规范化和去重问题、维护关键词、处理问题池冲突、选择月度目标问题 | 主体知识库同时具备产品表达规则包和事实来源映射且无冲突时自动可用；缺任一对象进入观察；与现有问题池存在语义或业务冲突时进入待决策。选择问题时锁定 `questionVersionId`，但不代表已通过生成证据准入 |
| 知识库列表 | `/knowledge` | 创建知识库、查看重点、状态和待处理数量 | 创建知识库不等于资料已可生产；正式可用性由资料处理和关键证据决定 |
| 知识库详情 | `/knowledge/[id]` | 查看资料、系统理解和真正需要用户处理的事项，按需展开原文依据 | `Source`、`Chunk`、`Claim`、哈希和底层治理规则默认隐藏；知识库重点不是可直接引用的产品事实 |
| 内容导入 | `/knowledge/import` | 选择目标知识库和资料接入方式 | 只负责导入入口，不绕过资料解析、公开范围和治理检查 |
| URL 导入 | `/knowledge/import/url` | 导入网页、博客索引或其他 URL 来源 | 抓取成功不等于事实可公开使用；真实抓取取决于连接配置 |
| 文档导入 | `/knowledge/import/document` | 导入 Markdown、TXT、PDF、DOCX 等资料 | 文件解析结果仍需经过知识治理；不应上传含密钥或私人数据的文档 |
| 知识向量化 | `/knowledge/vectorize` | 查看和触发知识索引准备 | 向量化完成不等于 Evidence Gate 通过，也不替代人工批准规则包 |
| 规则包管理 | `/knowledge/rule-packages` | 查看产品表达规则包和治理状态 | 草稿不会自动生效；激活、回滚和风险边界需要授权角色确认 |

### 4.2 月度策略与生产

| 页面 | 路由 | 主要功能 | 能力边界 |
| --- | --- | --- | --- |
| 月度内容矩阵 | `/monthly-matrix` | 查看自然月、内容策略包、预检结果、渠道成品总量和展开后的矩阵任务；批准内容策略包 | 这是 V5 规划主入口；批准后生成中心只能执行，不能反向改变策略字段 |
| 月度策略工作区 | `/monthly-matrix/strategy` | 选择目标问题、内容类型、渠道、每渠道配额、规则包和知识库，确认版本 | “配额 4 + 两个渠道”表示每个渠道 4 篇，共 8 篇；AI 推荐不会自动保存、批准或绕过证据检查 |
| 内容类型库 | `/monthly-matrix/content-types` | 从模板创建业务类型、复制、编辑新版本、启用或停用，查看语义匹配建议 | 模板不是不可修改的固定枚举；类型匹配只说明内容适合度，不代表允许生产 |
| 批量生成中心 | `/monthly-matrix/batch-generation` | 对已批准矩阵任务生成正文、自动检查与修复、技术重试、正文预览和人工排程 | 不能编辑月度目标、渠道或配额；只有缺少主题成立所需关键事实时才产生用户待办；内部评分和技术错误不直接暴露给业务用户 |
| 正文深链接 | `/v5/drafts/[id]` | 恢复指定正文的预览上下文 | 不作为独立导航或第二套正文工作区；正文仍归属于矩阵任务和生成运行 |

### 4.3 执行、发布与回传

| 页面 | 路由 | 主要功能 | 能力边界 |
| --- | --- | --- | --- |
| 当日执行 | `/daily-execution` | 按昨日、今日、明日查看已批准内容的发布任务、状态和失败接管入口 | 只处理执行，不创建规划或修改月度策略；未排程内容应返回批量生成中心 |
| 数据回传 | `/publish` | 将渠道数据匹配到已发布文章，导入或手动补录阅读、点赞等指标 | 不负责发布确认和 URL 创建；缺少正式 URL 时不能稳定匹配渠道数据 |
| 博客候选池 | `/blog-candidates` | 接收博客监控产生的候选主题，确认、标记规划、移出或导出清单 | 当前仍包含历史兼容任务承接逻辑，不是新的 V5 规划真源；正式内容必须回到 MonthlyPlan 审批链路 |

### 4.4 观察、复盘与官网审计

| 页面 | 路由 | 主要功能 | 能力边界 |
| --- | --- | --- | --- |
| 官网博客监控 | `/blog-monitor` | 同步博客、查看文章表现和内容诊断 | 监控结果是规划信号，不自动生成正式矩阵任务 |
| 官网审计 | `/blog-monitor?tab=site-audit` | 检查技术、Schema、内容和可引用性，维护发现项、整改和复审 | 不建立独立导航或复盘周期；未配置 Runner 时不填充模拟问题 |
| AI 前台测试 | `/ai-front-test` | 创建立即执行的单次采集任务，查看回答与引用证据，任选两次任务对比，人工确认缺口去向 | 不创建固定日期自动采集计划；观察结果不能自动升级为事实、Claim 或月度任务 |
| 采集环境 | `/ai-front-test/environment` | 查看浏览器伴侣、本地 Runner 和平台适配器状态，提供可执行恢复建议 | 服务端不模拟登录；不上传 Cookie、密码、Token、自动填充信息或与任务无关的页面内容 |
| 月度复盘 | `/monthly-review` | 按目标问题关联 MonthlyPlan、已发布内容、指标和 AI 回答，形成下月建议 | 只创建待审批 Proposal；不回写已批准策略包，不重新计算渠道配额 |

### 4.5 配置、角色与系统设置

| 页面 | 路由 | 主要功能 | 能力边界 |
| --- | --- | --- | --- |
| 配置管理 | `/configuration` | 管理模型状态、文章表达预设、发布连接、前台测试连接、版本和调用日志 | 页面只显示配置状态和缺失项，不回显密钥；表达预设是表单化约束，不允许普通用户直接编辑完整 Prompt |
| 工作台设置 | `/settings` | 设置当前角色、默认知识库、产品表达规则包、渠道、产能和数据来源等长期默认值 | 当前页面包含部分历史默认设置，不能把临时执行配置反写成 MonthlyPlan 真源；角色切换不是企业身份认证 |

## 5. 兼容入口

V5 已把重复入口收敛到正式页面：

| 旧入口职责 | 当前去向 |
| --- | --- |
| 独立策略入口 | `/monthly-matrix` 或 `/monthly-matrix/strategy` |
| 顶层批量生成、异常和独立排程入口 | `/monthly-matrix/batch-generation` |
| 嵌套日期执行入口 | `/daily-execution` |
| 旧问题词池入口 | `/questions-keywords` |
| 旧 AI 配置与连接入口 | `/configuration` 及其连接页签 |

仓库仍保留少量 V4 页面和 API 以支持迁移与回归测试。它们不是 V5 规划或复盘真源，不应在新功能中继续扩展，也不应与 `MonthlyPlan`、`MonthlyReview` 建立第二套并行业务契约。

## 6. 自动化与人工决策边界

| 系统可以自动完成 | 必须由人确认 |
| --- | --- |
| 问题归一化、聚类、去重和关键词维护 | 主体归属、合作关系、公开边界和敏感表达冲突 |
| 内容类型语义匹配和待确认建议 | 自定义内容类型版本的启用或停用 |
| Evidence Preview、证据缺口定位和局部阻断 | 月度内容策略包批准 |
| 正文生成后的规则检查、最多两轮自动修复和技术重试 | 高风险表达、证据降级和风险例外 |
| 已批准任务的状态流转和可恢复失败处理 | 正式发布前置确认和人工接管 |
| 回答陈述映射和候选内容/证据缺口 | 观察缺口的业务去向 |
| 月度数据聚合和下月 Proposal | 新月份 MonthlyPlan 的最终批准 |

### 明确不承诺的能力

- 不承诺在未配置 MySQL、OpenSearch、Embedding、正文 Provider 或正式规则包时执行真实生产。
- 不把本地 fallback、fixture、mock adapter、HTTP 200 或按钮点击当作真实外部成功。
- 不把平台草稿箱写入等同于正式发布；正式成功需要平台返回结果、内容 ID、公开 URL 或可验证状态。
- 不绕过验证码、账号确认、平台风控、发布审核或人工接管。
- 不在本地 JSON 模式下承诺多用户高并发、跨实例一致性或生产级恢复能力。
- 不允许 Workflow Agent 自主批准规则、策略、风险例外或正式发布。
- 不允许 AI 前台测试上传浏览器凭证、完整会话或非目标页面内容。
- 不根据两次采集直接输出趋势结论；采集条件不一致时必须显示差异警告。

## 7. 角色与权限

| 角色 | 主要职责 | 典型入口 |
| --- | --- | --- |
| 内容发布人员 | 查看日期任务、处理发布失败、确认 URL 和回传数据 | 当日执行、数据回传 |
| 内容增长 / GEO 人员 | 选择月度目标问题、审核策略、查看监控和月度复盘 | 问题与关键词池、月度内容矩阵、月度复盘、AI 前台测试 |
| 工作台运营 / 质量评估 | 维护生产队列、排程、异常恢复和运行质量 | 月度内容矩阵、批量生成中心、配置管理 |
| 知识库 / 产品表达维护 | 导入资料、处理知识缺口、维护表达预设和规则包 | 知识库、问题与关键词池、配置管理 |
| 开发管理员 | 诊断数据库、Provider、Runner、发布适配器和版本 | 配置管理、采集环境、工作台设置 |

权限原则：未授权页面不应返回内部业务数据；Prompt 原文、密钥、原始模型 trace 和内部评分默认不在普通业务页面展示。

## 8. 数据与真实状态

当前存在三类数据来源：

1. V5 领域 Repository：问题、关键词、知识工作区、内容类型、月度策略、生成、观察和复盘契约。
2. MySQL 与外部索引：用于正式月度、知识、RAG、EvidencePack 和正文生产，需显式配置。
3. 本地 JSON 与隔离 fixture：用于单机试运行、兼容页面和 smoke，不代表真实生产数据。

数据标签必须保持明确：

- `real`：真实外部或生产数据。
- `imported`：人工或文件导入数据。
- `demo` / `mock`：演示与测试数据。
- `pending_config`：缺少真实配置，当前不可执行。
- `local_fallback`：本地可继续，但不能等同外部 Provider 成功。

默认本地状态文件和 smoke 状态文件已由 `.gitignore` 管理，不应提交到 GitHub。

## 9. 外部能力配置

真实值只能存放在 `.env.local` 或部署平台 Secret Manager。README、Git、日志、截图和聊天记录中不得出现密钥值。

配置分为：

- MySQL 与工作台存储。
- 内容生成和 Embedding Provider。
- 知识抓取、解析、OpenSearch 和 RAG。
- 微信草稿桥接及其他平台发布适配器。
- 浏览器伴侣、本地 Capture Runner 和 AI 平台适配器。
- 日志、CDN、渠道指标和 Pipeline Worker。

配置诊断入口：

```text
GET /api/runtime-config/status
GET /api/config-diagnostics
GET /api/ai-governance
GET /api/v5/configuration/status
```

这些接口只返回能力状态、缺失字段名和业务可读错误，不返回配置值。

### 可选：MySQL

```powershell
npm.cmd run check:mysql
node scripts/init-v5-monthly-schema.mjs --plan
npm.cmd run init:mysql
```

数据库迁移必须先执行计划检查并准备备份。禁止在未确认数据归属时启用任何删除 V4 数据的参数。

### 可选：AI 前台采集

```powershell
npm.cmd run capture-runner:start
```

浏览器伴侣代码位于 `browser-extension/`，本地 Runner 位于 `capture-runner/`。Runner 只绑定本机回环地址；平台登录由用户在浏览器中完成，服务端不保存账号凭证。

## 10. 验证与测试

### 基础验证

```powershell
npm.cmd run typecheck
npm.cmd run validate:structure
npm.cmd run smoke:interactions
npm.cmd run build
```

### V5 契约

```powershell
npm.cmd run test:v5-foundation
npm.cmd run test:v5-monthly-production
npm.cmd run test:v5-article-types
npm.cmd run test:v5-observation
```

### 页面与工作流

页面 smoke 需要已有本地服务：

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3047
npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3047
```

隔离 smoke 会使用独立状态文件和临时服务：

```powershell
npm.cmd run smoke:workflow
npm.cmd run smoke:workflow:isolated
npm.cmd run smoke:browser:v5
npm.cmd run smoke:browser:content:isolated
```

`smoke:workflow` 本身使用隔离 runner；保留显式 `:isolated` 命令用于脚本契约和定向调用。默认优先使用隔离 smoke。带 `:main` 的脚本会直接连接已有服务或主状态，日常开发不要用它们替代隔离验证。

## 11. 项目结构

| 目录 | 职责 |
| --- | --- |
| `src/app/` | 页面、布局和 Next.js Route Handlers |
| `src/components/` | 业务组件和通用 UI |
| `src/lib/v5/` | V5 问题、知识、月度、生成、观察、复盘契约与 Service |
| `src/lib/` | 权限、运行配置、兼容领域和发布适配器 |
| `database/` | Schema 与 migrations |
| `workers/` | RAG、博客、日志、渠道指标和 Pipeline Worker |
| `scripts/` | 初始化、诊断、结构检查、契约测试和 smoke |
| `browser-extension/` | AI 前台测试浏览器伴侣 |
| `capture-runner/` | 本地采集任务 Runner |
| `data/` | 本地状态和测试夹具；生产数据不应依赖此目录 |
| `docs/` | 使用说明、方案、阶段记录和 V5 设计依据 |

## 12. 部署与安全

生产构建：

```powershell
npm.cmd run typecheck
npm.cmd run validate:structure
npm.cmd run build
npm.cmd run start -- --hostname 0.0.0.0 --port 3047
```

生产环境至少需要：

1. HTTPS 反向代理和统一身份认证。
2. Secret Manager、最小权限数据库账号和备份策略。
3. Web、Worker、Scheduler 分离运行。
4. 外部调用超时、重试上限、幂等键、费用监控和失败告警。
5. 发布任务的单任务互斥、人工接管和可验证结果。
6. 原始采集工件的脱敏、保留周期、删除审计和访问授权。

禁止提交或公开：

- `.env`、`.env.local` 和任何真实密钥内容。
- Token、Cookie、私有请求头、浏览器 profile 和登录会话。
- 客户资料、未公开产品事实、原始模型 trace 和私有知识库正文。
- 运行日志、临时状态、截图中的账号信息和未脱敏导出物。

## 13. 相关文档

- `AGENTS.md`：项目最高优先级业务、命名、验证与安全规则。
- `docs/usage.md`：运行、smoke 和专项链路说明。

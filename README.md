# 基于GEO的内容自动化工作台

基于GEO的内容自动化工作台是一套以“知识与产品为输入、自动化内容增长为输出”的月度运营系统。

发起托管时，用户只需要完成三件事：

1. 选择已有产品，或上传产品资料并填写产品官网；
2. 选择已经具备托管能力的推广渠道；
3. 填写接收确认链接和发布结果的邮箱。

系统随后自动完成 GEO 调研、真实问题与关键词沉淀、策略包生成、内容矩阵、正文生产、发布排程、发布状态回传、AI 前台测试与数据复盘。用户只需通过邮件各确认一次 GEO 策略和代表样文；进入正式托管后，系统按渠道每日安全上限执行，并在当日批次关闭后回传公开 URL。所有自动结果都保留人工修改入口，但日常使用默认只处理异常和关键判断。

## 能力边界

### 当前能够完成

- 绑定产品、导入文档或 URL、配置受控站点与公众号来源，并把资料转换为可治理的 Claim、Chunk、Snapshot 和 EvidencePack；
- 通过多供应商联网搜索补充事实，再由指定语义模型整理 GEO 机会、真实问题、竞品信息和内容建议；
- 将调研结果直接编译为产品 GEO 策略包，不要求用户额外理解独立的 GeoBlueprint 页面对象；
- 由 AI 匹配、调整或新建多种文章类型，人工选择后冻结到策略版本；
- 由用户限定一段逐字固定文案、出现位置和适用渠道，生成时禁止改写、遗漏或擅自扩展；
- 为单篇或自然月矩阵任务生成不可变生产合同、检索证据、正文、风险项和审计记录；
- 在人工确认样文后编排批量生成、排程、发布任务、失败重试、结果回填和月度复盘；
- 提供正式托管任务单、邮件安全确认链接、渠道连接、每日 URL 汇总、暂停/恢复和通知偏好设置；
- 通过已绑定的 ChatGPT、豆包、DeepSeek 或千问账号自动执行 AI 前台问题测试，无需用户提前打开平台页面；
- 在 Docker `full` Profile 中运行 Web、MySQL、OpenSearch 和职能 Worker，并提供健康检查与结构化故障状态。

### 当前不能承诺

- 不能在 Embedding、搜索、生成模型或 OpenSearch 不可用时伪造“已生成”结果，也不会自动降级为无证据正文；
- 不能保证联网搜索结果天然真实，跨来源冲突、时效性和产品归属仍需要证据治理与必要的人工确认；
- 不能仅凭模型自评确认内容质量；真实推广前必须完成人工样文验收，批量生产沿用已确认的策略和校准版本；
- 不能绕过微信公众号、CSDN、掘金、知乎、头条等平台的登录、验证码、账号资质、接口权限、风控和内容审核；
- 不能通过 Chrome Profile 消除 AI 平台的服务端记忆；中立基线必须使用专用测试账号，并由用户确认平台记忆/历史引用关闭且没有自定义指令；
- 草稿箱写入、HTTP 200、本地 mock 或任务进入队列均不代表正式发布成功；成功必须有平台结果、公开标识或 URL，并通过后续存活检查；
- Graph Workflow 当前提升的是可靠编排、checkpoint、审计和故障恢复，不替代业务规则、内容质量判断或外部渠道授权；
- AgentTeams 当前未接入主链路。现阶段由确定性 Service、Worker、MCP 和 Graph Shadow 承担闭环，避免在单篇质量尚未通过前增加多 Agent 协作复杂度；
- 当前版本是本地/内部试运行系统，未完成面向公网 SaaS 所需的完整租户隔离、统一身份认证、密钥托管、配额计费和合规运营能力。

## 当前产品形态

产品采用双层架构：默认"托管模式"面向只需提交任务并收结果的用户，"运营控制台"保留完整的后台管理能力。

### 托管模式（默认）

根路径 `/` 是托管任务单，用户只需三步即可完成推广委托：

1. **提供产品资料**：选择已有产品并按需补充资料，或新增产品并提供名称、官网或资料文件；
2. **选择推广渠道**：只展示已经激活托管规则的渠道；知乎、CSDN、掘金会明确标记账号连接状态；
3. **确认结果邮箱**：接收策略、代表样文、每日公开 URL 和异常处理通知。

提交后进入正式托管回执页，用户可以关闭页面。系统先发送 GEO 策略确认链接，确认后生成并发送代表样文；样文确认通过后才进入批量生产与发布。托管模式使用独立的绿色主题和轻量顶栏，不显示运营控制台的复杂指标。

### 第三方渠道连接

知乎、CSDN、掘金使用“专用浏览器登录 + 本人确认账号”的授权方式，不要求用户把密码、Cookie 或 Token 填入工作台：

1. 运营人员先激活该渠道的收录规则与发布适配器；
2. 用户从托管设置进入渠道连接页，在专用浏览器窗口中自行完成登录、验证码或安全挑战；
3. 系统识别候选账号后，用户确认该账号只用于当前产品的托管发布；
4. 登录失效或平台阻断时暂停相关渠道，并通过邮件给出可操作的恢复入口。

微信公众号沿用已配置的合法发布连接。任何渠道未具备规则、适配器或有效授权时均 fail-closed，不会伪造发布成功。

### 运营控制台（高级模式）

保留完整的后台管理能力，侧栏六个一级入口：

| 页面 | 路径 | 核心职责 |
| --- | --- | --- |
| 首页 | `/dashboard` | 每 15 秒更新关键 KPI、七阶段自动化流程、内容产线、人工待办与最近流转，并提供"绑定产品""上传知识"快捷入口 |
| 知识库 | `/knowledge` | 统一承载产品绑定、知识导入、全网 GEO 调研、真实问题与关键词池、站点/公众号持续采集和知识治理 |
| GEO 内容中心 | `/monthly-plan` | 在同一个自然月工作区完成策略、矩阵任务、正文生成和自动排程；筛选上下文跨步骤共享 |
| 公众号内容生产 | `/free-production` | 一级独立入口，保留 V5 单篇内容生产完整链路：文章类型、资料补充、正文生成、风险复检、人工确认与公众号发布队列 |
| 内容监控塔 | `/content-monitor` | 统一查看发布状态与数据回传、渠道表现、官网审计、AI 可见性和失败告警 |
| 设置 | `/settings` | 模型、连接、默认规则、权限、日志五类配置，并提供公众号订阅 API 监控台；系统状态只在异常或管理员场景展示 |

旧路由继续作为兼容入口存在，但不再出现在主导航中。博客候选池已退出当前产品链路。

## 用户旅程

### 托管模式（默认）

```text
上传/补充产品资料 + 产品官网 + 选择渠道 + 确认邮箱
          │
          ▼
GEO 调研完成 → 邮件确认策略 → 邮件确认代表样文
          │
          ▼
按渠道每日安全上限自动发布 → 邮件收到公开 URL 汇总
```

人工默认只处理五类动作：首次提交资料、选择渠道、确认策略、确认样文，以及授权失效或平台阻断等少量异常。内部研究指标、排程、失败重试、URL 回填和月度复盘由系统管理。

### 完整运营链路

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
内容监控塔：渠道表现 + 官网审计 + AI 可见性
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

## GEO 调研链路

GEO 调研是内容生成前的前置搜索链路，围绕唯一推广目的——**提升品牌/产品的 AI 提及率**——设计（获客是提及率提升的下游结果）：

- **渠道规则包**：平台收录规则（域名、板块、结构要求、对比维度、CTA 变体引用）以版本化配置注入（环境变量 `GEO_CHANNEL_RULE_PACK_JSON`），领域代码不硬编码平台域名与文案；第三方目标渠道要求规则包具备有效激活人/时间并覆盖目标渠道，就绪检查和 run 创建双重 fail-closed；仅自有渠道可在缺省规则包时运行；
- **平台感知查询**：调研查询按内容类型证据需求编译——平台收录格局（`site:{domain}` 约束查询）、踩坑证据、开源自建替代、量化成效基准、采购误区五类查询意图；核心查询最多 6 条，目标第三方渠道查询使用独立预算；补充轮按证据缺口定向补查（缺平台证据补 `site:` 查询、缺独立来源补变体查询）；
- **平台打标与引用格局**：候选来源命中渠道域名后携带 `channelKey`，`channelStats` / `channelCitationStats` 反映目标平台的收录分布与被 AI 引用占比，作为渠道优先级与 KPI 归因的原始数据；
- **双轨门禁**：硬门禁只拦“撒谎”（编造引用、实体混淆、单源证据、混用实体名，命中即拦截重试）；质量类问题（平台证据不足、无来源数字、大胆策略假设）降级为标注放行（`hypothesis` / `claimsRequiringEvidence` / 复测探针），交给复测数据裁判；
- **提及率 KPI 闭环**：每次调研用真实逐 Provider 回答观测固化 `mention_baseline`（提及率基线 + 渠道引用统计，确定性推导不经 LLM）；批准蓝图对应的发布批次完成存活与 AI 样本闭合后，才触发只含前台探针任务的 `post_publish_retest`，并按绑定的原始基线确定性计算 delta；未达标时优先处理批次 P0/阻断原因，无根因阻断才进入下一轮调研；
- **就绪检查**：研究边界声明第三方平台渠道（知乎、CSDN 等）时，必须已有激活且覆盖该渠道的规则包，否则就绪检查 blocked（fail-closed）；自有渠道（公众号、官网、AI 前台）不依赖平台规则包，不参与校验。

设计方案与阶段总结见 [`docs/方案与规划/GEO调研链路修改方案.md`](./docs/方案与规划/GEO调研链路修改方案.md)。

## GEO 内容中心

`/monthly-plan` 是唯一的月度内容工作区，使用自然月作为规划和复盘周期：

1. **月度策略**：系统基于产品知识、GEO 调研、问题池与关键词池生成策略包；设置在右侧抽屉完成，不跳转新页面；
2. **矩阵任务**：将策略转换为按问题、文章类型和渠道拆分的正式任务；
3. **内容生成**：后台生成 EvidencePack、正文与自动修复结果；
4. **自动排程**：系统生成发布日期与渠道安排，用户可按需调整。

业务页不再重复展示大面积 KPI 卡片，只保留紧凑状态条；完整指标统一回到首页查看。

## 微信公众号内容生产

`/free-production` 承接原 V5 自由内容生产的完整能力，但以“公众号生产中心”作为用户入口：

- 从表达预设中选择文章类型，也可以在当前工作区新建类型；
- 绑定产品与知识快照，补充事实、素材和会议文本；
- 生成单篇正文并保留证据、风险项、局部补充和全文复检；
- 人工确认当前终稿后进入正式公众号发布队列；
- 在 `/free-production/tasks` 查看批次状态并只重试失败任务，不覆盖已成功结果。

正文预览支持 AIHOT 热点融入：

- 点击“加入热点”时，系统读取 AIHOT API v1 的最近精选，把完整内容类型版本、规则、当前正文和产品证据一起交给正文模型；
- 模型自行判断热点是否适合、选择哪一条、采用什么写作角度及改写哪些章节，代码不按内容类型维护固定分支；
- 系统只接受本次真实候选池中的热点，并校验相关度、章节范围、产品事实边界、公众号写作规则和正式 HTML；
- 首次融入后按钮切换为“更换热点”，更换时排除已尝试热点；每次结果都保留为正文版本，可通过“返回上一版本”逐级恢复；
- 页面展示选择理由、写作角度、影响章节、热点新鲜度、AIHOT 阅读地址和第三方原文，AIHOT 摘要不作为产品事实来源。

热点请求使用 ETag 缓存在 `data/v5-aihot-trend-cache.json`，外部服务暂时失败时使用最近一次成功缓存；无缓存时保持正文不变并返回可操作错误。可通过 `AIHOT_BASE_URL` 覆盖服务地址，通过 `V5_AIHOT_CACHE_PATH` 覆盖运行时缓存路径。该热点信号只进入公众号正文版本，不进入 GEO EvidencePack 或产品知识真源。

该页面是面向临时选题和单篇需求的人工发起链路；系统自动生成的月度矩阵仍统一在 GEO 内容中心运行。

## 站点与公众号持续导入

知识库“资料与来源”提供两个明确入口：

- **导入站点**：持续读取站点、Sitemap、RSS 或 Atom；
- **订阅公众号**：先在外部订阅服务中关注账号，再使用 `subscriptionId` 或完全一致的公众号名称导入。

两种来源共用同一条知识链路：定时发现、正文拉取、内容去重、产品归属、知识库归档、治理与索引。公众号订阅服务只提供合法授权范围内的文章列表，工作台不会绕过登录、验证码或平台访问控制。

## 内容监控塔

`/content-monitor` 将原发布控制塔、数据回传、官网监控、AI 前台测试和月度聚合能力合并为“内容监控塔”，负责：

- Publish Job、Worker、重试、reconciliation 和公开 URL 回填；
- 发布后 24h/72h 存活验证和渠道数据回传；
- 指定官网与博客来源的内容变化监控；
- AI 搜索前台回答、引用、品牌提及和差异观察；
- 按自然月形成渠道、官网与 AI 可见性的统一监控基线。

外部平台是否发布成功，以平台公开结果、URL 回填和持续存活验证为准。草稿箱写入、HTTP 200 或本地模拟结果不等于正式发布。

## AI 前台自动测试

托管设置页提供可选的“账号即动作”复测，不增加首次委托步骤：用户点击已绑定的 AI 账号后，系统创建绑定 `connectionId`、设备和平台的正式任务，并立即唤醒本机浏览器伴侣。扩展会在对应 Chrome Profile 中打开非聚焦的新会话窗口，自动发送问题、采集回答与引用、脱敏截图、回传 SHA-256 证据，并在成功或失败后关闭窗口。用户不需要提前打开 AI 网站。

```text
点击已绑定 AI 账号
        │
        ▼
创建 connectionId 绑定任务 → 即时唤醒扩展
        │
        ▼
后台新会话 → 隔离预检 → 自动发送与采集 → 证据回传 → 自动关窗
```

首次使用：

1. 执行数据库迁移，并在 `.env.local` 配置 `V5_CAPTURE_EXTENSION_ID`、`NEXT_PUBLIC_V5_CAPTURE_EXTENSION_ID` 和 `V5_CAPTURE_CHROME_PROFILE_DIRECTORY`；
2. 从 `browser-extension/` 加载 Chrome Manifest V3 扩展；
3. 在设置页“采集设备”生成一次性配对码，在扩展弹窗中完成设备配对和账号绑定；
4. 启动桌面伴侣，或注册为当前 Windows 用户的开机自启：

```powershell
npm.cmd run capture-companion:start
npm.cmd run capture-companion:autostart
```

扩展支持的平台、首次配对和账号绑定见 [`browser-extension/README.md`](./browser-extension/README.md)，本机桥接与健康检查见 [`capture-runner/README.md`](./capture-runner/README.md)。后台轮询只承担离线恢复，不替代用户点击账号发起正式测试的交互。

中立基线 `neutral_benchmark` 必须同时满足：专用中立 AI 账号、没有既往 JOTO 历史、平台记忆/历史引用关闭、没有自定义指令、平台新会话。账号级条件由用户在绑定时确认，页面级新会话由适配器自动验证；缺少任一证明时任务以 `isolation_unverified` 结束，结果不得进入正式基线。日常账号只能绑定为 `personalized_user_sample`，与中立基线分池统计。

扩展和 Runner 不读取或上传 Cookie、密码、Token、浏览器存储、自动填充信息或私有请求头。登录失效、验证码和平台安全挑战仍由用户处理，系统不会绕过平台访问控制。详细设计见 [`docs/方案与规划/2026-08-20-AI前台账号连接与记忆隔离实现.md`](./docs/方案与规划/2026-08-20-AI前台账号连接与记忆隔离实现.md)。

## 代码仓库与真实资料边界

GitHub 仓库只承载应用代码、公开配置模板、数据库结构/迁移、自动化测试和不含业务事实的说明文档。真实产品知识、导入正文、生成文章、EvidencePack、向量、发布凭证和运行状态只存在于本地或部署环境，不随代码提交。

| 可以进入 GitHub | 不得进入 GitHub |
| --- | --- |
| `src/`、`workers/`、`scripts/` 等源代码 | `.env`、`.env.local` 和任何真实 Key、Token、Cookie、密码 |
| `.env.example`、`.env.local.example` 空值模板 | 用户上传文档、网页正文、公众号文章和会议材料 |
| `database/schema.sql` 与版本化 migration | MySQL/OpenSearch 数据目录、向量、Claim/EvidencePack 实例 |
| 不含真实业务内容的单元/契约测试 fixture | 生成正文、真实问题池、发布队列、公开 URL 与渠道回执 |
| README、部署说明和公开开发文档 | 浏览器 profile、日志、备份、个人简历和本地工作记忆 |

本地运行时数据库可以包含 WorkBuddy、腾讯云 ADP 等真实试点资料，但这些数据不是开源代码的一部分。需要共享验收样本时，应单独制作脱敏且得到明确授权的 fixture，不能直接复制生产或本地数据库内容。

## 技术结构

```text
src/app/                  Next.js App Router 页面与 API Routes
src/components/           工作台通用 UI 与月度流程组件
src/lib/v5/               月度策略、自动化、GEO 调研、知识治理与 RAG 领域服务
workers/                  知识刷新、GEO 调研、内容生产、排程与发布 Worker
data/                     本地运行状态与脱敏测试数据；真实资料不提交
database/                 MySQL schema 与迁移
scripts/                  校验、迁移、smoke、备份和验收脚本
browser-extension/        AI 前台自动测试 Chrome 伴侣
capture-runner/           仅监听本机回环地址的采集任务桥接服务
arcs-runner/              第三方内容渠道专用浏览器授权与发布 Runner
third_party/              已审计引入的第三方代码许可与说明
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

首次使用完整知识生产链路时，运行一键生产初始化。脚本会检查 Docker、内存和磁盘，自动创建被 Git 忽略的 `.env`，生成并隐藏本机 MySQL 凭证，构建 `full` Profile，并以真实 Embedding 请求验证 MySQL、OpenSearch 和全部 Worker。用户不需要填写 `MYSQL_HOST`、端口、库名或密码，只需要在隐藏输入框中提供无法由系统推断的 `DASHSCOPE_API_KEY`：

```powershell
.\setup-full-production.cmd
```

只做环境检查、不创建配置或启动服务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-full-production.ps1 -CheckOnly
```

初始化成功后，日常启动继续使用：

```powershell
npm.cmd run docker:3027
```

仅准备 MySQL、OpenSearch 和容器、暂不配置模型时，可以显式增加 `-AllowPendingProvider`。该状态不会被报告为完整生产就绪，也不能生成正式 EvidencePack 或正文。

访问：<http://127.0.0.1:3027>

完整生产健康检查：

```text
GET http://127.0.0.1:3027/api/health?deep=true
```

只有 `profile=full`，且 MySQL、OpenSearch、Embedding、Workers 全部为 `ready`，才算完整生产模式验收通过。`scope=web` 只用于容器存活探针，不能证明知识生产链路可用。

查看 MySQL、OpenSearch、资料目录、产物目录和每个 RAG 索引的实际占用：

```powershell
node scripts/knowledge-capacity-report.mjs
```

Compose Profile：

| Profile | 组件 | 用途 |
| --- | --- | --- |
| `core` | Web、MySQL | 基础工作台和低资源体验 |
| `full` | Web、MySQL、OpenSearch、全部 Worker | 完整知识、调研、生产、发布与恢复链路 |

### 本地开发

要求 Node.js 22.14+、npm 10+：

```powershell
npm.cmd run dev:3027
```

访问：<http://127.0.0.1:3027>

该命令自动启动 Docker Desktop、MySQL、OpenSearch、全部 Worker 和容器内的 Next.js 开发服务。页面、组件、样式与 API 源码保存后通过 Fast Refresh 同步到 3027；Worker、Service、脚本、数据库或配置源码保存后，开发守护进程自动重启 Worker supervisor。运行时数据继续保存在原有命名 Volume 中。

```powershell
# 停止开发 Web 和 Worker，保留 MySQL、OpenSearch
npm.cmd run dev:3027:stop

# 构建并把 3027 切回 production-like standalone 镜像
npm.cmd run docker:3027

# 类型、结构和月度命名一次验收
npm.cmd run verify
```

修改 `package.json`、`package-lock.json`、Dockerfile 或 Compose 文件后，需要重新运行 `npm.cmd run dev:3027`，以更新开发镜像和依赖。开发模式追求修改反馈速度，不替代交付前的 production-like Docker 验收。

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
- 真实知识库、内容正文、EvidencePack、发布记录和本地运行状态不得随代码提交；
- Provider 未配置时保持 `pending_config/failed`，不降级为无证据生成；
- 运行状态、公开 URL 和渠道结果不得伪造。

## 验证

提交前至少执行：

```powershell
npm.cmd run verify
npm.cmd run build
```

涉及具体领域时可继续执行：

```powershell
npm.cmd run test:v5-hosted-managed
npm.cmd run test:formal-publish
npm.cmd run test:v5-ai-frontend-connections
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
| [`docs/方案与规划/GEO调研链路修改方案.md`](./docs/方案与规划/GEO调研链路修改方案.md) | GEO 调研平台感知与提及率 KPI 闭环改造方案（含 P0–P3 阶段总结索引） |
| [`docs/方案与规划/2026-08-20-GEO托管模式开发改造方案.md`](./docs/方案与规划/2026-08-20-GEO托管模式开发改造方案.md) | 托管任务、邮件确认、每日发布与 URL 回传的完整闭环设计 |
| [`docs/方案与规划/P0-自动化发布能力与渠道配置说明书.md`](./docs/方案与规划/P0-自动化发布能力与渠道配置说明书.md) | 第三方渠道规则、账号连接、授权边界与正式发布判定 |

## 安全与合规

仓库用于 JOTO GTM 工作台研发与内部协作。外部部署前需补齐身份认证、访问控制、操作审计、密钥托管、数据库备份和渠道合规审核。任何真实凭证如果曾进入 Git 历史，应立即撤销并轮换，不能仅通过后续删除文件解决。

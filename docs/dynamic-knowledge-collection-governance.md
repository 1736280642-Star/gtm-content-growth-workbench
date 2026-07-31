# 动态知识库采集与治理开发方案

## 1. 目标

在现有 V5 知识库与 RAG 治理链路上增加一条无人值守的动态采集链路。用户只需完成一次“来源导入”，系统此后每天自动完成：

1. 发现指定站点或指定微信公众号账号的新文章；
2. 抓取正文并计算内容哈希，识别新增与内容更新；
3. 识别文章指向的产品、服务或其他主题；
4. 路由到对应知识库，保存文章、正文和归属依据；
5. 复用 SourceRevision、Claim、EvidencePack 失效和 RAG 索引刷新能力；
6. 在前端展示今日采集快照，不要求用户确认、分类或归档。

产品用语统一使用“来源导入”，不使用“订阅管理”。

## 2. 用户结果

用户在知识库页面可以完成两件事：

- 导入来源：站点入口、Sitemap、RSS/Atom 地址，或微信公众号账号及其合规文章列表来源；
- 查看今日采集：文章标题、对应产品或服务、URL、收录内容、抓取时间、归档知识库和治理状态。

导入来源之后，日常采集、归属、归档、治理和索引刷新均由系统自动执行。抓取失败会进入任务运行记录并自动重试，不转化为日常人工待办。

## 3. 范围与边界

### 3.1 本期支持

- 来源类型：`site`、`wechat_account`；
- 站点发现：Sitemap、Sitemap Index、RSS、Atom、入口页文章链接；
- 微信公众号发现：
  - 来源导入时提供可访问的 RSS/Atom/文章列表 URL；
  - 或部署环境配置 `WECHAT_COLLECTION_BASE_URL`，按账号标识调用合规采集服务；
- 正文抓取：复用现有 URL 抓取链路；
- 增量规则：URL 去重 + `contentHash` 变更检测；
- 自动归属：确定性实体匹配优先，已配置 AI Provider 时补充语义分类；
- 自动兜底：无法高置信度识别时归档到来源默认知识库或“其他”知识库，不要求人工介入；
- 动态治理：记录 revision、失效旧证据、触发现有 `knowledge_refresh` 和索引任务；
- 今日采集快照：前端可查看正文摘要和完整收录内容。

### 3.2 安全与合规边界

- 不绕过微信公众号登录、验证码、访问控制或反爬机制；
- 不在数据库或状态文件中保存 Cookie、Token、API Key；
- 微信采集适配器只接收账号标识并返回文章列表，凭证由部署环境管理；
- 仅抓取公开可访问或已获授权的内容；
- 抓取器执行 SSRF 防护，只允许 `http/https`，拒绝本机、内网和保留地址。

## 4. 实现逻辑

```text
来源导入
  -> 每日采集任务领取到期来源
  -> Sitemap/RSS/适配器发现文章 URL
  -> 正文抓取与标准化
  -> URL + contentHash 增量判定
  -> 产品/服务/其他实体识别
  -> 目标知识库路由
  -> 保存采集快照与知识资料
  -> 托管 SourceRevision / Claim 治理
  -> knowledge_refresh / RAG index
```

底层原因：

- “发现”和“抓取”分离，便于站点与微信公众号使用不同适配器；
- URL 只能判断是否见过，`contentHash` 才能判断已发布文章是否更新；
- 归属结果与依据一并保存，后续可复盘分类质量；
- 本地 V5 状态负责来源和可视化快照，正式 MySQL RAG 链路负责不可变 revision 与索引；
- 外部基础设施缺失时保留已抓取结果并标记 `pending_config`，避免重复抓取和数据丢失。

## 5. 数据契约

### 5.1 CollectionSource

| 字段 | 含义 |
| --- | --- |
| `sourceId` | 来源 ID |
| `name` | 来源名称 |
| `sourceType` | `site` / `wechat_account` |
| `entryUrl` | 站点、Sitemap、RSS 或授权文章列表 URL |
| `accountId` | 微信公众号账号标识 |
| `defaultKnowledgeBaseId` | 无法明确分类时的自动归档目标 |
| `publicUseConfirmed` | 来源导入时确认内容已获授权用于知识治理与公开内容生产 |
| `enabled` | 是否参与每日采集 |
| `scheduleHour` | 每日执行小时，Asia/Shanghai |
| `lastCollectedAt` / `nextCollectAt` | 上次与下次执行时间 |
| `lastStatus` / `lastError` | 最近运行状态 |

### 5.2 CollectionSnapshot

| 字段 | 含义 |
| --- | --- |
| `snapshotId` | 采集快照 ID |
| `sourceId` / `runId` | 来源与运行记录 |
| `title` / `url` | 文章标题与规范 URL |
| `contentHash` | 标准化正文哈希 |
| `content` / `excerpt` | 收录正文与列表摘要 |
| `entityType` | `product` / `service` / `other` |
| `entityName` | 对应产品、服务或其他主题 |
| `knowledgeBaseId` / `knowledgeBaseName` | 自动归档目标 |
| `classificationConfidence` | 归属置信度 |
| `classificationReasons` | 可解释归属依据 |
| `collectionStatus` | `collected` / `updated` / `unchanged` / `failed` |
| `governanceStatus` | `archived` / `queued` / `indexed` / `pending_config` / `failed` |
| `collectedAt` | 采集时间 |

### 5.3 CollectionRun

保存任务开始/结束时间、发现数、新增数、更新数、未变化数、失败数和总体状态，用于前端展示与运行审计。

## 6. 自动归属规则

1. 读取所有知识库的名称、重点和可选实体别名；
2. 对标题、正文、URL 和来源名称进行标准化；
3. 按实体名称、别名和重点词计算确定性得分；
4. 已配置 AI Provider 时，要求模型只从候选知识库中选择并返回严格 JSON；
5. 合并得分并保存原因；
6. 若结果不稳定，自动使用来源默认知识库；仍无默认目标时进入系统“其他”知识库。

分类不产生人工确认步骤。低置信度只影响快照标识，不阻断归档和后续更新。

## 7. API 与 Worker

### 7.1 API

- `GET /api/v5/knowledge-collection/sources`：来源列表；
- `POST /api/v5/knowledge-collection/sources`：来源导入；
- `PATCH /api/v5/knowledge-collection/sources/:id`：启停或修改来源；
- `GET /api/v5/knowledge-collection/today`：今日采集快照；
- `POST /api/v5/knowledge-collection/run`：由调度器触发到期来源采集。

写接口继续使用 V5 的 actor、审计原因、幂等键和版本控制。

### 7.2 Worker

`npm.cmd run worker:v5-knowledge-collection`

- 默认执行一轮到期来源；
- `--repeat` 作为常驻模式；
- `--interval-seconds` 控制扫描间隔；
- 部署环境每天至少触发一次；
- 单来源失败不阻断其他来源；
- 失败按来源记录，下轮自动重试。

## 8. 前端

知识库主页面增加两个工作区：

- “来源导入”：支持选择站点或微信公众号、填写入口、选择自动兜底知识库和执行时间；
- “今日采集”：表格展示标题、对应产品或服务、URL、收录内容摘要、知识库、采集状态和治理状态；点击后打开正文抽屉。

页面不提供“确认归属”“批准归档”等日常操作。

## 9. 验收标准

1. 可导入一个站点来源和一个微信公众号来源；
2. Worker 能发现来源文章并抓取正文；
3. 首次文章标记为 `collected`，相同 URL 正文变化后标记为 `updated`；
4. 相同 URL 且正文未变化不会重复创建资料；
5. 每篇成功文章都有实体归属、目标知识库和归属依据；
6. 无法明确识别时仍自动归档到默认或“其他”知识库；
7. 今日页面展示标题、对应产品或服务、URL、收录内容和治理状态；
8. 外部 RAG 配置可用时触发托管导入和索引刷新；配置缺失时快照为 `pending_config`，后续可恢复；
9. 微信采集不读取或保存用户 Cookie、Token；
10. `npm.cmd run typecheck`、`npm.cmd run validate:structure` 和新增采集链路测试通过。

## 10. 维护影响

- 新来源只需增加发现适配器，不改动归档和治理流程；
- 分类策略有独立版本，便于评估和回滚；
- 快照保存正文会增加状态文件体积，生产环境应迁移到 MySQL 对应表；
- 常驻 Worker 依赖部署调度；未启动 Worker 时来源仍可导入，但不会自动产生每日快照；
- 微信公众号可采集范围由合法数据源决定，适配器不可用时系统保留失败记录并自动重试。

# V5 正式生产用户流程运行手册

## 目标

完整链路必须是：

`目标问题 -> 正式产品与知识 -> active 规则包 -> G6 人工准入 -> MonthlyPlan -> 类型匹配 -> 策略批准 -> 正式矩阵 -> RAG 证据冻结 -> 正式正文 -> 人工排程 -> 发布确认与指标 -> MonthlyReview`

任何阶段缺少正式数据时都应 fail closed，不使用 mock、V4 派生状态或自动生成的人工审批替代。

## 一键检查

在项目根目录运行：

```powershell
npm.cmd run check:v5-flow -- 2026-07
```

输出只包含字段名、非敏感业务标识、数量和阻断原因，不输出 `.env.local` 中的值。

## 页面路径

| 阶段 | 页面路径 | 必须看到的结果 |
| --- | --- | --- |
| 目标问题 | `/questions-keywords` | 当月问题已锁定，问题版本固定 |
| 本地知识工作区 | `/knowledge` | 仅用于 Foundation 知识工作区；不能替代正式 MySQL 产品治理 |
| 正式产品与知识 | 暂无完整 GUI | 通过正式治理 API 完成 ProductEntity、资料导入、Claim 审核和知识库绑定 |
| 正式规则与 G6 | 暂无完整 GUI | 通过正式治理 API 完成规则批准/激活、G6 评估和生产池激活 |
| 文章类型 | `/monthly-matrix/content-types` | 至少一个 active 类型 |
| 月度策略 | `/monthly-matrix/strategy` | 问题类型匹配已人工确认，配额与渠道完整 |
| 策略审批与矩阵 | `/monthly-matrix` | 策略已批准并产生正式矩阵项 |
| 生成与排程 | `/monthly-matrix/batch-generation` | 正式 EvidencePack 与正文可用，随后人工排程 |
| 当日执行 | `/daily-execution` | 只显示正式排程和实际发布状态 |
| 内容监控塔 | `/content-monitor` | 汇总渠道指标、官网审计、AI 可见性和失败告警；其中月度数据进入 MonthlyReview |

## 本机配置路径

配置文件：项目根目录 `.env.local`。只填写本机值，不把凭证写入文档、代码、截图或 Git。

正式 RAG 至少需要以下字段：

```text
MYSQL_HOST
MYSQL_PORT
MYSQL_DATABASE
MYSQL_USER
MYSQL_PASSWORD
OPENSEARCH_URL
OPENSEARCH_USERNAME
OPENSEARCH_PASSWORD
RAG_EMBEDDING_PROVIDER
```

当 `RAG_EMBEDDING_PROVIDER=qwen_embedding` 时，还需要 `DASHSCOPE_API_KEY` 和 `QWEN_EMBEDDING_MODEL`；选择 `doubao_embedding` 时，需要 `DOUBAO_API_KEY` 和 `DOUBAO_EMBEDDING_MODEL`。

MonthlyReview 默认直接聚合正式问题、MonthlyPlan、发布结果与指标，并在内容监控塔中展示相关结果。`V5_OBSERVATION_REFERENCE_PATH` 仅作为显式外部只读适配器覆盖项；使用时必须指向受控正式导出，不能指向 `scripts/fixtures/`。

## 正式治理 API 路径

当前 `/knowledge` 与 `/knowledge/rule-packages` 分别写 Foundation JSON 和 V4 状态，不会写入正式 MySQL。正式数据需按以下 API 顺序配置：

```text
POST /api/product-entities
POST /api/knowledge-ingestion/batches
POST /api/products/[productId]/rule-packages/drafts
POST /api/rule-package-versions/[id]/approve
POST /api/rule-package-versions/[id]/activate
POST /api/products/[productId]/monthly-production-readiness/evaluate
POST /api/monthly-production-pool/[productId]/activate
```

这些写接口都要求人工身份、角色、幂等键、版本号和审计原因。不要直接改数据库，也不要用技术验证产品替代 WorkBuddy 或腾讯云 ADP。

## 人工审批边界

产品实体确认、Claim 审核、规则包批准与激活、G6 准入、生产池激活、策略批准、排程和最终发布均属于人工判断。Agent 可以检查、生成候选和执行已授权动作，但不能伪造审批人、审批时间或绕过状态机。

## 当前人工边界

- 正式 ProductEntity、规则包、G6 和生产池已有 API，但尚无完整工作台配置页面。
- 公众号能力只写入草稿箱；最终发布仍由人工在平台完成，再从 `/daily-execution` 回填公开 URL 与指标。

正式产品、规则与 G6 数据准备完成后，即可按页面顺序执行完整月度链路。

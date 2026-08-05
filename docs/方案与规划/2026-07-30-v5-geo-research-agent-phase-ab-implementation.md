# V5 GEO 调研助手 Phase A/B 实施记录

## 1. 本次结果

本次实现已把“新增产品前的 GEO 前置研究”接入 V5 正式链路：

`产品登记 -> 表达边界 -> 资料导入/知识快照 -> 可恢复研究任务 -> 联网问题与竞品研究 -> AI 前台基线 -> 证据对齐 -> Blueprint 草案 -> 人工批准 -> 月度策略输入就绪`

研究不是新的规划周期。正式内容仍只能进入自然月 `MonthlyPlan`。

## 2. 已实现能力

### 2.1 产品无关化

- 产品来源统一改为 MySQL `product_entity`，资料导入不再依赖代码内产品白名单。
- 新增产品可填写规范名称、别名、官网、品类、表达重点、禁用表达、研究市场、语言和渠道。
- 问题关键词抽取移除 ADP、WorkBuddy 固定正则。
- 文章类型种子模板移除 JOTO 固定 CTA；CTA 由具体产品规则在后续生产阶段决定。

### 2.2 持久化 Agent 链路

新增正式实体：

- `geo_research_project`
- `geo_research_run`
- `geo_research_task`
- `geo_research_artifact`
- `geo_research_evidence`
- `geo_research_finding`
- `geo_blueprint_version`

每次写入均具备幂等键、乐观并发版本、操作者、审计原因与审计事件。任务使用租约、依赖图、重试和失败状态，Worker 中断后不会伪造成功。

### 2.3 强制联网研究

OpenAI Responses API Provider 已接入 `web_search`：

- 用户问题发现；
- 竞品与内容铺设研究；
- AI 前台基线测试。

Provider 必须同时返回完成的 `web_search_call` 和至少一个公开 URL，才可标记 `liveSearchVerified=true`。没有联网证据时任务失败，禁止回退到模型记忆。

原始 Provider 响应写入 `geo_research_artifact`；公开来源、查询、标题和可见引用写入 `geo_research_evidence`；问题、竞品、引用模式、内容缺口和文章类型建议写入 `geo_research_finding`。

### 2.4 Blueprint 与人机边界

- Blueprint 生成前硬校验问题研究、竞品研究和 AI 前台基线均具有联网证据。
- AI 只能生成 `pending_review` 草案。
- 只有人工角色可以批准，批准后版本冻结。
- 批准后的项目状态为 `ready_for_monthly_strategy`，但不会绕过现有规则包、Evidence Gate 或 `MonthlyPlan`。

## 3. 用户入口

- `/products`：产品与 GEO 调研列表。
- `/products/new`：新增产品并创建调研项目。
- `/products/[productId]/research`：资料入口、任务状态、Blueprint 查看与人工批准。
- 资料上传页和 URL 导入页从 `/api/v5/products` 动态加载产品。

## 4. 运行配置

只记录配置名，不在文档或日志写入密钥值：

```text
GEO_RESEARCH_ZHIPU_API_KEY
GEO_RESEARCH_ZHIPU_MODEL
GEO_RESEARCH_ZHIPU_BASE_URL
GEO_RESEARCH_ZHIPU_SEARCH_ENGINE
GEO_RESEARCH_ZHIPU_SEARCH_COUNT
GEO_RESEARCH_ZHIPU_SEARCH_RECENCY
GEO_RESEARCH_ZHIPU_CONTENT_SIZE
GEO_RESEARCH_ZHIPU_MAX_QUERIES
```

`GEO_RESEARCH_ZHIPU_API_KEY` 与 `GEO_RESEARCH_ZHIPU_MODEL` 必填。需要联网的任务先调用智谱 Web Search 获取结构化网页结果，再把可核验来源交给 GLM 生成严格 JSON；没有来源 URL 时任务失败，不会降级为模型记忆。

单次执行一个可租约任务：

```powershell
npm.cmd run worker:v5-geo-research
```

正式环境应由现有 Worker 调度器重复触发，直到任务链进入 `pending_review`、`completed`、`pending_config` 或 `failed`。

## 5. 验证

```powershell
npm.cmd run test:v5-geo-research
npm.cmd run typecheck
npm.cmd run validate:structure
```

本次验证结果：

- GEO 专项合同测试通过。
- TypeScript 类型检查通过。
- V5 结构与自然月规则检查通过。

## 6. 尚未完成的生产增强

- 第二个 Live Search Provider 与 Provider 交叉验证；
- 元宝、豆包、Kimi 等真实浏览器前台适配；
- 截图、DOM 证据和搜索模式检测；
- Blueprint 到正式问题池、文章类型草稿、规则包草稿的逐项人工接入；
- Blueprint 月度策略候选与 `MonthlyPlan` 冻结版本的正式映射；
- 发布后同条件复测与 `MonthlyReview` 回流。

这些增强不影响当前一期的核心约束：真实资料准入、持久化任务、强制联网证据、Blueprint 人工批准和自然月主链路。

## 7. 无 API Key 可用闭环与前端工作区

在联网 Provider 尚未配置时，工作台现在仍可完成以下准备和治理动作：

- 在产品列表查看每个产品的 GEO 进度、资料快照、最近任务和下一步；
- 创建或修改研究边界，并冻结当前已批准资料形成研究快照；
- 预创建研究任务；缺少 Provider 配置时明确进入 `pending_config`，不生成模拟结果；
- 查看研究阶段、任务进度、公开网页证据、研究发现和 Blueprint 草案；
- 对 Blueprint 执行人工批准或退回修改；
- 将已批准 Blueprint 作为月度策略候选带入月度内容矩阵，但不自动批准或替代 `MonthlyPlan`。

前端入口为 `/products`，产品研究工作区为 `/products/[productId]/research`，单次任务证据页为
`/products/[productId]/research/[runId]`。启动前检查只返回缺失的配置字段名，不读取或显示密钥值。

这套交互坚持两条边界：

1. 未配置 API Key 时可以把资料、边界、任务和人工审核准备完整，但联网研究阶段必须暂停；
2. 未批准的 Blueprint 不能进入正式月度生产，已批准 Blueprint 也只生成候选输入，仍需沿用现有自然月审批链路。

# V5 UI 阶段状态

## 2026-07-15 阶段：删除 Agent 底座总览

### 结论

1. 删除 `Agent 底座总览` 页面、主导航入口和路由权限标签。
2. 删除仅供该页面使用的生产准备度组件与 mock 数据，避免保留无消费者代码。
3. 知识库、产品表达规则包和 AI 配置继续使用 V4 原有页面与功能，不新增聚合总览页。
4. 月度生产主链路保持为 `月度内容矩阵 -> 批量生成与人工排程 -> 当日执行 -> 月度复盘`。

### 验证结果

1. `npm.cmd run typecheck`：通过。
2. `npm.cmd run validate:structure`：通过，211/211，包含导航、权限和页面 smoke 无残留契约。
3. `npm.cmd run smoke:interactions`：通过，51/51。
4. `npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3047`：通过，31/31。
5. `npm.cmd run smoke:browser:v5:main`：通过，8/8。
6. `npm.cmd run build`：通过，44 个页面；`/agent-foundation` 不在构建清单且本地访问返回 404。

## 2026-07-14 阶段：V5 局部替换与 V4 保留边界

### 结论

1. V5 主导航只替换已重构的生产职责：月度内容矩阵、批量生成与人工排程、当日执行和月度复盘。
2. 知识库、AI 配置、蒸馏词池、博客监控、真实接入、工作台设置和数据回传继续保持 V4 原有实现。
3. 首页使用明确的数据来源标签区分 V5 mock 与当前运行态；旧周计划、今日发布和周度复盘路由保留用于迁移回归，但不再作为 V5 主导航入口。
4. 移除 AI 配置中的 V5 治理日志标签；Agent 底座总览已在后续阶段删除。

### 验证结果

1. `npm.cmd run typecheck`：通过。
2. `npm.cmd run validate:structure`：通过，212/212。
3. `npm.cmd run smoke:interactions`：通过，51/51。
4. `npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3047`：通过，32/32。
5. `npm.cmd run smoke:browser:v5`：通过，8/8，新增首页桌面和 390px 移动端验收。
6. `npm.cmd run build`：通过，45 个页面完成生产构建；仅保留既有 V4 Hook 依赖警告。

## 2026-07-14 阶段：按月度矩阵低保真 v1.1 重构前端信息架构

### 结论

1. V5 内容生产主页面收敛为 `月度内容矩阵`、`批量生成中心`、`当日执行`，`月度复盘`承担内容生产闭环。
2. `月度策略包`不再独立成页，嵌入月度内容矩阵中；旧策略路径兼容跳转到页面策略模块。
3. `异常队列`和`定时发布排程`不再作为独立主入口，分别合并到批量生成中心的异常区和人工排程区；旧路径继续兼容跳转。
4. 本阶段仍是前端 mock/UI 契约，不接真实月度 API、Workflow Agent、Final Evidence Pack、生成接口或正式发布。

### 实现逻辑

1. 月度计划配置改成弹窗，产品必须通过 `active + monthlyProductionReady` 的产品表达规则包选择；选择后自动带出产品，用户只需要多选渠道和填写该产品分组月度总篇数。
2. 月度策略包使用动态表格展示蒸馏词优先级、产品与配额、知识库证据准备度和策略状态；策略表不展示文章标题和排程。
4. 批量生成中心合并标题确认、Evidence Preview、Final Evidence Gate、生成状态、硬规则、软质量、排程草稿、正式排程和异常治理入口。
5. V5 mock 数据使用 `matrixItemId` 贯穿生成、异常和排程，避免原页面靠标题文本做隐式关联。
6. 当日执行只允许昨日、今日、明日切换，状态限定为已排程、待发布、发布中、已发布、发布失败、人工接管；不提供计划、生成、产品渠道修改和 URL 操作。
7. 月度复盘按主蒸馏词和产品展示计划完成、证据问题、问题来源和下月候选调整。

### 底层原因与用户影响

1. 决策和执行分离：月度矩阵只决定本月做什么，批量生成中心只负责怎么生产和排程，避免两个页面都能修改同一业务决策。
2. 策略包不含标题：标题需要绑定具体矩阵项和渠道，放在批量生成准备阶段才能执行 Evidence Preview 和平台表达检查。
3. 部分异常不阻断整月：页面明确同时显示可生成数、被拦截数和异常原因，后续真实接口应只跳过受影响矩阵项。
4. 用户减少策略审核、异常处理和排程之间的跳转；代价是批量生成中心信息密度更高，因此使用主表、日历和异常区三个明确分区控制复杂度。

### 验证结果

1. `npm.cmd run typecheck`：通过。
2. `npm.cmd run validate:structure`：通过，214/214。
3. `npm.cmd run smoke:interactions`：通过，51/51。
4. `npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3049`：通过，32/32，包含所有 V5 主入口和兼容重定向。
5. `npm.cmd run smoke:browser:v5`：通过，6/6，覆盖桌面月度矩阵、移动配置弹窗、桌面/移动批量生成、移动当日执行和移动月度复盘。
6. 浏览器验收首次发现批量生成页日历在 390px 视口下溢出 20px；将日历列改为可压缩七等分、卡片头部改为移动端换行后复测通过。
7. `npm.cmd run build`：通过，45 个页面完成生产构建；仅保留既有 V4 Hook 依赖警告。

### 风险与后续

1. 当前规则包、Evidence Preview、Final Evidence Gate、生成质检、排程和 GEO 结果都是 mock，不能作为真实生产依据。
2. 当前只建立前端字段与交互契约；真实后端接入前需定义 `MonthlyPlanGroupQuota`、`StrategyTermHit`、`BatchGenerationRun`、`ManualPublishScheduleDraft`、`AutoTitleDowngradeAudit` 和异常重试的正式接口。
3. 旧 V4 周计划、今日发布和周度复盘仍保留用于迁移期对照，不是 V5 的第二套月度计划真源。
4. 通用 `smoke:browser:responsive` 本次运行 7/8，通过项均为既有 V4 页面；唯一失败是未修改的知识库规则版本抽屉 30 秒超时。V5 专项 `smoke:browser:v5` 已独立 6/6 通过。

## 2026-07-10 阶段：V5 信息架构收敛

### 完成内容

1. 将 `月度策略包` 从独立顶层入口收敛为 `月度内容矩阵` 子页面：`/monthly-matrix/strategy`。
2. 将 `批量生成中心` 从独立顶层入口收敛为 `月度内容矩阵` 子页面：`/monthly-matrix/batch-generation`。
3. 将 `当日执行` 从独立顶层入口收敛为 `定时发布排程` 子页面：`/publish-schedule/daily-execution`。
4. 保留旧路径 `/monthly-strategy`、`/batch-generation`、`/daily-execution` 作为兼容重定向，避免旧链接和验收脚本直接失效。
5. 将 `V5GovernanceLogTabs` 从 `Agent 底座总览` 移入 `AI 配置` 的 `V5 治理日志` Tab，避免普通业务流程暴露内部治理入口。
6. 侧边栏改为父子菜单结构：`月度内容矩阵` 下挂策略包和批量生成，`定时发布排程` 下挂当日执行，`AI 配置` 下挂 Agent 底座总览。
7. 更新 `validate:structure` 和 `smoke:pages`，把“新子路由存在、旧路由兼容 redirect、重复流程不再作为顶层导航”纳入自动验证。

### 覆盖与子页面判断

1. 覆盖原有重复流程职责：`月度内容矩阵` 作为 V5 主计划入口，会覆盖旧的“周计划作为主规划入口”的一部分职责；`批量生成中心` 覆盖旧的“今日发布里同时承担批量生成入口”的重复职责，但当前只做 UI 壳，不改 V4 后端。
2. 保留原页面执行职责：`今日发布`、`周计划`、`周度复盘` 继续作为 V4 执行视图和历史工作流入口，不在本分支删除。
3. 适合作为子页面：`月度策略包` 是月度矩阵确认前的审核视图，`批量生成中心` 是矩阵确认后的生产队列，`当日执行` 是发布排程下的当日操作视图。
4. 保留顶层入口：`异常队列` 是高频人工判断入口，`定时发布排程` 是发布槽位总览，`月度复盘` 是周期闭环入口，继续保留顶层。
5. 内部治理入口：`Agent 底座` 和 `V5 治理日志` 归入 AI 配置/治理区域，不作为普通内容生产主入口。

### 自检结果

1. `npm.cmd run typecheck`：通过。
2. `npm.cmd run validate:structure`：通过，206/206。
3. `npm.cmd run smoke:interactions`：通过，47/47。
4. `npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3047`：通过，32/32。
5. 受保护文件检查：`data/workbench-state.json`、`src/lib/types.ts`、`src/lib/workbench-store.ts`、`src/app/api` 无 diff。
6. 敏感信息检查：未发现密钥值；仅命中公开环境变量名示例和校验脚本禁止词。

## 2026-07-10 阶段：月度内容矩阵 UI 壳

### 完成内容

1. 新增 V5 月度主流程页面壳：月度内容矩阵、月度策略包审核、Agent 底座总览、批量生成中心、异常队列、定时发布排程、当日执行、月度复盘。
2. 侧边栏新增 V5 主导航，顶部流程文案改为“月度内容矩阵 -> 批量生成 -> 异常队列 -> 定时发布 -> 月度复盘”。
3. 新增 V5 展示组件：`MonthlyMatrixTable`、`EvidenceGateTag`、`PublishStatusTag`、`ProductionReadinessPanel`、`ExceptionQueuePreview`、`ScheduleCalendarLite`、`V5StatusRail`、`V5GovernanceLogTabs`。
4. 新增 `src/lib/v5-ui-mock-data.ts`，集中维护 V5 页面 mock 数据，并在页面中标注 `demo / mock / 待接入 / pending_config`。
5. `validate:structure` 增加 V5 页面、组件、mock 数据边界、“无真实后端调用”和治理日志不暴露原始内部字段的契约。
6. `smoke:pages` 增加 V5 新页面路由检查。

### 边界说明

1. 本阶段只做前端 UI 壳、mock 数据和页面信息架构。
2. 未新增真实月度计划 API、矩阵持久化、Workflow Agent、RAG、EvidencePack 生成、规则引擎、评测 Runner 或真实发布调用。
3. 未修改 `data/workbench-state.json`。
4. 未修改后端业务行为、shared domain types、store repository 或现有 V4 API。
5. V4 页面仍保留为执行视图，不删除原有导航入口。

### 自检结果

1. `npm.cmd run typecheck`：通过。
2. `npm.cmd run validate:structure`：通过，V5 契约与 V4 既有契约均通过。
3. `npm.cmd run smoke:interactions`：通过。
4. `npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3047`：通过，29/29。

### 当前风险

1. V5 页面仍是低风险 UI 壳，所有数据均为 mock，不能作为真实月度策略依据。
2. `validate:structure` 对历史 V4 文档允许从 `D:\GTM\工作台` 读取 canonical fallback；后续如果本分支需要独立交付，应补齐本地 V4 历史文档或改为正式文档依赖策略。
3. 当前没有视觉截图级验证；已通过类型、结构、交互契约和页面路由验证，后续进入中高保真 UI 时建议补浏览器截图检查。

### 下一步建议

1. 把 V5 mock 数据迁移为只读 API 前，先定义 `MonthlyPlan`、`ContentMatrixItem`、`BatchGenerationRun`、`PublishSchedule` 的真实接口契约。
2. 优先把产品规则包、知识库证据和 Evidence Gate 的真实准入规则接到月度矩阵页。
3. 定时发布排程进入真实接入前，必须先区分“草稿自动化”和“正式发布自动化”，缺配置时继续显示 `pending_config`。

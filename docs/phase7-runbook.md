# Phase 7 试运行与真实接入 Runbook

## 1. 当前阶段结论

当前项目已经从静态 Demo 响应推进到本地持久化工作流。

已完成：

1. 结构验证脚本已对齐当前文档和 API。
2. API Routes 已通过 `src/lib/workbench-store.ts` 读写 `data/workbench-state.json`。
3. 月度计划、批量生成、终稿确认、发布 URL 回填已经可以形成可持久化链路。
4. GEO、XCrawl、MySQL、Nginx/CDN 日志等外部能力已统一进入配置检查层。
5. 外部配置缺失时返回 `pending_config`，不生成假结果。
6. Worker 脚本已从占位输出改为调用本地 API 的真实任务入口。
8. Phase 7-C 主要页面操作已接 API，页面按钮不再只是静态入口。
9. 首页已新增一键运行 GTM Pipeline，可保存最近 20 次运行记录。
10. 首页已支持导出 Pipeline 运行记录 CSV，本地 `worker:schedule-pipeline` 可按固定间隔调用 Pipeline API。
11. 新增 `smoke:workflow`，可自动验证主链路并作为后续真实接入前后的回归检查。
12. AI 配置页已展示缺失配置、可复制 `.env.local` 模板；工作台设置页已支持保存默认规则。
13. 配置诊断 API 已能逐项测试 MySQL、模型、XCrawl 和日志路径，不返回任何密钥值。
14. 新增真实接入页，集中展示 MySQL、AI、XCrawl、Nginx/CDN、渠道模板和定时任务状态。
15. 页面级运行态失败提示已统一接入，`/api/workbench-state` 失败时会提示重试，不再静默展示兜底数据。
16. 新增 `docs/usage.md`，本地试运行路径、Pipeline、诊断和验证命令已经可以交接。
17. 新增 `smoke:interactions`，用于检查关键页面动作的 API、确认/弹窗、loading、反馈和刷新合约。
18. AI 配置页与真实接入页已补配置状态加载失败提示，避免真实接入判断被静默接口失败误导。
19. 博客同步、博客数据导入、AI Bot 日志导入和渠道指标导入已补二次确认。
20. 月度计划页已支持单条确认、批量确认和删除未生成任务。
21. 月度复盘页已支持导出 Markdown，并通过 `GET /api/monthly-reviews/{month}/export` 返回可交付月度复盘文本。
22. 月度复盘页已支持把月度复盘建议生成下月计划草稿，并通过 `POST /api/monthly-reviews/{month}/next-plan` 写入运行态。
24. 博客候选池页已支持标记已规划和移出候选池，并通过 `PATCH/DELETE /api/blog-articles/{id}/candidate` 写入运行态。
25. 发布队列页已支持单条录入渠道指标，并通过 `PATCH /api/publish-records/{id}/metrics` 写入运行态。
26. 博客候选池页已支持生成渠道补强任务，并通过 `POST /api/blog-articles/{id}/candidate/task` 追加到当前月度计划。
28. 新增 `smoke:browser`，通过系统 Chrome 真实点击月度计划 Popconfirm、知识库新增 Modal 和发布 URL 回填 Modal，并验证刷新后的 DOM 状态。
29. 博客监控页已补候选状态、优先级、建议原因和下一步判断，可直接区分先诊断、建议入候选池、候选池处理、已规划、继续观察和暂不处理。
31. 月度计划页已补稿件承接、发布承接和下一步判断，可直接区分待确认、待生成、终稿确认、人工发布、URL 回填、录入指标和可复盘。
32. 首页已补执行队列，可把月度计划、稿件、发布、博客、GEO 和月度复盘的待处理项汇总成优先动作入口。
33. 知识库页已补可用性与下一步动作，可直接区分需启用、补调用范围、确认可信度、补同步记录、仅对比调用和可调用知识库。
34. AI 配置页已补当前动作与下一步，可直接区分待补配置、待执行诊断、诊断失败、本地 fallback 和可试跑能力。
35. 真实接入页已补接入缺口、当前动作、下一步和试跑入口，可直接区分补配置、诊断、排查失败、验数据库、GEO 试跑、同步博客和导入日志。
36. 月度计划页已补“处理动作 / 可执行入口 / 维护”，把计划确认、稿件生成、AI 配置排查、终稿处理、发布回填、指标录入和复盘入口拆成单行闭环。
37. 首页执行队列已补“当前状态 / 处理动作 / 可执行入口”，负责人可直接从首页判断当前阻塞项和下一步跳转。
38. 月度复盘页复盘行动队列已把“当前动作”统一为“处理动作”，全站关键业务页表达已收敛到同一套闭环语言。
39. AI 配置页已统一为“下一步 / 处理动作 / 可执行入口 / 诊断”，并在顶部提示最高优先级能力，便于先处理失败、缺配置或待诊断项。
40. 真实接入页的自动化与模板表已补“下一步 / 处理动作 / 可执行入口”，手动 Pipeline、本地 Worker、定时任务和渠道模板都有明确承接方式。
41. 月度复盘页的下月建议已补成“建议 / 下一步 / 处理动作 / 可执行入口”，未生成月度复盘时先收束到生成月度复盘，已生成月度复盘时可直接复核建议并生成下月计划草稿。
42. 真实接入页的接入顺序已补成动态闭环表，不再只描述顺序，而是直接显示本地 JSON、MySQL、AI Provider、博客/日志源和自动化模板当前卡在哪一段、下一步去哪。
43. 首页执行队列、官网博客与 GEO 概览、Pipeline 运行记录已统一补成闭环表，首页不再承担“信息看板”角色，而是总控入口：每个阻塞项都能直接看到当前状态、下一步、处理动作和入口。
44. 生产模式下读取运行态的 GET API 已统一声明 `force-dynamic`，避免 `next start` 把本地 JSON 状态预渲染成旧快照，导致“保存成功但页面刷新后看不到”。
45. 知识库页已补稳定排序，新增知识库会优先显示在列表顶部，浏览器 smoke 已验证“新增 -> 保存 -> DOM 立刻可见”。

当前还不是最终生产系统。它的定位是：在不提供真实密钥和外部服务的前提下，先把真实工作流接口、状态流转和缺配置反馈跑通。

## 2. 已完成试跑

本地 dev server 下已试跑：

```powershell
POST /api/monthly-plans/generate
POST /api/content-tasks/batch-generate
POST /api/article-drafts/{id}/approve
PATCH /api/publish-records/{id}/url
POST /api/blog-articles/sync
POST /api/log-imports
POST /api/channel-metrics/import
POST /api/pipeline/run
GET /api/workbench-state
GET /api/runtime-config/status
GET /api/monthly-reviews/{month}/export
POST /api/monthly-reviews/{month}/next-plan
PATCH /api/blog-articles/{id}/candidate
DELETE /api/blog-articles/{id}/candidate
PATCH /api/publish-records/{id}/metrics
POST /api/blog-articles/{id}/candidate/task
```

结果：

1. 生成 4 条月度计划任务。
2. 生成 4 篇本地规则稿。
3. 确认 1 篇终稿并进入发布队列。
4. 回填 1 条发布 URL。
5. `data/workbench-state.json` 中可看到任务、稿件、发布记录和审计事件变化。
6. 配置状态接口只返回缺失环境变量名，不返回密钥值。
7. 博客、Bot 日志和渠道表现数据可通过 adapter 写入本地状态，缺配置时保留 `pending_config` 或 `pending_input` 反馈。
9. `worker:run-pipeline` 可把上述任务串成一个本地编排链路。
10. Pipeline smoke 已验证日志导入和渠道数据导入成功；缺少 GEO 模型配置时返回 `partial` + `pending_config`，不阻断其他可执行步骤。
11. 页面 smoke 已覆盖主要操作入口：任务编辑/重生成、稿件重生成、发布标记、GEO 快照/人工修正、博客入候选池均有真实 API 落点。
12. 页面 Pipeline 已可从首页触发，执行结果写入 `pipelineRuns`，用于回看每一步成功、缺配置或失败原因。
13. Pipeline 运行记录可导出 CSV，定时 worker 可在本地以 `--repeat --interval-seconds` 方式持续调用。
14. `smoke:workflow` 可在统一协议下跑完首页、任务、稿件、发布、博客、GEO 和 Pipeline 的主链路。
15. 配置页可查看 ready / pending_config，设置页可保存默认发布规则、产品范围、GEO 平台和日志模式。
16. 配置诊断页和 AI 配置页配合使用，方便后续把真实接入项逐个点亮。
21. 页面失败态已覆盖首页、月度计划、今日任务、终稿确认、发布队列、博客监控、博客候选池、GEO、月度复盘、知识库、真实接入和设置页。
22. `smoke:pages` 已覆盖主要页面访问、运行态 API、配置诊断 API、月度复盘 API 和月度复盘 Markdown 导出 API。
23. `smoke:interactions` 已覆盖 64 个关键页面动作的源码交互合约。
24. `smoke:workflow` 已覆盖月度复盘 Markdown 导出、下月计划草稿生成、GEO 结果入候选池、博客候选池生命周期、发布记录单条指标回填和博客候选生成渠道任务，当前通过结果为 36/36。
26. `smoke:browser` 已覆盖 Popconfirm、Modal 表单和保存后的 DOM 刷新，当前通过结果为 3/3。
27. 生产模式下的运行态刷新已额外验证：知识库新增不再受静态 API 快照影响，浏览器 smoke 当前通过结果仍为 3/3。
27. 今日任务页已支持按状态、渠道、产品筛选，并在筛选无结果时提供清空筛选动作。
28. 发布队列页已支持按发布状态、渠道筛选，并在筛选无结果时提供清空筛选动作。
29. 博客监控页已支持按收录状态、GEO 结果、数据来源筛选，并在筛选无结果时提供清空筛选动作。
31. 博客候选池页已支持按来源、优先级、候选状态和数据来源筛选，并在筛选无结果时提供清空筛选动作。
32. 知识库页已支持按知识库类型、可信等级和启用状态筛选，并在筛选无结果时提供清空筛选动作。
33. 真实接入页已支持按接入类型和配置状态筛选，并在筛选无结果时提供清空筛选动作。
34. 首页已支持按 Pipeline 运行状态和周次筛选运行记录，并在筛选无结果时提供清空筛选动作。
35. 设置页已按发布节奏与执行采集规则分组，并提供当前规则概览、规则检查、下一步动作和恢复当前保存配置动作。
36. 月度复盘页已支持按发布状态、博客 GEO 结果和 GEO 执行状态筛选复盘明细，并在筛选无结果时提供清空筛选动作。
37. 月度计划页已支持按任务状态、渠道和产品筛选任务，并在筛选无结果时提供清空筛选动作。
38. AI 配置页已支持按配置状态筛选 Provider、能力状态和真实接入项，并在筛选无结果时提供清空筛选动作。
39. 终稿确认页已展示任务上下文、稿件来源和阻断项入队提示，质检未通过时不可直接入队。
40. 今日任务页已展示稿件状态、质检结果和终稿确认可用性，未生成稿件时不会误导用户进入终稿确认。
41. 发布队列页已展示来源任务、稿件来源和下一步执行判断，能直接区分待发布、待回填 URL、待录入指标和可复盘记录。
42. 博客监控页已展示候选状态、优先级、建议原因和下一步执行判断，能直接区分先诊断、建议入候选池、候选池处理、已规划、继续观察和暂不处理。
44. 月度计划页已展示稿件承接、发布承接和下一步执行判断，能从计划入口直接追踪任务是否生成、质检、入队、发布、回填和复盘。
45. 首页已展示执行队列，能从首页直接看到待确认、待生成、待终稿、待发布、博客待处置、GEO 待处置和可复盘数量，并跳转到对应处理页面。
46. 知识库页已展示可用性和下一步动作，能从知识库列表直接判断哪些来源可调用、哪些需要启用、补范围、补可信度或补同步记录。
47. AI 配置页已展示当前动作和下一步，能从配置页直接判断哪些能力只够本地 fallback、哪些该先补环境变量、哪些该先做诊断、哪些已经可进入真实试跑。
49. 博客候选池页已展示候选处置判断和处理动作，能从候选池直接判断该确认入池、生成任务、标记规划、复查来源，还是去月度计划回看承接结果。
50. 月度复盘页已展示复盘行动队列，能从复盘页直接判断该处理发布、回填 URL、录入指标、处理博客候选、排查 GEO 配置、沉淀 GEO 候选，还是生成下月计划。
51. 今日任务页已展示执行承接判断，能从当天任务直接判断该回月度计划确认、生成稿件、排查生成、处理质检、终稿确认、进入发布队列、回填 URL、录入指标，还是去月度复盘。
52. 终稿确认页已展示执行承接判断，能从终稿页直接判断该检查生成配置、重新生成、处理质检阻断、加入发布队列、去发布页承接、回填 URL、录入指标，还是去月度复盘。
53. 博客监控页已展示处理动作和可执行入口，能从博客列表直接判断该先诊断、加入候选池、去候选池处理、看月度计划、继续观察，还是进入月度复盘。

## 3. 当前缺少的外部配置

后续真实接入时需要补充：

```text
MYSQL_HOST
MYSQL_PORT
MYSQL_DATABASE
MYSQL_USER
MYSQL_PASSWORD

OPENAI_API_KEY
OPENAI_MODEL
OPENAI_BASE_URL

DEEPSEEK_API_KEY
DEEPSEEK_MODEL
DEEPSEEK_BASE_URL

DOUBAO_API_KEY
DOUBAO_MODEL
DOUBAO_BASE_URL

XCRAWL_BLOG_INDEX_URL
NGINX_ACCESS_LOG_PATH
CDN_LOG_EXPORT_PATH
```

其中 `BASE_URL` 类配置可选，只有使用非默认网关时才需要。

## 4. 下一阶段任务

### 4.1 Phase 7-C：页面操作接线

目标：让页面按钮真正调用 API，而不是只展示入口。

当前已完成：

1. 月度计划页：`生成月度计划` 调用 `POST /api/monthly-plans/generate`。
2. 今日任务页：`批量生成` 调用 `POST /api/content-tasks/batch-generate`。
3. 今日任务页：单条 `生成` 调用 `POST /api/content-tasks/{id}/generate`。
4. 终稿页：`保存草稿` 调用 `PATCH /api/article-drafts/{id}`。
5. 终稿页：`加入发布队列` 调用 `POST /api/article-drafts/{id}/approve`。
6. 发布页：`导出发布清单` 调用 `POST /api/publish-records/export`。
7. 发布页：`回填 URL` 调用 `PATCH /api/publish-records/{id}/url`。
9. 博客监控页：`同步博客内容` 调用 `POST /api/blog-articles/sync`，缺配置时显示 `pending_config`。
10. 月度计划页：`编辑` 调用 `PATCH /api/content-tasks/{id}`。
11. 月度计划页：`重生成` 调用 `POST /api/content-tasks/{id}/regenerate-title`。
12. 月度计划页：`确认` / `批量确认` 调用 `POST /api/content-tasks/confirm`。
13. 月度计划页：`删除` 调用 `DELETE /api/content-tasks/{id}`，只允许删除未生成稿件的任务。
14. 终稿页：`重新生成` 调用 `POST /api/content-tasks/{id}/generate`。
15. 发布页：`标记已发布` 调用 `PATCH /api/publish-records/{id}/published`。
17. 博客监控页：`入候选池` 调用 `POST /api/blog-articles/{id}/candidate`。
18. 博客候选池页：从运行时博客状态派生候选清单，不再使用静态数组。
19. 首页：`运行 GTM Pipeline` 调用 `POST /api/pipeline/run`，并展示最近运行记录。
20. 首页：`导出 CSV` 调用 `GET /api/pipeline/runs/export`，导出 Pipeline 运行记录。
21. `scripts/smoke-workflow.mjs`：自动调用主链路 API，适合作为后续真实配置接入前后的回归脚本。
22. `GET/PATCH /api/workspace-settings`：保存默认工作台规则，避免页面继续使用静态设置。
23. `GET/POST /api/config-diagnostics`：逐项检查真实接入能力，返回 ready / pending_config / failed。
24. 月度复盘页：`导出 Markdown` 调用 `GET /api/monthly-reviews/{month}/export`，并复制可交付月度复盘文本。
25. 月度复盘页：`生成下月计划草稿` 调用 `POST /api/monthly-reviews/{month}/next-plan`，并把月度复盘建议反哺到下一轮排期。
27. 博客候选池页：`标记已规划` 调用 `PATCH /api/blog-articles/{id}/candidate`，`移出` 调用 `DELETE /api/blog-articles/{id}/candidate`。
28. 发布页：`录入指标` 调用 `PATCH /api/publish-records/{id}/metrics`，支持不走 CSV 的单条渠道数据回填。
29. 博客候选池页：`生成任务` 调用 `POST /api/blog-articles/{id}/candidate/task`，把博客/GEO 缺口转成当前月度计划的渠道补强任务。
31. 月度复盘页：新增“复盘行动队列”，可把发布队列、URL 回填、渠道指标、博客候选、GEO 配置和 GEO 缺口聚合成可执行动作，并直接跳转到处理页面。
32. GEO 页：新增“处理动作 / 可执行入口”，把配置排查、失败快照、候选池承接、月度计划回看和月度复盘串成可点击闭环。
33. 发布页：新增“处理动作 / 可执行入口”，按真实顺序只暴露当前优先动作，并新增稳定 `data-testid` 供浏览器 smoke 验证“标记已发布 -> 回填 URL”。
34. 知识库页：新增“处理动作 / 可执行入口 / 维护”，把启用、补范围、确认可信度、补同步记录、竞品对比调用和内容生成承接拆清楚。
35. AI 配置页：新增“处理动作 / 可执行入口 / 诊断”，把真实试跑跳转和连接诊断拆开，便于判断是补配置、先诊断、排查失败还是进入业务页。

验收：

1. 每个关键按钮都有 loading、success、error 状态。
2. API 成功后页面能刷新运行时状态。
3. 缺配置时提示缺少哪些环境变量。
4. 运行态 API 失败时页面能提示失败原因，并提供重试动作。

### 4.2 Phase 7-D：MySQL repository

目标：把本地 JSON repository 替换成 MySQL repository。

任务：

1. 建立 `src/lib/repositories/` 边界。
2. 抽象 repository interface。
3. 保留 `local_json` 作为开发 fallback。
4. 新增 MySQL 连接池。
5. 将核心对象 CRUD 接到 MySQL。
6. 增加迁移/初始化脚本。

当前已完成：

1. 已建立 `src/lib/repositories/` repository 边界。
2. 已将本地 JSON 读写收敛到 `local-json` repository。
3. 已新增 `npm.cmd run check:mysql`，用于在提供 MySQL 环境变量后检查连接。
4. 已新增 `npm.cmd run init:mysql`，用于在连接可用后初始化 `database/schema.sql`。
5. 已新增 MySQL state bridge：环境变量齐全时可将工作台状态读写到 `workbench_state_snapshot`。

验收：

1. 无 MySQL 配置时仍能用本地 JSON 试跑。
2. 有 MySQL 配置时 API 写入数据库。
3. `GET /api/runtime-config/status` 能显示 MySQL ready。

### 4.3 Phase 7-E：真实 AI / XCrawl / 日志接入

目标：把占位任务换成真实外部任务执行。

任务：

1. 接入 OpenAI、DeepSeek、豆包 Provider。
2. 保存模型、Prompt、原始回答和错误信息。
3. 接入 XCrawl 博客同步。
4. 支持 Nginx/CDN 日志文件解析。
5. 保留手动 CSV 导入作为 fallback。

当前已完成：

1. 已新增 `src/lib/ai-provider.ts`，支持 OpenAI-compatible chat completion。
2. 内容生成已接入 AI Provider 路径；缺配置或失败时使用本地规则 fallback。
4. 博客同步已接入 `src/lib/blog-sync-adapter.ts`，支持 `articles`、`sourceUrl`、JSON、CSV、sitemap XML 和允许目录内文件。
5. 日志导入已接入 `src/lib/log-import-adapter.ts`，支持 CSV 和 Nginx-like 原始日志文本。
6. 渠道数据已接入 `src/lib/channel-metrics-adapter.ts` 和 `POST /api/channel-metrics/import`，可写入 `publishRecords[].channelMetrics`。
7. `database/schema.sql` 已为 `publish_record` 增加 `channel_metrics JSON`。
8. `workers/` 已改成可执行脚本，能直接调用本地 API，后续只需挂定时任务或真实数据源。
9. `workers/run-pipeline.mjs` 已提供本地任务编排入口，缺配置步骤返回 `pending_config`，不会阻断其他可执行步骤。

验收：

1. API 调用失败可重试。
2. 不覆盖原始回答快照。
3. Demo/imported/real 数据可信度清晰区分。

## 5. 每阶段验证命令

每阶段完成后运行：

```powershell
npm.cmd run validate:structure
npm.cmd run smoke:interactions
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

涉及页面/API 工作流时，还需要启动本地服务后跑最小链路。不要在 dev server 运行期间并行执行 `next build`，避免 `.next` 被重写导致浏览器 smoke 的 hydration 状态不稳定：

```powershell
npm.cmd run dev
```

再验证。`smoke:browser` 和 `smoke:workflow` 都会写入 `data/workbench-state.json`，需要顺序执行，不能并行跑；否则浏览器 smoke 准备好的任务可能被 workflow 重建月度计划覆盖，导致误报：

```powershell
GET /api/dashboard/summary
GET /api/workbench-state
GET /api/runtime-config/status
npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3000
npm.cmd run smoke:browser -- --base-url=http://127.0.0.1:3000
npm.cmd run smoke:workflow -- --base-url=http://127.0.0.1:3000
POST /api/blog-articles/sync
POST /api/log-imports
POST /api/channel-metrics/import
npm.cmd run worker:sync-blog
npm.cmd run worker:import-log
npm.cmd run worker:import-channel-metrics
npm.cmd run worker:run-pipeline
```

推荐使用固定 smoke 文件验证渠道指标导入，避免 PowerShell 多行 CSV 参数转义影响结果：

```powershell
```

## 6. 当前风险

1. `smoke:interactions` 是源码合约检查，`smoke:browser` 是第一版真实浏览器点击检查；后续仍要继续扩展导入表单、批量选择和更多异常路径。
2. `workers/` 现在能执行，也已有本地定时 worker；但还没有接 Windows Task Scheduler、cron 或生产队列。
3. 本地 JSON repository 适合单人试运行，不适合多人并发。
4. 真实 AI、XCrawl、MySQL、Nginx/CDN 文件路径接入后，需要重点补错误恢复和数据一致性验证。
5. 渠道 CSV 字段目前支持通用别名，正式使用前要为微信、CSDN、掘金、知乎/头条分别确认导出模板。
6. MySQL 仍是 state snapshot bridge，尚未切到完整 CRUD repository。
7. 当前页面闭环已经收口到“状态 -> 下一步 -> 处理动作 -> 可执行入口”，但真实接入后的异常恢复、权限失败和数据回滚仍主要靠人工判断，后续要继续补异常路径 smoke。

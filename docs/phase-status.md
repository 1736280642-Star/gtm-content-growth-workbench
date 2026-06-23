# Phase 0~7 当前完成状态

## 总览

| Phase        | 状态             | 说明                                                                        |
| ------------ | -------------- | ------------------------------------------------------------------------- |
| Phase 0      | 已完成文档与配置准备     | 资产审计、渠道规则、AI Provider 示例、Demo 日志已落地                                       |
| Phase 1      | 已完成工程骨架        | Next.js、Ant Design、MySQL schema、API 骨架已建立                                 |
| Phase 2      | 已完成页面与 Demo 流程 | 周计划页面、生成接口占位、任务状态已具备                                                      |
| Phase 3      | 已完成页面与 Demo 流程 | 今日任务、稿件、质检、终稿确认页面已具备                                                      |
| Phase 4      | 已完成页面与 Demo 流程 | 发布队列、导出入口、URL 回填入口已具备                                                     |
| Phase 5      | 已完成页面与 Demo 流程 | 博客监控、GEO 测试、Demo 日志指标已具备                                                  |
| Phase 6      | 已完成页面与 Demo 流程 | 周度复盘、下周建议和候选池逻辑已具备                                                        |
| Phase 7-A    | 已完成验收基线修正      | 结构验证脚本已对齐当前文档路径，并纳入 `workbench-state` 状态 API                              |
| Phase 7-B    | 已完成本地持久化工作流    | API 已从静态 Demo 响应升级为本地 JSON 持久化状态                                          |
| Phase 7-C    | 主要接线完成         | 关键页面操作、首页一键 pipeline、运行记录导出、本地定时 worker、主链路 smoke、配置诊断和占位清单已具备            |
| Phase 7-C-UI | 持续补齐中          | 新增真实接入页，核心表格页已补空状态、失败重试状态和下一步动作，页面级 smoke 已具备；周报、知识库维护、关键操作确认和使用说明已接上     |
| Phase 7-D    | 部分完成           | 已有 MySQL schema、连接检查、初始化脚本和 state bridge；尚未切换到完整 MySQL CRUD repository    |
| Phase 7-E    | 部分完成           | AI Provider、博客同步、日志导入、渠道指标导入和 Worker 编排已具备；真实密钥、XCrawl、Nginx/CDN 固定路径仍待配置 |

## 结构验证

已补充本地结构验证命令：

```powershell
npm.cmd run validate:structure
```

最近一次验证结果：

```text
Structure checks: 68/68 passed
```

当前最新验证结果：

```text
Structure checks: 88/88 passed
```

当前一键 pipeline 接线后的最新验证结果：

```text
Structure checks: 104/104 passed
```

当前页面补齐后的最新验证结果：

```text
Structure checks: 148/148 passed
```

当前失败态与使用说明补齐后的最新验证结果：

```text
Structure checks: 163/163 passed
```

当前交互合约 smoke 补齐后的最新验证结果：

```text
Structure checks: 165/165 passed
smoke:interactions: 26/26 passed
```

当前配置失败态与导入确认补齐后的最新验证结果：

```text
smoke:interactions: 26/26 passed
```

当前周计划任务确认/删除补齐后的最新验证结果：

```text
Structure checks: 174/174 passed
smoke:interactions: 29/29 passed
```

当前周报 Markdown 导出补齐后的最新验证结果：

```text
Structure checks: 179/179 passed
smoke:interactions: 30/30 passed
smoke:pages: 17/17 passed
smoke:workflow: 30/30 passed
```

当前周报建议生成下周计划草稿补齐后的最新验证结果：

```text
Structure checks: 184/184 passed
smoke:interactions: 31/31 passed
smoke:pages: 17/17 passed
smoke:workflow: 31/31 passed
```

当前博客候选生成渠道补强任务补齐后的最新验证结果：

```text
Structure checks: 205/205 passed
smoke:interactions: 36/36 passed
smoke:pages: 17/17 passed
smoke:workflow: 36/36 passed
```

当前周报明细复盘补齐后的最新验证结果：

```text
Structure checks: 206/206 passed
smoke:interactions: 36/36 passed
```

当前浏览器点击级 smoke 补齐后的最新验证结果：

```text
Structure checks: 211/211 passed
smoke:browser: 3/3 passed
```

当前今日任务筛选补齐后的最新验证结果：

```text
Structure checks: 212/212 passed
smoke:interactions: 37/37 passed
```

当前发布队列筛选补齐后的最新验证结果：

```text
Structure checks: 213/213 passed
smoke:interactions: 38/38 passed
```

当前博客监控筛选补齐后的最新验证结果：

```text
Structure checks: 214/214 passed
smoke:interactions: 39/39 passed
```

当前 GEO 测试筛选补齐后的最新验证结果：

```text
Structure checks: 215/215 passed
smoke:interactions: 40/40 passed
```

当前博客候选池筛选补齐后的最新验证结果：

```text
Structure checks: 216/216 passed
smoke:interactions: 41/41 passed
```

当前知识库筛选补齐后的最新验证结果：

```text
Structure checks: 217/217 passed
smoke:interactions: 42/42 passed
```

当前真实接入页筛选补齐后的最新验证结果：

```text
Structure checks: 218/218 passed
smoke:interactions: 43/43 passed
```

当前首页 Pipeline 记录筛选补齐后的最新验证结果：

```text
Structure checks: 219/219 passed
smoke:interactions: 44/44 passed
```

当前设置页分组与规则概览补齐后的最新验证结果：

```text
Structure checks: 220/220 passed
smoke:interactions: 45/45 passed
```

当前周报明细筛选补齐后的最新验证结果：

```text
Structure checks: 221/221 passed
smoke:interactions: 46/46 passed
```

当前周计划筛选补齐后的最新验证结果：

```text
Structure checks: 222/222 passed
smoke:interactions: 47/47 passed
```

当前 AI 配置页筛选补齐后的最新验证结果：

```text
Structure checks: 223/223 passed
smoke:interactions: 48/48 passed
```

当前终稿确认页上下文补齐后的最新验证结果：

```text
Structure checks: 224/224 passed
smoke:interactions: 49/49 passed
```

当前今日任务稿件就绪视图补齐后的最新验证结果：

```text
Structure checks: 225/225 passed
smoke:interactions: 50/50 passed
```

当前发布队列执行上下文补齐后的最新验证结果：

```text
Structure checks: 226/226 passed
smoke:interactions: 51/51 passed
```

当前博客监控执行判断补齐后的最新验证结果：

```text
Structure checks: 227/227 passed
smoke:interactions: 52/52 passed
```

当前 GEO 测试处置判断补齐后的最新验证结果：

```text
Structure checks: 228/228 passed
smoke:interactions: 53/53 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前周计划下游承接视角补齐后的最新验证结果：

```text
Structure checks: 229/229 passed
smoke:interactions: 54/54 passed
```

当前首页执行队列视角补齐后的最新验证结果：

```text
Structure checks: 230/230 passed
smoke:interactions: 55/55 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前知识库可用性与下一步动作补齐后的最新验证结果：

```text
Structure checks: 231/231 passed
smoke:interactions: 56/56 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前 AI 配置处置视角补齐后的最新验证结果：

```text
Structure checks: 232/232 passed
smoke:interactions: 57/57 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前设置页规则检查与下一步动作补齐后的最新验证结果：

```text
Structure checks: 233/233 passed
smoke:interactions: 58/58 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前真实接入页缺口判断与试跑入口补齐后的最新验证结果：

```text
Structure checks: 234/234 passed
smoke:interactions: 59/59 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前博客候选池处置判断补齐后的最新验证结果：

```text
Structure checks: 235/235 passed
smoke:interactions: 61/61 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前周报行动队列补齐后的最新验证结果：

```text
Structure checks: 236/236 passed
smoke:interactions: 62/62 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前今日任务执行承接补齐后的最新验证结果：

```text
Structure checks: 237/237 passed
smoke:interactions: 63/63 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前终稿确认页执行承接补齐后的最新验证结果：

```text
Structure checks: 238/238 passed
smoke:interactions: 64/64 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前博客监控页可执行入口补齐后的最新验证结果：

```text
Structure checks: 238/238 passed
smoke:interactions: 64/64 passed
smoke:pages: 17/17 passed
smoke:browser: 3/3 passed
smoke:workflow: 36/36 passed
```

当前 GEO、发布队列和知识库可执行入口补齐后的最新验证结果：

```text
typecheck: passed
Structure checks: 238/238 passed
smoke:interactions: 64/64 passed
lint: passed
smoke:pages: 17/17 passed
smoke:workflow: 36/36 passed
smoke:browser: 3/3 passed
```

当前 AI 配置与设置页可执行入口补齐后的最新验证结果：

```text
typecheck: passed
Structure checks: 238/238 passed
smoke:interactions: 64/64 passed
lint: passed
smoke:pages: 17/17 passed
```

该验证证明当前 MVP 骨架中的文档、配置、页面、API 文件、API 方法导出、schema、worker、真实数据导入 adapter、pipeline worker、主要页面操作接线、运行态失败提示、配置状态失败提示、导入确认和关键交互合约均已按当前范围落地。

2026-06-17 已修正结构验证脚本中的 PRD 文档路径：当前 PRD 文件位于 `docs/MVP-PRD1.md` 和 `docs/MVP-PRD2.md`。
同日新增 `GET /api/workbench-state`，用于让页面读取本地持久化状态。

## 工程验证

已完成依赖安装与 Next.js 工程验证：

```powershell
cmd /c npm install
cmd /c npm run validate:structure
cmd /c npm run typecheck
cmd /c npm run lint
cmd /c npm run build
```

验证结果：

1. 结构验证通过：`66/66 passed`。
2. TypeScript 类型检查通过。
3. ESLint 检查通过，无 warnings 或 errors。
4. Next.js 生产构建通过，生成 23 个页面/路由。
5. 本地 dev server 已验证：首页、今日任务页、博客监控页和 Dashboard API 均可访问。

2026-06-17 后续验证结果：

1. 结构验证通过：`68/68 passed`。
2. TypeScript 类型检查通过。
3. ESLint 检查通过，无 warnings 或 errors。
4. Next.js 生产构建通过，生成 24 个页面/路由。
5. API 试跑通过：周计划生成、批量生成稿件、终稿确认、发布 URL 回填均已写入 `data/workbench-state.json`。

2026-06-18 后续验证结果：

1. 结构验证通过：`88/88 passed`。
2. TypeScript 类型检查通过。
3. ESLint 检查通过，无 warnings 或 errors。
4. Next.js 生产构建通过，生成 26 个页面/路由。
5. Pipeline smoke 通过：日志导入成功，渠道指标导入匹配 1 条；GEO 因缺少模型配置返回 `pending_config`，pipeline 状态为预期的 `partial`。
6. MySQL 检查和初始化脚本在未配置环境变量时返回 `pending_config`，不读取或打印密钥。

2026-06-18 页面补齐验证结果：

1. 结构验证通过：`148/148 passed`。
2. TypeScript 类型检查通过。
3. ESLint 检查通过，无 warnings 或 errors。
4. Next.js 生产构建通过，生成 31 个页面/路由。
5. 新增 `smoke:pages` 页面级访问检查，可覆盖主要页面、运行态 API、配置诊断 API 和周报 API。
6. 本地 dev server 已验证 `/real-integration`、`/weekly-plan`、`/today`、`/publish`、`/blog-monitor`、`/geo-test` 均可访问。
7. 周度复盘页“生成周报”按钮已调用 `GET /api/weekly-reports/{week}`，并把结果展示回页面。
8. 知识库页已支持新增、编辑、启用/停用，并通过 `smoke:workflow` 验证本地持久化写入。
9. 周计划生成/重生成、今日批量/单篇生成、稿件重生成/入队、发布标记、GEO 批量测试和人工修正已补二次确认。

2026-06-18 继续补齐验证结果：

1. 新增 `PageErrorState`，统一展示运行态数据同步失败、保留兜底数据和重试动作。
2. `useWorkbenchSnapshot` 已返回 `error` 和 `usingFallback`，不再把 `/api/workbench-state` 失败静默当成成功。
3. 首页、周计划、今日任务、终稿确认、发布队列、博客监控、博客候选池、GEO 测试、周报、知识库、真实接入和设置页已接入页面级失败重试提示。
4. 新增 `docs/usage.md`，说明本地启动、试用顺序、Pipeline、运行态、配置诊断、验证命令和真实接入缺口。
5. 新增 `smoke:interactions`，覆盖首页 Pipeline、周计划、今日生成、终稿确认、发布队列、博客监控、GEO、周报、知识库、设置、AI 配置和真实接入页的关键交互合约。
6. AI 配置页和真实接入页已补配置状态加载失败提示与重试，避免把配置接口失败误判为全部待配置或全部就绪。
7. 博客同步、博客数据导入、AI Bot 日志导入、渠道指标导入已补二次确认。
8. 周计划页已支持单条确认、批量确认和删除未生成任务，并接入 `POST /api/content-tasks/confirm` 与 `DELETE /api/content-tasks/{id}`。
9. 博客监控页已支持按收录状态、GEO 结果、数据来源筛选，并在筛选无结果时提供清空筛选动作。
10. GEO 测试页已支持按平台、Prompt 组、执行状态、JOTO 提及、官网引用和数据来源筛选，并显式展示自动判断/人工修正与执行状态。
11. 博客候选池页已支持按来源、优先级、候选状态和数据来源筛选，并区分自动建议、已入池、已规划三种处理状态。
12. 知识库页已支持按知识库类型、可信等级和启用状态筛选，并用中文标签展示类型、可信等级和状态。
13. 首页已支持按 Pipeline 运行状态、周次筛选运行记录，并在筛选无结果时提供清空筛选动作。
14. 设置页已按发布节奏与执行采集规则分组，并提供当前规则概览和恢复当前保存配置动作。
15. 周报页已支持按发布状态、博客 GEO 结果和 GEO 执行状态筛选复盘明细，并在筛选无结果时提供清空筛选动作。
16. 周计划页已支持按任务状态、渠道和产品筛选任务，并在筛选无结果时提供清空筛选动作。
17. AI 配置页已支持按配置状态筛选 Provider、能力状态和真实接入项，并在筛选无结果时提供清空筛选动作。
18. 终稿确认页已补任务上下文、稿件来源和阻断项入队提示。
19. 今日任务页已补稿件状态、质检结果和终稿确认可用性判断。
20. 发布队列页已补来源任务、稿件来源和下一步执行判断。
21. 博客监控页已补候选状态、优先级、建议原因和下一步判断。
22. GEO 测试页已补问题级别、候选状态、建议原因和下一步判断。
23. 周计划页已补稿件承接、发布承接和下一步判断。

2026-06-18 周报 Markdown 导出补齐验证结果：

1. 新增 `GET /api/weekly-reports/{week}/export`，可返回结构化周报 Markdown。
2. 周度复盘页新增“导出 Markdown”，会调用导出 API 并复制到剪贴板。
3. Markdown 内容覆盖管理层摘要、渠道执行、官网博客诊断、GEO 测试、下周建议和数据说明。
4. `smoke:pages` 已覆盖周报 Markdown 导出 API。
5. `smoke:interactions` 已覆盖周报导出的 API、剪贴板、loading 和反馈合约。
6. `smoke:workflow` 已覆盖周报 Markdown 导出主链路。

2026-06-18 周报建议生成下周计划草稿补齐验证结果：

1. 新增 `POST /api/weekly-reports/{week}/next-plan`，可把周报建议转成下一周计划草稿。
2. 周度复盘页新增“生成下周计划草稿”，并通过 `Popconfirm` 做二次确认。
3. 生成草稿会复用工作台默认发布天数、每日篇数、渠道和产品配置。
4. 生成结果会写入本地运行态，并刷新页面数据；周计划页可直接查看新草稿。
5. `smoke:workflow` 已覆盖周报建议生成下周计划草稿主链路。

2026-06-18 GEO 结果入博客候选池补齐验证结果：

1. 新增 `POST /api/geo-test-results/{id}/candidate`，可将 GEO 未命中或官网链路不足结果加入博客候选池。
2. GEO 测试页新增“入候选池”动作，并通过 `Popconfirm` 做二次确认。
3. 入池结果会沉淀为 `geo://result/{id}` 候选主题，保留来源平台、Prompt 和入池原因。
4. `smoke:workflow` 已覆盖 GEO 结果入博客候选池主链路。

2026-06-18 博客候选池生命周期补齐验证结果：

1. `PATCH /api/blog-articles/{id}/candidate` 可将博客候选主题标记为已规划。
2. `DELETE /api/blog-articles/{id}/candidate` 可将候选主题标记为 `dismissed`，避免 SEO/GEO 自动建议再次显示。
3. 博客候选池页新增“标记已规划”和“移出”动作，并通过 `Popconfirm` 做二次确认。
4. `database/schema.sql` 已补齐 `blog_article` 的候选状态、候选原因和入池时间字段。
5. `smoke:workflow` 已覆盖博客候选池入池、标记已规划和移出主链路。

2026-06-18 发布队列单条渠道指标回填补齐验证结果：

1. 新增 `PATCH /api/publish-records/{id}/metrics`，可为单条发布记录保存阅读、点赞、收藏、评论和转发。
2. 发布队列页新增“录入指标”弹窗，支持逐条维护渠道表现，不再只能依赖 CSV 批量导入。
3. 发布队列表格新增“渠道指标”列，直接显示当前记录的基础表现数据。
4. `smoke:workflow` 已覆盖 CSV 导入后再手动覆盖单条指标的主链路。

2026-06-18 博客候选生成渠道补强任务补齐验证结果：

1. 新增 `POST /api/blog-articles/{id}/candidate/task`，可从博客候选主题生成当前周计划下的渠道补强任务。
2. 生成任务会追加到当前 `weeklyPlan`，不覆盖已有任务、稿件或发布队列。
3. 博客候选池页新增“生成任务”动作，并通过 `Popconfirm` 做二次确认。
4. 生成后候选主题会标记为 `planned`，周计划页可继续编辑、确认和生成稿件。
5. `smoke:workflow` 已覆盖博客入候选池后生成渠道补强任务的主链路。

本地访问地址：

```text
http://127.0.0.1:3000
```

## 当前完成定义

当前完成的是“可运行 MVP 骨架 + 本地持久化工作流 + 真实数据导入入口 + Worker 编排入口”，不是最终生产级实现。

已具备：

1. 页面入口完整。
2. 数据对象完整。
3. API 路由完整。
4. Worker 已从占位升级为可执行任务入口。
5. 本地 JSON 状态支撑 Phase 2~6 主流程试运行。
6. MySQL schema 已覆盖核心对象。
7. 博客候选池已作为待接入页面存在。
8. 外部服务未配置时返回 `pending_config`，不生成假结果。
9. 博客同步、AI Bot 日志、渠道表现数据可通过 API、页面入口或 Worker 写入本地状态。
10. Pipeline worker 可串联导入、GEO 测试和周报读取，适合作为后续定时调度入口。
11. 周计划、今日任务、终稿、发布队列、GEO、博客监控和博客候选池已经从静态按钮推进到真实 API 调用。
12. 首页已提供一键运行 GTM Pipeline，并在运行记录里保留最近 20 次结果。
13. Pipeline 运行记录可导出 CSV，本地 `worker:schedule-pipeline` 可按固定间隔重复执行。
14. 已新增 `smoke:workflow`，可自动回归首页、任务、稿件、发布、博客、GEO 和 Pipeline 主链路。
15. AI 配置页已显示 ready / pending_config 能力状态、缺失环境变量和 `.env.local` 模板。
16. 工作台设置页已支持保存默认发布规则、产品范围、GEO 平台和日志模式。
17. 配置诊断 API 已能逐项返回 ready / pending_config / failed，且不暴露密钥值。
18. 新增真实接入页，集中展示 MySQL、AI Provider、XCrawl、Nginx/CDN 日志、渠道模板和定时任务的交接状态。
19. 周计划、今日任务、发布队列、博客监控、博客候选池、GEO 测试、周报、知识库和终稿确认页已补空状态与下一步动作。
20. 周度复盘页“生成周报”已从静态按钮改为真实 API 调用。
21. 知识库页已从只读表格升级为可新增、编辑、启用/停用的维护页面。
22. 高风险页面操作已补 `Popconfirm` 二次确认，覆盖覆盖性生成、批量生成、入队、发布状态变更和人工修正。
23. 已新增 `smoke:pages`，可自动回归主要页面、只读状态 API 和周报 API。
24. 页面级运行态失败提示已统一接入，状态接口失败时不会再静默展示兜底数据。
25. 已新增 `docs/usage.md`，内部人员可以按文档完成本地试运行和验证。
26. 已新增 `smoke:interactions`，可自动检查 26 个关键页面动作是否仍具备 API 调用、确认/弹窗、loading、成功/失败反馈和刷新合约。
27. AI 配置页与真实接入页已能显示配置状态加载失败，并提供重试动作。
28. 博客、日志和渠道指标导入类操作已补确认弹窗，降低误写入本地状态的风险。
29. 周计划页已支持确认任务进入今日任务生成队列，并允许删除尚未生成稿件的计划任务。
30. 周度复盘已支持 Markdown 导出，可作为内部周报交付物复制使用。
31. 周度复盘已支持把周报建议生成下周计划草稿，补齐 Phase 6 复盘到计划的反哺闭环。
32. GEO 测试页已支持把未命中或链路不足主题加入博客候选池，补齐 Phase 5.13。
33. 博客候选池页已支持把候选主题标记为已规划或移出候选池，补齐候选主题后续处置闭环。
34. 发布队列页已支持单条录入渠道表现指标，补齐 Phase 4.7。
35. 博客候选池页已支持从候选主题生成渠道补强任务，补齐 Phase 5.6。
36. 周度复盘页已展示渠道 URL/指标、官网博客诊断明细和 GEO 测试明细，补齐 Phase 6.3、6.4、6.5。
37. 新增 `smoke:browser`，通过系统 Chrome 真实点击周计划 Popconfirm、知识库新增 Modal 和发布 URL 回填 Modal，并验证刷新后的 DOM 状态。
38. 今日任务页已支持按状态、渠道、产品筛选，并在筛选无结果时提供清空筛选动作，补齐 Phase 3.4。
39. 发布队列页已支持按发布状态、渠道筛选，并在筛选无结果时提供清空筛选动作，补齐 Phase 4.1 的队列管理视角。
40. 首页已支持按 Pipeline 运行状态、周次筛选运行记录，并在筛选无结果时提供清空筛选动作，补齐负责人回看执行风险的首页视角。
41. 设置页已按发布节奏与执行采集规则分组，并提供当前规则概览和恢复当前保存配置动作，补齐 Phase 2.3 的规则管理体验。
42. 周报页已支持按发布状态、博客 GEO 结果和 GEO 执行状态筛选复盘明细，补齐 Phase 6.3、6.4、6.5 的问题定位视角。
43. 周计划页已支持按任务状态、渠道和产品筛选任务，补齐 Phase 2.2 的计划管理视角。
44. AI 配置页已支持按 ready / pending_config 筛选 Provider、能力状态和真实接入项，补齐真实配置排查视角。
45. 终稿确认页已展示任务上下文、稿件来源和入队风险，补齐 Phase 3.13 的确认判断视角。
46. 今日任务页已展示稿件状态、质检结果和终稿确认可用性，补齐 Phase 3.4 的生成后承接视角。
47. 发布队列页已展示来源任务、稿件来源和下一步执行状态，补齐 Phase 4.1/4.5 的发布台账视角。
48. 博客监控页已展示候选状态、优先级、建议原因和下一步判断，补齐 Phase 5.2 的诊断后执行视角。
49. GEO 测试页已展示问题级别、候选状态、建议原因和下一步判断，补齐 Phase 5.7/5.13 的 GEO 结果处置视角。
50. 周计划页已展示稿件承接、发布承接和下一步判断，补齐 Phase 2.2 的任务下游承接视角。
51. 首页已展示执行队列，按周计划确认、稿件生成、终稿处理、发布回填、博客处置、GEO 处置和周报复盘汇总当前阻塞项，并提供对应页面跳转，补齐负责人从首页直接判断下一步动作的视角。
52. 知识库页已展示可用性与下一步动作，能区分需启用、补调用范围、确认可信度、补同步记录、仅对比调用和可直接调用，补齐知识来源从维护表格到调用判断的视角。
53. AI 配置页已展示当前动作与下一步，能区分待补必填配置、待执行诊断、诊断失败、本地 fallback 和可试跑能力，并给出对应页面跳转，补齐从配置状态到真实试跑的承接视角。
54. 设置页已展示规则检查与下一步动作，能区分未选择渠道、未选择产品、周产能过高、默认终稿风险、真实日志待配置、GEO 平台缺失和规则可用状态，补齐从默认规则到主流程执行准备的判断视角。
55. 真实接入页已展示接入缺口、当前动作、下一步和可执行入口，能区分补必填配置、执行诊断、排查失败、验数据库、GEO 试跑、同步博客和导入日志，补齐从交接清单到真实试跑的承接视角。
56. 博客候选池页已展示候选处置判断和处理动作，能区分确认入池、生成任务、标记规划、复查来源和已规划回看，补齐从候选清单到周计划承接的执行视角。
57. 周度复盘页已展示复盘行动队列，能从发布队列、URL 回填、渠道指标、博客候选、GEO 配置和 GEO 缺口中归纳优先动作，并给出对应可执行入口，补齐从周报复盘到下周执行的承接视角。
58. 今日任务页已展示执行承接判断，能从计划确认、稿件生成、生成排查、质检处理、终稿确认、发布承接、URL 回填、指标录入和周报复盘中给出下一步动作与入口，补齐从当天任务到下游流程的执行视角。
59. 终稿确认页已展示执行承接判断，能从生成配置、重新生成、质检阻断、发布队列、人工发布、URL 回填、指标录入和周报复盘中给出下一步动作与入口，补齐从终稿确认到发布复盘的执行视角。
60. 博客监控页已展示处理动作与可执行入口，能从诊断、加入候选池、候选池处理、已规划回看、继续观察和周报复盘中给出下一步动作与跳转，补齐从博客诊断到候选承接的执行视角。
61. GEO 测试页已展示处理动作与可执行入口，能从模型配置、失败快照、加入候选池、候选池处理、周计划回看和周报复盘中给出下一步动作与跳转，补齐从 GEO 测试到内容补强的执行视角。
62. 发布队列页已展示处理动作与可执行入口，能从人工发布、URL 回填、指标录入、失败重导出和周报复盘中给出当前唯一优先动作，并通过浏览器 smoke 验证“标记已发布 -> 回填 URL”真实顺序。
63. 知识库页已展示处理动作与可执行入口，能从启用、补调用范围、确认可信度、补同步记录、竞品对比调用和内容生成调用中给出下一跳，同时保留编辑/停用维护入口。
64. AI 配置页已展示处理动作、可执行入口和独立诊断入口，能把补环境变量、执行诊断、排查失败、本地 fallback 和真实试跑承接拆开，避免配置页同时承担说明和跳转两种角色。
65. 设置页已在规则检查表中展示可执行入口，能从缺渠道、缺产品、产能过高、终稿模式风险、真实日志待配置和 GEO 平台缺失直接跳到保存设置、真实接入、GEO 测试或周计划。

2026-06-19 周计划、首页与周报闭环表达补齐后的最新验证结果：
1. 周计划页已拆分 `下一步 / 处理动作 / 可执行入口 / 维护`，计划确认、稿件生成、AI 配置排查、终稿处理、发布回填、指标录入和周报复盘都有明确入口。
2. 首页执行队列已显式展示 `当前状态 / 处理动作 / 可执行入口`，负责人可以从首页直接判断当前阻塞项和下一步跳转位置。
3. 周报复盘行动队列已统一把 `当前动作` 改为 `处理动作`，全站关键页面表达收敛为 `当前状态 -> 下一步 -> 处理动作 -> 可执行入口`。
4. `scripts/validate-structure.mjs` 和 `scripts/smoke-interactions.mjs` 已把这些字段纳入契约检查，避免后续页面退回到只展示按钮的状态。
5. 最新验证通过：`typecheck`、`validate:structure 238/238 passed`、`smoke:interactions 64/64 passed`、`lint`、`smoke:pages 17/17 passed`。

2026-06-19 AI 配置与真实接入自动化闭环收口后的最新验证结果：
1. AI 配置页已把三张表的 `当前动作` 统一为 `下一步`，并在顶部提示当前最高优先级能力，避免用户只看到配置清单却不知道先处理哪一项。
2. 真实接入页的 `自动化与模板` 已从静态状态表升级为 `状态 / 下一步 / 处理动作 / 可执行入口`，覆盖手动 Pipeline、本地 Worker、定时任务和渠道模板确认。
3. `scripts/validate-structure.mjs` 和 `scripts/smoke-interactions.mjs` 已把 AI 配置优先级提示、自动化模板下一步、处理动作和入口纳入契约检查。
4. 最新静态验证通过：`typecheck`、`validate:structure 238/238 passed`、`smoke:interactions 64/64 passed`、`lint`。

2026-06-19 周报建议与真实接入顺序闭环收口后的最新验证结果：
1. 周报页的 `下周建议` 已从纯文本列表升级为 `建议 / 下一步 / 处理动作 / 可执行入口`，未生成周报时会先引导生成周报，已生成周报时会把建议复核和下周计划草稿承接拆开。
2. 真实接入页的 `接入顺序` 已从静态说明升级为动态闭环表，按本地 JSON、MySQL、AI Provider、博客/日志源和自动化模板五段展示当前状态、证据、下一步和入口。
3. `scripts/validate-structure.mjs` 和 `scripts/smoke-interactions.mjs` 已新增这两处闭环契约，避免页面回退成“只解释、不承接”的展示。

2026-06-19 首页总控闭环收口后的最新验证结果：
1. 首页 `执行队列` 已从列表说明升级为 `事项 / 当前状态 / 数量 / 下一步 / 处理动作 / 可执行入口`，负责人不需要读长句也能判断先处理周计划、稿件、发布、博客、GEO 还是周报。
2. 首页 `官网博客与 GEO 概览` 已从指标展示升级为闭环表，能把博客候选、GEO 缺口、AI Bot 日志可信度和 GEO 命中率分别导向博客监控、GEO 测试、日志导入或周报。
3. 首页 `Pipeline 运行记录` 已补 `下一步 / 处理动作 / 可执行入口`，成功记录进入周报，部分完成或失败记录回到真实接入页排查。

2026-06-19 生产模式运行态闭环修复后的最新验证结果：
1. 知识库页已补稳定排序，新增知识库会按最近同步时间和创建时间优先展示，保存后可以直接在当前页看到新记录。
2. `GET /api/workbench-state`、`/api/dashboard/summary`、`/api/runtime-config/status`、`/api/config-diagnostics`、`/api/knowledge-bases`、`/api/workspace-settings`、`/api/pipeline/runs/export`、`/api/weekly-reports/{week}`、`/api/weekly-reports/{week}/export` 已统一声明 `force-dynamic`，避免 `next start` 生产模式返回构建时旧快照。
3. 这次修复说明最后一段真实闭环不只是页面列补齐，还包括“保存 -> 刷新运行态 -> 页面立即可见”的生产模式状态一致性。
4. 最新完整验证通过：`typecheck`、`validate:structure 251/251 passed`、`smoke:interactions 68/68 passed`、`lint`、`build`、`smoke:pages 17/17 passed`、`smoke:workflow 36/36 passed`、`smoke:browser 3/3 passed`。

## API 覆盖

当前已落地 API：

1. `GET /api/dashboard/summary`
2. `POST /api/weekly-plans/generate`
3. `PATCH /api/weekly-plans/{id}`
4. `PATCH /api/content-tasks/{id}`
5. `POST /api/content-tasks/{id}/generate`
6. `POST /api/content-tasks/{id}/regenerate-title`
7. `POST /api/content-tasks/confirm`
8. `DELETE /api/content-tasks/{id}`
9. `POST /api/content-tasks/batch-generate`
10. `PATCH /api/article-drafts/{id}`
11. `POST /api/article-drafts/{id}/approve`
12. `POST /api/publish-records`
13. `PATCH /api/publish-records/{id}/published`
14. `PATCH /api/publish-records/{id}/url`
15. `PATCH /api/publish-records/{id}/metrics`
16. `POST /api/publish-records/export`
17. `POST /api/blog-articles/sync`
18. `POST/PATCH/DELETE /api/blog-articles/{id}/candidate`
19. `POST /api/blog-articles/{id}/candidate/task`
20. `POST /api/blog-articles/{id}/diagnose`
21. `POST /api/geo-tests/run`
22. `PATCH /api/geo-test-results/{id}/override`
23. `POST /api/geo-test-results/{id}/candidate`
24. `POST /api/log-imports`
25. `GET /api/bot-visit-summary`
26. `GET /api/weekly-reports/{week}`
27. `GET /api/weekly-reports/{week}/export`
28. `POST /api/weekly-reports/{week}/next-plan`
29. `GET /api/workbench-state`
30. `GET /api/runtime-config/status`
31. `POST /api/channel-metrics/import`
32. `POST /api/pipeline/run`
33. `GET /api/pipeline/runs/export`
34. `GET/PATCH /api/workspace-settings`
35. `GET/POST /api/config-diagnostics`
36. `GET/POST /api/knowledge-bases`
37. `PATCH /api/knowledge-bases/{id}`
38. `smoke:workflow`
39. `smoke:pages`
40. `smoke:interactions`
41. `smoke:browser`

待真实接入：

1. 完整 MySQL CRUD repository。
2. 真实 AI API 配置：缺 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`DOUBAO_API_KEY` 等。
3. 真实 XCrawl 数据源配置：缺 `XCRAWL_BLOG_INDEX_URL`。
4. Nginx/CDN 日志固定路径配置：当前已支持 CSV 和 Nginx-like 文本导入。
5. 渠道平台导出模板规范化和自动导入任务。
6. 系统级定时调度部署方式，例如 Windows Task Scheduler、cron 或生产队列。
7. 页面级 smoke 已覆盖主要页面访问和只读 API，交互合约 smoke 已覆盖关键按钮的源码接线。
8. 浏览器点击级 smoke 已完成第一版，覆盖 Popconfirm、Modal 和刷新后的 DOM 状态变化；后续可继续扩展导入表单、批量选择和更多异常路径。

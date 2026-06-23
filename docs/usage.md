# JOTO GTM 内容工作台使用说明

## 1. 当前结论

当前版本按 V3 职责重排：周计划只做标题级计划预览，今日发布负责批量生成、确认发布和 URL 回填，草稿预览负责人工修改与 AI 二次质检，数据回传只负责渠道指标导入。博客监控和 GEO 测试优先展示诊断，周度复盘展示指标、图表和蒸馏词矩阵。

它还不是生产级最终版本。真实 MySQL、AI Provider、XCrawl、Nginx/CDN 日志和渠道导出模板仍需要补齐外部配置后逐项验收。

## 2. 启动本地工作台

```powershell
cd D:\GTM\工作台
npm.cmd install
npm.cmd run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

如需固定本地端口：

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3033
```

## 3. 推荐试用顺序

1. 打开首页数据看板，查看本周计划、生成、发布、URL 回填和数据回传进度。
2. 进入“知识库”，用统一导入链路查看内容预览、规则切片、Chunk 预览和自动抓取配置。
3. 进入“周计划生成预览”，设置篇数、渠道和产品，只生成标题级计划，确认后进入本周可执行池。
4. 进入“今日发布”，勾选已确认任务，统一批量生成正文。
5. 进入单篇“草稿预览”，人工修改、保存并运行 AI 二次质检，通过后复制全文到外部渠道发布。
6. 回到“今日发布”，确认已发布并回填正式 URL。
7. 进入“数据回传”，导入渠道数据表或手动补录阅读、点赞、收藏、评论、分享等指标。
8. 进入“博客监控”，先看诊断摘要、问题分布和优先动作，再看博客明细。
9. 进入“GEO 测试”，选择平台和 Prompt 组，蒸馏词默认全选；查看引用层级、问题类型和建议动作。
10. 进入“周度复盘”，生成周报，查看漏斗、渠道对比、GEO 引用层级和蒸馏词矩阵，再跳转到周计划生成预览。

## 4. 一键 Pipeline

首页的“运行 GTM Pipeline”会串联博客同步、日志导入、渠道指标导入、GEO 测试和运行记录保存。

```powershell
npm.cmd run worker:run-pipeline -- --base-url http://127.0.0.1:3000 --skip-blog --log-file-path data/demo-ai-bot-log.csv --channel-metrics-path imports/channel-metrics-smoke.csv --geo-platforms ChatGPT,DeepSeek
```

如果没有真实 AI 配置，GEO 步骤会返回 `pending_config`。这属于预期结果，表示缺配置步骤没有生成假数据。

## 5. 数据与状态

当前默认使用本地 JSON 状态：

```text
data/workbench-state.json
```

页面通过以下 API 读取运行态：

```text
GET /api/workbench-state
```

如果运行态同步失败，页面会显示“运行态数据同步失败”提示。关键判断前应先点击“重试”，确认状态已经刷新。

## 6. 配置诊断

推荐先打开“真实接入”或“AI 配置”页面运行诊断。页面只展示配置项名称、缺失字段和状态，不读取或显示密钥值。

```text
GET /api/runtime-config/status
GET /api/config-diagnostics
```

常见状态：

1. `ready`：配置存在且基础检查通过。
2. `pending_config`：缺少必要环境变量或外部路径。
3. `failed`：配置存在，但连接、读取或调用失败。

## 7. 本地验证命令

开发或修改后建议按顺序运行：

```powershell
npm.cmd run typecheck
npm.cmd run validate:structure
npm.cmd run build
```

启动本地服务后，可以继续跑 smoke：

```powershell
npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3000
npm.cmd run smoke:interactions
npm.cmd run smoke:browser -- --base-url=http://127.0.0.1:3000
npm.cmd run smoke:workflow -- --base-url=http://127.0.0.1:3000
```

说明：

1. `smoke:pages` 检查主要页面、只读 API 和周报 Markdown 导出 API 是否可访问。
2. `smoke:interactions` 检查 V3 页面职责合约，包括今日发布、数据回传、GEO 诊断、博客诊断、知识库 Chunk 和周报矩阵。
3. `smoke:browser` 使用系统 Chrome 点击周计划预览、知识库导入和今日发布 URL 回填。
4. `smoke:workflow` 会写入 `data/workbench-state.json`，用于验证本地持久化链路、知识库 Chunk、GEO 蒸馏词、周报 Markdown 和周报计划信号。

## 8. 真实接入还需要什么

1. 完整 MySQL CRUD repository，而不是只使用本地 JSON 或 state snapshot bridge。
2. 真实 AI Provider 配置，包括 OpenAI、DeepSeek、豆包的 key 和 model。
3. 真实 XCrawl 或稳定博客索引源。
4. Nginx/CDN 日志固定路径与读取权限。
5. 微信、CSDN、掘金、知乎/头条等渠道数据导出模板。
6. 系统级定时任务，例如 Windows Task Scheduler、cron 或生产队列。
7. 继续扩展浏览器点击级 smoke，覆盖导入表单、批量选择和更多异常路径。

## 9. 使用风险

1. 本地 JSON 适合单人试运行，不适合多人并发。
2. Demo、imported、real 数据要按页面标签区分，不要把 Demo 指标当作真实策略依据。
3. 缺少真实 AI 配置时，内容生成可以走本地规则 fallback，但 GEO 不会生成假命中结果。
4. 外部配置接入后，要先跑配置诊断和 smoke，再做正式内容判断。
5. 博客、日志、渠道指标导入都会写入本地状态，确认弹窗通过后才会执行。

# JOTO GTM 内容工作台使用说明

## 1. 当前结论

当前版本可以作为本地试运行 MVP 使用：周计划、今日生成、终稿确认、发布队列、博客监控、GEO 测试、周报、知识库、配置诊断和真实接入页都已经有页面入口和 API 状态流转。

它还不是生产级最终版本。真实 MySQL、AI Provider、XCrawl、Nginx/CDN 日志和渠道导出模板仍需要补齐外部配置后逐项验收。

## 2. 启动本地工作台

进入项目目录：

```powershell
cd D:\GTM\工作台
```

安装依赖：

```powershell
npm.cmd install
```

启动开发服务：

```powershell
npm.cmd run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

如需指定端口：

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3027
```

## 3. 推荐试用顺序

1. 打开首页，查看本周任务、发布、博客、GEO 和 Pipeline 运行概览。
2. 进入“工作台设置”，确认每周发布天数、每日篇数、渠道、产品、GEO 平台和日志模式。
3. 进入“周计划”，点击“生成周计划”，确认任务后进入今日生成；尚未生成稿件的任务可以删除。
4. 进入“今日任务”，批量生成或单篇生成文章。
5. 进入“内容终稿确认”，编辑正文、查看质检结果，再加入发布队列。
6. 进入“发布队列”，导出发布清单，人工发布后标记已发布并回填 URL。
7. 进入“博客监控”，导入博客源或示例文本，执行诊断并把问题文章加入候选池。
8. 进入“GEO 测试”，选择平台和 Prompt 组后运行测试；缺少模型配置时会返回 `pending_config`。
9. 进入“周度复盘”，生成周报，查看下周建议；需要交付给团队时可点击“导出 Markdown”复制周报，需要启动下一轮内容排期时可生成下周计划草稿。
10. 进入“真实接入”，逐项查看 MySQL、AI、XCrawl、日志和调度配置状态。

## 4. 一键 Pipeline

首页的“运行 GTM Pipeline”会串联博客同步、日志导入、渠道指标导入、GEO 测试和运行记录保存。

本地也可以用 Worker 运行：

```powershell
npm.cmd run worker:run-pipeline -- --base-url http://127.0.0.1:3000 --skip-blog --log-file-path data/demo-ai-bot-log.csv --channel-metrics-path imports/channel-metrics-smoke.csv --geo-platforms ChatGPT,DeepSeek
```

如果没有真实 AI 配置，GEO 步骤会返回 `pending_config`，Pipeline 可能显示 `partial`。这属于预期结果，表示可执行步骤已经完成，缺配置步骤没有生成假数据。

## 5. 数据与状态

当前默认使用本地 JSON 状态：

```text
data/workbench-state.json
```

页面通过以下 API 读取运行态：

```text
GET /api/workbench-state
```

如果运行态同步失败，页面会显示“运行态数据同步失败”提示，并保留上一次成功加载的数据或本地兜底数据。关键判断前应先点击“重试”，确认状态已经刷新。

## 6. 配置诊断

推荐先打开“真实接入”或“AI 配置”页面运行诊断。页面只展示配置项名称、缺失字段和状态，不读取或显示密钥值。

也可以直接访问：

```text
GET /api/runtime-config/status
GET /api/config-diagnostics
```

常见状态含义：

1. `ready`：配置存在且基础检查通过。
2. `pending_config`：缺少必要环境变量或外部路径。
3. `failed`：配置存在，但连接、读取或调用失败。

## 7. 本地验证命令

开发或修改后建议按顺序运行：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run validate:structure
npm.cmd run build
```

启动本地服务后，可以继续跑页面和工作流 smoke：

```powershell
npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3000
npm.cmd run smoke:interactions
npm.cmd run smoke:browser -- --base-url=http://127.0.0.1:3000
npm.cmd run smoke:workflow -- --base-url=http://127.0.0.1:3000
```

说明：

1. `smoke:pages` 检查主要页面、只读 API 和周报 Markdown 导出 API 是否可访问。
2. `smoke:interactions` 检查关键按钮的 API、确认弹窗、loading、反馈、配置失败提示、任务确认/删除、周报导出、下周计划草稿生成和刷新合约。
3. `smoke:browser` 使用系统 Chrome 真实点击页面，当前覆盖周计划 Popconfirm、知识库新增 Modal 和发布 URL 回填 Modal，并验证保存后的 DOM 刷新。
4. `smoke:workflow` 会写入 `data/workbench-state.json`，这是为了验证本地持久化链路，并会检查周报 Markdown 是否可导出、周报建议是否可生成下周计划草稿。

## 8. 真实接入还需要什么

下一阶段要补齐：

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

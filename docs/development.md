# 开发说明

## 1. 技术路径

| 类型 | 当前选择 |
|---|---|
| 前端 | React / Next.js |
| 组件库 | Ant Design |
| 后端短期 | Next.js API Routes + Node Worker |
| 数据库 | 当前本地 JSON 状态；后续切 MySQL |
| 日志方案 | CSV / Nginx-like access log 文本导入，后续接固定 Nginx/CDN 文件路径 |

## 2. 本地启动

```powershell
cd D:\GTM\工作台
npm install
npm run dev
```

如果 PowerShell 拦截 `npm.ps1`，使用：

```powershell
npm.cmd install
npm.cmd run dev
```

默认本地地址：

```text
http://127.0.0.1:3000
```

## 3. 结构验证

在依赖尚未安装或网络不可用时，可以先运行结构验证，确认 MVP 关键骨架没有缺失：

```powershell
cd D:\GTM\工作台
npm.cmd run validate:structure
```

该命令不依赖 Next.js 编译，只检查：

1. PRD、原型、开发文档是否存在。
2. Phase 2~6 页面入口是否完整。
3. API Routes 是否完整。
4. MySQL schema 是否覆盖核心表。
5. 配置、Demo 日志、真实数据导入 adapter、API route 和 Worker 占位脚本是否存在。

## 4. 环境变量

密钥不要写入代码和文档。后续使用 `.env.local` 配置：

```text
MYSQL_HOST=
MYSQL_PORT=
MYSQL_DATABASE=
MYSQL_USER=
MYSQL_PASSWORD=

OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=

DEEPSEEK_BASE_URL=
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=

DOUBAO_BASE_URL=
DOUBAO_API_KEY=
DOUBAO_MODEL=
```

## 5. 数据库

MySQL schema 位于：

```text
database/schema.sql
```

当前运行时状态位于：

```text
data/workbench-state.json
```

该文件由 `src/lib/workbench-store.ts` 自动初始化和更新，已加入 `.gitignore`，用于本地试运行，不作为代码资产提交。

MySQL 配置完成后，可以先运行连接检查：

```powershell
npm.cmd run check:mysql
```

没有配置时该命令会返回 `pending_config` 和缺失的环境变量名，不会读取或打印密钥值。

确认连接后，可以初始化 schema：

```powershell
npm.cmd run init:mysql
```

当前 repository 选择规则：

1. 没有 MySQL 环境变量时，使用 `local_json`。
2. MySQL 环境变量齐全时，默认使用 `mysql`。
3. 可以通过 `WORKBENCH_STORAGE=local_json` 强制使用本地 JSON。

## 6. Worker

Worker 脚本位于：

```text
workers/
```

当前 Worker 已改成可执行入口，会调用本地 API：

```powershell
npm.cmd run worker:sync-blog -- --base-url http://127.0.0.1:3000
npm.cmd run worker:import-log -- --base-url http://127.0.0.1:3000 --file-path data/demo-ai-bot-log.csv --source-type demo_csv
npm.cmd run worker:import-channel-metrics -- --base-url http://127.0.0.1:3000 --file-path imports/channel-metrics.csv
npm.cmd run worker:run-pipeline -- --base-url http://127.0.0.1:3000 --log-file-path data/demo-ai-bot-log.csv
npm.cmd run worker:run-pipeline -- --base-url http://127.0.0.1:3000 --skip-blog --log-file-path data/demo-ai-bot-log.csv --channel-metrics-path imports/channel-metrics-smoke.csv
npm.cmd run worker:schedule-pipeline -- --base-url http://127.0.0.1:3000 --interval-seconds 3600 --repeat --max-runs 24
npm.cmd run smoke:workflow -- --base-url http://127.0.0.1:3000
```

当前真实数据导入可通过 API route 或 Worker 执行，后续定时任务只需要按同一输入协议调用：

1. `POST /api/blog-articles/sync`：支持 `articles`、`sourceUrl`、JSON、CSV、sitemap XML、允许目录内的 `sourcePath`。
2. `POST /api/log-imports`：支持 CSV、Nginx-like 原始日志文本、允许目录内的日志文件路径。
3. `POST /api/channel-metrics/import`：支持渠道数据 CSV，按 `publishRecordId`、`recordId`、`draftId`、`publishedUrl` 或 `title` 匹配发布记录。
4. `PATCH /api/content-tasks/{id}`：支持页面编辑任务标题、日期、渠道、产品、内容类型和关键词。
5. `POST /api/content-tasks/{id}/regenerate-title`：支持月度计划页重生成单条选题标题。
6. `PATCH /api/publish-records/{id}/published`：支持发布页标记人工发布完成。
7. `POST /api/blog-articles/{id}/candidate`：支持博客监控页将主题加入候选池。
8. `POST /api/pipeline/run`：支持页面一键运行博客同步、日志导入、渠道指标导入和月度复盘读取，并保存运行记录。
9. `GET /api/pipeline/runs/export`：支持导出 Pipeline 运行记录 CSV。
10. `workers/` 目录中的脚本现在可以直接调用上述 API，后续只需要把真实源头接到同一输入协议上。
11. `worker:run-pipeline` 可以串联同步、导入和月度复盘读取，适合作为命令行入口。
12. `worker:schedule-pipeline` 可按固定间隔重复调用页面同款 Pipeline API，默认只执行一次，传 `--repeat` 后循环。
13. `smoke:workflow` 可按同一套输入协议自动验证首页、任务、稿件、发布、博客和 Pipeline 的主链路。
14. `GET /api/runtime-config/status` 和 AI 配置页可展示真实能力状态、缺失环境变量和 `.env.local` 模板。
15. `GET/PATCH /api/workspace-settings` 和设置页可保存默认发布规则、产品范围和日志模式。
16. `GET/POST /api/config-diagnostics` 可执行配置诊断，返回 ready、pending_config 或 failed，不返回密钥值。

文件路径导入默认只允许项目内 `data/`、`imports/`，以及 `IMPORT_ALLOWED_ROOT`、`NGINX_ACCESS_LOG_PATH`、`CDN_LOG_EXPORT_PATH` 显式配置的目录，避免接口读取任意本地文件。

## 7. 当前实现状态

已完成：

1. Phase 0 资产审计与配置清单。
2. Next.js / React / Ant Design 工程骨架。
3. MySQL schema。
4. Phase 2~6 页面骨架和本地持久化数据流。
5. API Routes 已支持本地 JSON repository 读写。
6. Worker 可执行脚本。
7. 结构验证脚本已覆盖页面接线和 pipeline API。
8. PRD 文档路径已统一为 `docs/MVP-PRD1.md` 和 `docs/MVP-PRD2.md`。
9. `GET /api/workbench-state` 可为页面提供运行时状态。
10. 博客同步、Bot 日志导入和渠道数据导入已从 Demo 逻辑拆成 adapter，并接入 API 和本地持久化状态。
11. Worker 脚本已从占位改成真实任务入口，能直接调用本地 API。
12. 已新增本地 pipeline Worker，可顺序执行真实数据导入和月度复盘读取。
13. Phase 7-C 主要页面操作已接 API：月度计划编辑/重生成、今日生成、终稿保存/重生成/入队、发布标记/URL 回填、博客诊断/入候选池。
14. 首页已新增一键运行 GTM Pipeline，可保存最近 20 次运行记录。
15. 首页已支持导出 Pipeline 运行记录 CSV，本地 Worker 已支持定时调用 Pipeline。
16. 新增 `smoke:workflow`，可用于后续接真实 MySQL、AI、XCrawl、日志源前后做自动回归。
17. AI 配置页已显示 ready / pending_config 状态和配置占位模板；设置页已从静态表单改为本地持久化设置。
18. AI 配置页已新增测试入口和真实接入 Checklist，便于后续逐项补真实配置。

待接入：

1. MySQL 环境配置和 schema 初始化。
2. 真实 AI Provider 配置。
3. 真实 XCrawl 数据源配置与定时任务。
4. Nginx/CDN 日志文件路径配置和定时导入任务。
5. 渠道平台导出文件的固定字段模板和自动导入任务。

## 8. 已通过验证

```powershell
npm.cmd run validate:structure
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

当前结果：

1. 结构验证：以 `npm.cmd run validate:structure` 输出为准。
2. TypeScript：通过。
3. ESLint：通过。
4. Next.js build：通过。
5. 本地 dev server：首页、`/today`、`/blog-monitor`、`/api/dashboard/summary`、`/api/workbench-state` 可访问。
6. API 试跑：月度计划生成、批量生成、终稿确认、URL 回填均可写入 `data/workbench-state.json`。
7. Pipeline smoke：`worker:run-pipeline` 已验证日志导入和渠道数据导入成功；缺少 GEO 模型配置时返回 `partial` + `pending_config`，不阻断其他步骤。
8. 页面 Pipeline：`POST /api/pipeline/run` 可写入 `pipelineRuns`，首页可展示运行记录。

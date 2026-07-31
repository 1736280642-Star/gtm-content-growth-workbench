# Workers

## V5 automatic content production

`npm.cmd run worker:v5-content-production` claims `ready_for_generation` tasks in the background. It performs retrieval, freezes a new EvidencePack, generates the article, removes unsupported factual passages, and stores only drafts that pass the hard fact gate. The business UI has no generation button.

The worker fails closed when MySQL, the active RAG snapshot, Embedding, or the formal article provider is not configured.

## V5 automatic knowledge refresh

Run these workers from the deployment scheduler. No business-page action is required:

```powershell
npm.cmd run worker:v5-rag:source-import -- --write
npm.cmd run worker:v5-rag:knowledge-refresh
npm.cmd run worker:v5-rag:index
npm.cmd run worker:v5-knowledge-collection
npm.cmd run worker:v5-content-production
```

`worker:v5-knowledge-collection` scans due imported sources and automatically completes article discovery, body extraction, entity classification, knowledge-base routing, archival and managed RAG ingestion. Use `--repeat --interval-seconds=900` for resident scheduling, `--source=<sourceId> --force` for an operations-only rerun. Business pages do not require a daily action.

The refresh worker freezes the latest governed SourceSnapshot, activates the automatic rule package and monthly readiness, creates an approved Manifest, and queues an immutable index. The index worker uses the configured Embedding and OpenSearch services, replays approved and blocked Claims, activates the alias only when all hard metrics pass, then releases affected tasks to `ready_for_generation`.

Missing infrastructure stays `pending_config` and is retried without consuming the failure-attempt budget.

MVP 阶段使用 Node Worker 脚本承接耗时任务。

当前 Worker 已不再只是占位输出，会直接调用本地 API。启动应用后，可以通过 `WORKBENCH_BASE_URL` 或 `--base-url` 指向工作台服务。

```powershell
npm.cmd run worker:sync-blog -- --base-url http://127.0.0.1:3000
npm.cmd run worker:import-log -- --base-url http://127.0.0.1:3000 --file-path data/demo-ai-bot-log.csv --source-type demo_csv
npm.cmd run worker:import-channel-metrics -- --base-url http://127.0.0.1:3000 --file-path imports/channel-metrics.csv
npm.cmd run worker:run-pipeline -- --base-url http://127.0.0.1:3000 --log-file-path data/demo-ai-bot-log.csv
npm.cmd run worker:run-pipeline -- --base-url http://127.0.0.1:3000 --skip-blog --log-file-path data/demo-ai-bot-log.csv --channel-metrics-path imports/channel-metrics-smoke.csv
npm.cmd run worker:schedule-pipeline -- --base-url http://127.0.0.1:3000 --interval-seconds 3600 --repeat --max-runs 24
npm.cmd run worker:direct-publish -- --base-url http://127.0.0.1:3000 --interval-seconds 30
```

脚本职责：

1. `sync-blog.mjs`: 调用 `/api/blog-articles/sync`，支持 `sourceUrl`、`sourcePath`、`csv`、`json`、`text`。
2. `import-demo-log.mjs`: 调用 `/api/log-imports`，支持 `sourceType`、`filePath`、`sourcePath`、`csv`、`raw-log`。
3. `import-channel-metrics.mjs`: 调用 `/api/channel-metrics/import`，支持 `filePath`、`sourcePath`、`csv`。
4. `run-pipeline.mjs`: 串联博客同步、日志导入、渠道数据导入和月度复盘读取，支持 `skip-*` 参数跳过外部依赖步骤。
5. `schedule-pipeline.mjs`: 按固定间隔重复调用 `/api/pipeline/run`，默认只执行一次；传 `--repeat` 才会循环。
6. `direct-publish-worker.mjs`: 常驻扫描到期 `PublishSchedule`，先验证 `pending_verify`，再领取 `scheduledAt` 已到期的任务。默认每 30 秒运行一次；使用 `--once` 可执行单轮检查。页面无需人工点击，失败只记录明确状态，不会把编辑器草稿误报为已发布。

当外部模型配置缺失时，pipeline 会返回 `partial`，并把对应步骤标记为 `pending_config`；这表示配置依赖尚未满足，不代表日志或渠道导入失败。

# Workers

MVP 阶段使用 Node Worker 脚本承接耗时任务。

当前 Worker 已不再只是占位输出，会直接调用本地 API。启动应用后，可以通过 `WORKBENCH_BASE_URL` 或 `--base-url` 指向工作台服务。

```powershell
npm.cmd run worker:sync-blog -- --base-url http://127.0.0.1:3000
npm.cmd run worker:import-log -- --base-url http://127.0.0.1:3000 --file-path data/demo-ai-bot-log.csv --source-type demo_csv
npm.cmd run worker:import-channel-metrics -- --base-url http://127.0.0.1:3000 --file-path imports/channel-metrics.csv
npm.cmd run worker:run-pipeline -- --base-url http://127.0.0.1:3000 --log-file-path data/demo-ai-bot-log.csv
npm.cmd run worker:run-pipeline -- --base-url http://127.0.0.1:3000 --skip-blog --log-file-path data/demo-ai-bot-log.csv --channel-metrics-path imports/channel-metrics-smoke.csv
npm.cmd run worker:schedule-pipeline -- --base-url http://127.0.0.1:3000 --interval-seconds 3600 --repeat --max-runs 24
```

脚本职责：

1. `sync-blog.mjs`: 调用 `/api/blog-articles/sync`，支持 `sourceUrl`、`sourcePath`、`csv`、`json`、`text`。
2. `import-demo-log.mjs`: 调用 `/api/log-imports`，支持 `sourceType`、`filePath`、`sourcePath`、`csv`、`raw-log`。
3. `import-channel-metrics.mjs`: 调用 `/api/channel-metrics/import`，支持 `filePath`、`sourcePath`、`csv`。
4. `run-pipeline.mjs`: 串联博客同步、日志导入、渠道数据导入和月度复盘读取，支持 `skip-*` 参数跳过外部依赖步骤。
5. `schedule-pipeline.mjs`: 按固定间隔重复调用 `/api/pipeline/run`，默认只执行一次；传 `--repeat` 才会循环。

当外部数据源缺失时，pipeline 会返回 `partial`，并标记对应步骤；这表示依赖尚未满足，不代表其他导入步骤失败。

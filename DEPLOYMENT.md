# JOTO GTM Workbench 本地生产发行版

## 结论

`full` profile 将 Next.js production、MySQL、OpenSearch、知识/RAG/正文/发布 Worker 作为可恢复的常驻服务运行；宿主机浏览器扩展继续持有平台登录态。`core` profile 仅用于低资源体验，不启用正式 RAG 与后台生产链路。

## 首次启动

1. 安装 Docker Desktop，Windows 建议为 Docker 分配至少 6 GB 内存；macOS/Linux 建议 6–8 GB。OpenSearch 默认使用 1 GB JVM heap。
2. 复制 `.env.example` 为 `.env`，替换两个 MySQL 占位密码。运行 `full` 时还必须配置 `DASHSCOPE_API_KEY`。
3. 启动：

```powershell
docker compose --profile full up -d --build
docker compose --profile full ps
```

快速体验：先将 `.env` 中 `DEPLOYMENT_PROFILE` 改为 `core`，再运行：

```powershell
docker compose --profile core up -d --build
```

Web 默认访问 `http://127.0.0.1:3027`。综合状态位于 `/api/health` 和 `/operations`；`/api/health?deep=true` 会产生一次真实 Embedding 请求，只用于验收，不用于高频容器健康检查。

## 服务职责

| 服务 | 职责 | 持久化/恢复 |
|---|---|---|
| `workbench-web` | Next.js standalone production | `unless-stopped`，Web 健康检查 |
| `mysql` | 状态、治理、租约、任务队列 | `mysql_data` |
| `opensearch` | 关键词与向量检索、激活别名 | `opensearch_data`，单节点副本为 0 |
| `rag-index-worker` | 构建、评测、激活新索引 | 租约、幂等键、最多尝试次数 |
| `knowledge-worker` | Source Import、Claim/Refresh、Collection | 心跳及子任务失败状态 |
| `content-worker` | EvidencePack 准入后的正文任务 | 失败保持 `pending_config/failed` |
| `publish-worker` | 到期领取、租约、重试、状态回写 | 浏览器动作交给 Windows Bridge |

Worker supervisor 每 10 秒写入共享心跳，业务失败不会伪装成进程崩溃；连续进程异常会退避重启。容器日志默认每文件 10 MB、保留 5 个文件。

## 日常操作

```powershell
docker compose --profile full logs -f --tail 200 workbench-web rag-index-worker knowledge-worker content-worker publish-worker
docker compose --profile full restart workbench-web
docker compose --profile full down
docker compose --profile full pull
docker compose --profile full up -d --build
```

`down` 不删除命名 Volume。不要运行 `docker compose down -v`，除非明确要永久删除数据库、索引和工作台状态。

## 备份与恢复

备份会生成 `backups/<timestamp>/mysql.sql`、OpenSearch filesystem snapshot 和不含密钥的 metadata：

```powershell
node scripts/deployment-backup.mjs
```

恢复会替换 MySQL 表和 `v5-rag-*` 索引，先停写并再次做备份：

```powershell
docker compose --profile full stop rag-index-worker knowledge-worker content-worker publish-worker
node scripts/deployment-restore.mjs --from backups/<timestamp> --confirm-replace
docker compose --profile full start rag-index-worker knowledge-worker content-worker publish-worker
```

## 上线验收

1. `docker compose --profile full ps` 中所有常驻服务为 `healthy`。
2. `/api/health?deep=true` 的 MySQL、OpenSearch、Embedding、Workers 均为 `ready`。
3. `activeAliases` 指向新索引，旧索引仍存在且未被原地覆盖。
4. 运行 RAG 验收测试，确认关键词、向量、EvidencePack 都来自当前激活索引。
5. 故意撤掉 Provider 配置时，任务停在 `pending_config/failed`，不得生成无证据正文。
6. 浏览器发布采用真实模式前，先以 `DIRECT_PUBLISH_MOCK=true` 完成全链路演练。

## 原理、用户影响与简化方案

- production build 消除实时编译；standalone 与多阶段镜像减小 Web 运行时。用户影响是首次镜像构建较慢，后续访问与重启稳定得多。
- 月度工作区默认返回 compact projection，正文仅在打开预览时读取。用户影响是列表首屏更轻，首次打开正文会多一次小请求。
- `core` 是低成本替代方案，但没有 RAG、EvidencePack、正文生产与自动发布能力；需要真实生产链路时必须使用 `full`。

# JOTO GTM Workbench 本地生产发行版

## 结论

`full` profile 将 Next.js production、MySQL、OpenSearch、知识/RAG/正文/发布 Worker 作为可恢复的常驻服务运行；宿主机浏览器扩展继续持有平台登录态。`core` profile 仅用于低资源体验，不启用正式 RAG 与后台生产链路。

## 首次启动

Windows 本机推荐使用生产初始化脚本。它将内部基础设施复杂度封装在工作台内：

- 检查 Node.js、Docker、主机内存和剩余磁盘；
- 首次启动时从 `.env.example` 创建 `.env`；
- 使用系统加密随机数生成器创建 MySQL 用户密码和 root 密码，全程不回显；
- 已存在 MySQL Volume 但凭证文件丢失时拒绝自动换密，防止现有数据失联；
- 启动 `full` Profile 并等待 MySQL、OpenSearch、真实 Embedding 和全部 Worker 通过深度健康检查；
- 保留 `.env`、`.env.local` 在 Git 忽略范围内，不提交任何真实凭证。

资源基线为至少 8 GB 内存和 20 GB 可用磁盘，推荐 12 GB 内存和 50 GB 可用磁盘。OpenSearch 默认使用 1 GB JVM heap。资料规模扩大后主要增长的是磁盘、索引和备份体积，不应让正文常驻 Web 进程内存。

```powershell
# 只检查，不改配置、不启动
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-full-production.ps1 -CheckOnly

# 首次完整初始化；只要求安全输入 DASHSCOPE_API_KEY
.\setup-full-production.cmd
```

不可自动推断的 Provider 密钥会写入本机 `.env.local`，不会打印。MySQL 主机、端口、数据库、用户和随机密码由脚本及 Compose 管理，不再要求用户逐项填写。

自动化环境如果暂时只准备基础设施，可显式运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-full-production.ps1 -AllowPendingProvider -NoOpen
```

此时 MySQL 和 OpenSearch 可以运行，但系统保持 `pending_config`，不得视为完整生产就绪。补齐 Provider 后重新运行初始化脚本，必须通过 `/api/health?deep=true`。

如需手动启动，仍可执行：

```powershell
Copy-Item .env.example .env
# 手动替换两个数据库占位密码，并在 .env.local 配置 DASHSCOPE_API_KEY
docker compose --profile full up -d --build
docker compose --profile full ps
```

快速体验：先将 `.env` 中 `DEPLOYMENT_PROFILE` 改为 `core`，再运行：

```powershell
docker compose --profile core up -d --build
```

Web 默认访问 `http://127.0.0.1:3027`。综合状态位于 `/api/health` 和 `/operations`；`/api/health?deep=true` 会产生一次真实 Embedding 请求，只用于验收，不用于高频容器健康检查。

## 数据与容量策略

完整生产模式把资料分成三层，避免“资料越多，所有内容都常驻内存”的误解和实现：

| 层级 | 内容 | 生产行为 |
|---|---|---|
| 热数据 | 当前产品事实、有效限制、近期批准资料 | 保持在 active Snapshot，可进入 EvidencePack |
| 温数据 | 历史文章、订阅资料、研究背景 | 保留原文，按产品、权威和生命周期过滤后检索 |
| 冷数据 | 过期修订、重复文件、审计原件 | 保留追溯，不进入 active 索引，需要时重新治理 |

原始文件以内容 Hash 去重；SourceRevision 保留历史；只有 approved Manifest 能进入生产索引。旧版本退出 active alias 后仍可审计和回滚。容量治理应优先归档旧索引和重复原件，不直接删除仍被 EvidencePack 引用的修订。

复杂 PDF、扫描件、PPT 或表格解析能力通过解析适配层扩展。即使未来增加 RAGFlow 等解析服务，其输出仍要回到当前 SourceRevision、Claim、Manifest 和 EvidencePack 链路，不得成为第二套知识真源。

容量报告是只读操作，不加载或打印数据库与 Provider 凭证：

```powershell
node scripts/knowledge-capacity-report.mjs
```

报告覆盖 MySQL、OpenSearch、`/app/data`、`/app/artifacts` 和 `v5-rag-*` 索引。默认总占用达到 20 GB 时给出归档提醒；可以通过进程级 `WORKBENCH_CAPACITY_WARNING_BYTES` 调整提醒阈值，但清理和删除必须由人工确认后单独执行。

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

## GEO 托管邮件配置

正式托管邮件依赖公网工作台地址、链接签名密钥、邮件投递接口和接口 Bearer Token。Docker 3027 部署把真实值保存在被 Git 忽略的 `.env`，公开模板只保留以下占位字段：

```dotenv
HOSTED_PUBLIC_BASE_URL=https://workbench.example.com
HOSTED_REVIEW_LINK_SECRET=<本机生成>
HOSTED_EMAIL_DELIVERY_URL=https://mail-relay.example.com/send
HOSTED_EMAIL_DELIVERY_TOKEN=<邮件接口提供或本机生成>
```

补齐后运行：

```powershell
npm.cmd run docker:3027:deploy -- -NoOpen
```

上线验收不能只检查容器健康，还必须验证邮件接口真实接受请求、Outbox 进入 `sent`、确认链接可以从外部网络打开，以及相同幂等键不会重复发送。字段来源、生成命令、HTTP 契约、安全轮换和无泄密检查见 [`docs/方案与规划/2026-08-20-GEO托管邮件与安全链接配置指南.md`](./docs/方案与规划/2026-08-20-GEO托管邮件与安全链接配置指南.md)。

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

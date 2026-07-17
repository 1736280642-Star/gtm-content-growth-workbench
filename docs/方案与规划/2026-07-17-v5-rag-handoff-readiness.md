# V5 RAG 单产品交接就绪报告

日期：2026-07-17

范围：Pharaoh Command 单产品交接就绪的代码收口

最终状态：`pending_config`

## 1. 结论

当前 RAG 代码已形成可验证、可提交、可供后续 V4/V5 单篇正文链路集成的稳定版本。Source Import 和 Index Build 的 Service、Repository、Worker 已完成；Source Import 默认只执行 dry-run，只有显式传入 `--write` 才进入真实写入路径；Pharaoh Command 可通过 `--product=pharaoh-command` 单独限定导入范围。

本轮没有执行 MySQL、OpenSearch、Embedding、人工审批、Manifest 批准或 Snapshot 激活，也没有伪造对应结果。由于外部基础设施和写入身份配置缺失，当前真实运行条件不成立，状态必须保持为 `pending_config`。

## 2. 已完成模块

- Source Import Service：固定来源分类、规范化、计划哈希、`review_required` / `isolated` 边界、跳过聚合副本。
- Source Import Repository：事务写入、知识库和产品绑定校验、Source/Revision 幂等复用、审计与幂等记录。
- Source Import Worker：项目环境加载、默认 dry-run、显式 `--write` 写保护、单产品 `--product=pharaoh-command` 范围、缺失配置只输出变量名。
- Index Build Service：Manifest 和 Snapshot 校验、Claim-aware Chunk、真实 Embedding、OpenSearch bulk、质量门和批次参数保护。
- Index Build Repository：构建上下文读取、Chunk/Embedding 持久化、SQL 参数修复、状态更新影响行数校验。
- Index Worker：项目环境加载、Job 租约、`pending_config` 释放与状态回写、失败收口，不输出配置值或密钥。
- Index Snapshot 生命周期：状态机、激活、回滚、同分区校验、历史评测校验和并发 active Snapshot 锁定。
- API：Manifest、Index Snapshot、检索、Evidence Preview、Final EvidencePack 及 rollback route；生产环境写接口在可信服务端身份接入前 fail-closed。
- 数据库迁移：`20260716_009_v5_real_rag.sql` 已包含 RAG 表结构，并为 `final_evidence_pack` 增加自包含兼容基表，避免本次 RAG commit 强依赖未提交的 Prompt Generation 迁移。

## 3. 实现逻辑与影响

核心逻辑是“来源导入不等于生产准入，索引构建不等于自动激活”。导入后的生产候选仍为 `review_required`，非生产材料保持 `isolated`；只有人工批准的 Manifest 才能构建生产索引，只有通过评测并人工执行的 Snapshot 才能激活。

底层原因是产品事实、权限、隐私和历史版本不能由 Worker 自动裁决。对后续使用者的影响是：可以安全地先做单产品 dry-run 和治理写入，不会因为脚本执行成功就误认为已经具备正式检索或正文生成条件。

## 4. 测试与验证结果

| 验证项 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run test:v5-rag` | 通过，18/18 |
| 确定性 Chunk ID | 通过；同一不可变 Snapshot 稳定，不同 Snapshot 不复用 ID |
| rollback route / 状态机 / fail-closed | 通过；包含显式 route、人工约束、分区约束、评测约束、生产写禁用和 SQL 并发保护 |
| `npm.cmd run validate:structure` | 通过，257/257 |
| `npm.cmd run build` | 通过；仅存在本轮范围外的既有 React Hook warning |
| Source Import 全量 dry-run | 通过；未写入 |
| Source Import Pharaoh Command dry-run | 通过；未写入 |
| Index Worker | 正确返回 `pending_config`，未创建或激活 Snapshot |

## 5. 来源数量

全量固定来源 dry-run：

- 发现：1657
- 可写候选：1649
- `review_required`：625
- `isolated`：1024
- 跳过：8
- SourceRevision 候选：635

Pharaoh Command 单产品 dry-run：

- 发现来源：77
- 可写来源：75
- 生产候选：11
- 治理预览：3
- 审计资产：61
- 跳过聚合/排除文本：2
- SourceRevision 候选：17

## 6. 当前缺失配置

MySQL：

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

OpenSearch：

- `OPENSEARCH_URL`
- `OPENSEARCH_USERNAME`
- `OPENSEARCH_PASSWORD`

Embedding：

- `RAG_EMBEDDING_PROVIDER`
- 使用 Qwen 时：`DASHSCOPE_API_KEY`、`QWEN_EMBEDDING_MODEL`
- 使用 Doubao 时：`DOUBAO_API_KEY`、`DOUBAO_EMBEDDING_MODEL`

Source Import 真实写入身份：

- `RAG_IMPORT_ACTOR_ID`
- `RAG_IMPORT_ACTOR_ROLE`
- `RAG_IMPORT_AUDIT_REASON`

来源根目录可选覆盖：

- `RAG_SOURCE_ROOT_PHARAOH_COMMAND`
- `RAG_SOURCE_ROOT_NOTEFLOW`
- `RAG_SOURCE_ROOT_WEIKE_GUARDRAIL`
- `RAG_SOURCE_ROOT_PHARAOH_WECHAT`

以上只记录变量名称，没有读取、打印或写入任何配置值和密钥。

## 7. 真实写入与治理状态

| 项目 | 当前结论 |
| --- | --- |
| 是否具备 Source Import 真实写入条件 | 否，`pending_config`；MySQL、写入身份和数据库内人工确认关系尚未验证 |
| 是否具备 Index Build 真实运行条件 | 否，`pending_config`；MySQL、OpenSearch、真实 Embedding 尚未配置 |
| 是否已有 approved Manifest | 未验证，不得视为已有；MySQL 当前不可用，本轮未伪造或创建 |
| 是否已有 active Snapshot | 未验证，不得视为已有；本轮未构建、评测或激活 |
| 是否可供正式正文生成 | 否；必须先得到 approved Manifest、通过评测的 active Snapshot 和冻结 Final EvidencePack |

## 8. 下一轮命令

先补齐外部配置并确认只使用真实凭证，不在终端或报告中打印值：

```powershell
npm.cmd run check:mysql
npm.cmd run init:mysql
npm.cmd run worker:v5-rag:source-import -- --product=pharaoh-command
```

确认 dry-run 数量和治理关系无误后，由人工治理角色显式执行真实写入：

```powershell
npm.cmd run worker:v5-rag:source-import -- --product=pharaoh-command --write
```

完成 SourceRevision / ProductClaim 人工治理并创建 approved Manifest 后，再执行索引 Job：

```powershell
npm.cmd run worker:v5-rag:index
```

索引构建完成后仍需执行真实评测、人工激活，并确认 active Snapshot，才能进入单篇正文集成验证。本轮到此停止，不进入三产品完整上线。

## 9. 已知风险

- 未连接真实 MySQL，迁移和 SQL 只完成类型、结构与静态/运行时边界验证，尚未做真实数据库执行验证。
- 未连接 OpenSearch 和 Embedding Provider，未产生真实向量、Chunk 索引或检索结果。
- `build` 中 `today` 和 `weekly-plan` 的 React Hook warning 为既有范围外问题，本轮未修改对应页面。
- 原始完整 RAG goal 尚未完成；本报告只代表单产品代码交接就绪。

# Phase 2E Graph Shadow 可靠性开发成果与验收报告

## 2026-08-13 策略版本检查点回归（当前有效）

真实 WorkBuddy 回归发现：产品资料快照未变化、但人工纠正产品身份后重新编译了策略包时，旧线程键只包含 `productId + sourceSnapshotHash + researchPolicyVersion`，会复用仍指向旧策略包的 Graph checkpoint。这不会绕过人工审批，但会让 Graph 的只读审计结果落后于策略页当前版本。

现已将当前待审 `strategyPackId` 的 SHA-256 短指纹纳入领域 Shadow 身份版本，线程键仍不超过数据库字段长度；每次正式策略重新编译后，还会尽力创建对应的新 Shadow workflow。Graph 创建失败不会反向阻断正式策略编译，保持旁路边界。

Docker 真实回归结果：

- workflow：`geo-graph-643f75f26b4a785dc10d3e5aa6f14210c3e14438316f219b`；
- 当前策略包：`strategy-pack-040ef06a836a22ee2f7fdac1b3e64af35ab301a70883d89d`（V8）；
- 状态：`awaiting_strategy_review`，没有代替用户确认；
- 节点：`source_snapshot → research → compile_strategy`，3 个节点事件、0 个失败；
- 引用：18 个真实 Provider run，EvidencePack 为 `research-evidence-31d3a7e085b4d84ea977e388f66d9585e4b32d33ad27cdea23dab722a85b646c`；
- 检查点身份：`geo-research.v2+domain-shadow.v3+s:59d4091f6507e5f1`，已绑定当前策略版本且满足 64 字符字段约束。

验收：Phase 2E 单元测试 7/7、MySQL 集成测试 2/2、类型检查、453/453 结构校验和 774 个维护文件的月度命名检查全部通过。真实内容质量门禁仍停在用户确认 WorkBuddy 策略，不以工程测试替代人工判断。

## 2026-08-12 WorkBuddy 真实 Shadow 复验（当前有效）

### 3027 production-like Docker 交付复验

3027 已从 Next.js 开发容器切换为 `compose.yaml` 的 production-like standalone 分发，Web 容器实际命令为 `node server.js`，Compose 标签不再包含 `compose.dev-3027.yaml`。最终镜像基于当前源码完成 65 个页面的无 Hook 警告生产构建；Web、content/knowledge/rag-index/monitor/publish 五个 Worker、MySQL 与 OpenSearch 均为 `healthy`。

- WorkBuddy 策略页返回 HTTP 200，首次复验约 514ms；策略 API 约 127ms；
- 可视页面只提供产品 GEO 策略确认和样稿验收入口，不展示 GeoBlueprint 审批或 Graph 操作；
- production-like Worker 容器内真实联网探针：豆包 12、千问 29、智谱 7 个可追溯来源，三家均成功；
- 部署前后正式策略保持 `pending_strategy_review`，Graph 保持 `awaiting_strategy_review`，证明镜像切换没有触发业务审批或绕过人工门禁；
- MySQL、OpenSearch 与工作台数据均使用原命名 Volume，切换过程没有删除持久化卷。

Graph 已从“仅测试假端口”接入真实 WorkBuddy 领域读取端口和 3027 API。真实 Shadow 读取正式来源快照、正式 GEO 调研运行、18 个 Provider run 引用、ResearchEvidencePack 和当前产品策略包；它只写 Graph checkpoint 与节点审计，不调用策略/样稿决定服务。

真实运行结果：

- execution mode：`shadow`；
- 状态：`awaiting_strategy_review`；
- 节点：`source_snapshot → research → compile_strategy` 均成功；
- 节点失败数：0；
- 工作流：`geo-graph-6f3b4dbb75b417ad541951bb0cc80173e59e104ba511654e`；
- 绑定当前 V5 策略包：`strategy-pack-43779b9291761683878b8f2bc8b86a0ca6b6f73bcde18ac7`；
- 正式策略仍为 `pending_strategy_review`，`strategyApprovedBy/At` 均为空，证明 Shadow 没有代替用户确认。

真实运行还发现并修复 Docker 开发依赖卷未安装 LangGraph 的问题。3027 容器已依据当前 `package-lock.json` 重建依赖并恢复健康，Graph API 能在容器内编译运行。新增 GET 接口返回工作流及节点事件，支持按引用、耗时、状态和错误做只读审计。

当前边界：真实 Shadow 已验证到第一个人工 interrupt；策略确认后的样稿节点必须等待用户通过正式策略页面确认，Graph 不提供审批写入口。Phase 2E 的“真实 Shadow 前半链”通过，完整双 interrupt 真实复验仍随 Phase 2D 人工样稿验收继续。

正式策略确认和正式样稿验收接口现会在自身事务成功后，尽力调用 Shadow reconciliation。该调用只读取正式决策并恢复 Graph checkpoint，不写策略或样稿审批；动态导入、异常捕获和 `degraded` 返回保证 Graph 不可用时正式链路仍然成功。样稿审计记录真实审核人，不再使用占位身份。2026-08-12 在策略未确认状态调用 reconciliation 后，Graph 仍为 `awaiting_strategy_review`，策略仍为 `pending_strategy_review`，运行时反证旁路不可用。

日期：2026-08-10  
范围：GEO 调研、策略确认、样稿确认的低频长流程；不接 AgentTeams，不接管确定性批量生产与发布热路径。

## 1. 结论

Phase 2E 的工程底座已完成并通过自动化及 MySQL 集成验收：Graph 能在策略与样稿两个人工门禁暂停，通过同一 `thread_id` 和持久化 checkpoint 在进程重建后恢复；联网调研补充循环最多两轮，节点具备 timeout、有限重试、引用级审计和乐观锁。

当前只允许 `shadow`，拒绝 `active`。WorkBuddy 三模型真实调研已经通过；尚未宣称正式切流，是因为真人策略确认和真人样稿内容验收尚未完成。Graph 不绕过这些门禁。

## 2. 实现逻辑

### 2.1 状态与责任边界

- Graph 状态只保存 `SourceSnapshot`、Provider run、EvidencePack、策略包、样稿和校准版本的引用，不复制领域正文。
- 三家搜索的并行、去重、证据核验仍由已有 GEO 领域服务负责；Graph 只负责编排和恢复。
- 策略、样稿 interrupt 节点在 `interrupt()` 前无副作用；恢复后的 apply 节点才调用幂等领域端口。
- `MonthlyPlan` 批量生成与发布继续走确定性服务，未导入 Graph。Graph 整体不可用不影响已 `production_ready` 产品。
- `claimProductGeoGraphWorkflow` 明确拒绝 `active`，正式切流必须经过后续真实 Shadow 对比门禁。

### 2.2 持久化与审计

- 新增 migration 024：工作流账本、节点事件、checkpoint、pending writes 四张表。
- 自定义 `MySqlCheckpointSaver` 实现 LangGraph `BaseCheckpointSaver`，继续使用现有 MySQL，避免引入第二套生产数据库。
- 稳定线程键由 `productId + sourceSnapshotHash + researchPolicyVersion` 生成。
- 节点事件保存输入引用、输出引用、耗时、状态和错误码；工作流状态更新使用 `row_version` 防止过期人工恢复。

## 3. 主要文件

- `src/lib/v5/graph/product-geo-workflow-contracts.ts`
- `src/lib/v5/graph/product-geo-workflow.ts`
- `src/lib/v5/graph/mysql-checkpoint-saver.ts`
- `src/lib/v5/graph/product-geo-workflow-repository.ts`
- `src/lib/v5/graph/product-geo-workflow-service.ts`
- `database/migrations/20260810_024_v5_geo_graph_workflow.sql`
- `scripts/v5-phase2e-graph-workflow.test.mjs`
- `scripts/v5-phase2e-mysql-checkpoint.integration.test.mjs`
- `scripts/v5-phase2e-shadow-ledger.integration.test.mjs`

## 4. 验收结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| 两个人工暂停/恢复 | 通过 | MemorySaver 合同测试完整走过策略与样稿 interrupt |
| 进程重启恢复 | 通过 | 三次重新创建 Graph/MySQL saver 后使用同一线程继续 |
| 不重复领域副作用 | 通过 | 策略 apply、样稿 apply 各一次；幂等键由领域端口消费 |
| 补充调研有界 | 通过 | 初始调研 + 最多两次补充，第三次不足即结束 |
| Provider 超时 | 通过 | research 节点最多尝试两次，不进入人工门禁 |
| 过期人工恢复 | 通过 | 工作流 `row_version` 不匹配返回 stale version |
| 节点可审计 | 通过 | MySQL 写入 research、generate_sample 等节点事件 |
| Graph 旁路 | 通过 | `monthly-production-service.ts` 无 Graph 依赖 |
| MCP 合同入口 | 通过 | 六个 MCP Server 启动，GEO research MCP 工具可调用适配 API |
| migration | 通过 | migration 024 已应用，累计 24 个 migration |
| 类型检查 | 通过 | `npm.cmd run typecheck` |
| 结构校验 | 通过 | 389/389 |
| 月度命名 | 通过 | 712 个维护文件扫描通过 |
| 生产构建 | 通过 | 64/64 页面；仅保留既有 `monthly-plan` useMemo 警告 |

依赖安全审计：`npm audit --omit=dev` 为 0；完整审计的 21 个 high 均来自旧 ESLint 开发依赖链，未执行破坏性的自动升级。

## 5. 底层原因与用户影响

LangGraph 会在 super-step 后保存 checkpoint；interrupt 恢复时节点可能重新执行，因此副作用必须位于恢复值验证之后并由领域幂等键保护。用户看到的仍是“确认策略”和“确认样稿”两个业务动作，不需要理解节点、checkpoint 或 AgentTeams。

实现依据：[LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)。

## 6. 未通过项与下一门禁

以下属于真实业务验收，不可用 mock 或工程测试替代：

1. 配齐豆包、千问 Web Search 后，用 WorkBuddy 产生真实三模型 EvidencePack。
2. 真人确认 WorkBuddy 产品 GEO 策略包。
3. 生成并由真人验收一篇正式生产同链路样稿，冻结校准版本。
4. 用同一输入做现有编排与 Graph Shadow 结果对比；通过后才评估正式入口。
5. Phase 2F 账号绑定和真实发布必须等待上述门禁，不自动代替用户授权或发布。

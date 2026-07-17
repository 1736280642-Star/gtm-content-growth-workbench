# V5 月度工作区后端接入说明

## 1. 接入范围

当前分支将 V5 月度内容矩阵和批量生成中心接入正式治理数据链路。未被 V5 覆盖的 V4 页面、API 与 `data/workbench-state.json` 保持不变。

当前仍不执行真实内容生成、RAG、外部平台发布或 Agent 编排。

## 2. 契约与依赖边界

正式依赖方向固定为：

```text
src/lib/v5/monthly-contracts.ts
-> 正式 Repository / Service
-> MonthlyWorkspaceReadModel
-> GET /api/v5/monthly-workspace
-> UI
```

- `src/lib/v5/monthly-contracts.ts`：正式 V5 领域 Contract 真源，只包含月度计划、生产就绪度、生产池等领域模型。
- `src/lib/v5/monthly-plan-repository.ts` 与 `src/lib/v5/monthly-plan-service.ts`：从正式 MySQL 治理池读取月度计划。
- `src/lib/v5/monthly-workspace-governance.ts`：组合正式月度计划、G6 生产就绪度和生产池。
- `src/lib/v5/monthly-workspace-read-model.ts`：把正式领域数据映射为页面所需的聚合读模型。
- `src/lib/v5/monthly-workspace-contracts.ts`：仅承载 UI/API 聚合 DTO，不是领域真源。
- `src/lib/v5/monthly-repository.ts`：工作区临时状态 adapter，不是正式领域 Repository。

UI 页面不得直接依赖正式 Repository，也不得把 UI DTO 重新放回 `monthly-contracts.ts`。

## 3. API 契约

### GET `/api/v5/monthly-workspace?month=YYYY-MM`

返回页面所需的 `MonthlyWorkspaceReadModel`，包括：

```text
plan
draftPlan
rulePackages
channels
strategyRows
batchQueueItems
exceptionItems
scheduleDraftItems
source
formal
```

其中 `formal` 明确呈现正式月度计划、G6 就绪度与生产池接入状态；响应使用 `no-store`，避免治理状态被缓存。

### PUT `/api/v5/monthly-plans/[month]`

请求头必须包含：

```text
x-idempotency-key: <8-200 characters>
```

写入前执行角色权限、月份一致性、规则包生产就绪、产品与渠道匹配、配额、乐观锁、幂等键和审计校验。

当正式治理源不可用或未完成生产准入时，服务拒绝将工作区临时数据当作正式生产依据。

## 4. Fail-closed 规则

以下任一条件缺失，统一返回或呈现 `pending_config`，且 `monthlyProductionReady` 必须为 `false`：

- 正式 MySQL 未配置或不可连接。
- 正式月度计划不存在。
- G6 生产就绪记录不存在或未通过。
- 审批人、审批时间或必要证据缺失。
- 对应记录未进入正式生产池。

禁止使用 `seed_fallback`、V4 推导数据或 UI mock 数据伪装正式生产就绪。

## 5. 数据边界

- V5 正式治理数据来自 MySQL schema migration 定义的领域表。
- 工作区临时状态仍由 `monthly-repository.ts` 管理，用于 UI 草稿、队列和排程交互。
- V4 状态只可作为未覆盖功能的原有运行数据，不得越过正式 V5 治理准入。
- 不修改 `data/workbench-state.json`，不读取或输出密钥、Token 与 `.env` 内容。


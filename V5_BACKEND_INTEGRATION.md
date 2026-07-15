# V5 月度工作区后端接入说明

## 1. 当前接入范围

首批真实数据接入覆盖：

1. 月度内容矩阵页面的计划配置、规则包、渠道和策略列表。
2. 批量生成中心的内容任务、人工排程和异常队列。
3. 月度计划的独立 V5 持久化。

未覆盖的 V4 页面、API 和 `data/workbench-state.json` 保持不变；当前实现不执行真实内容生成、RAG、外部平台发布或 Agent 编排。

## 2. 运行时配置

```text
WORKBENCH_STATE_PATH=<V4 工作台状态文件>
V5_MONTHLY_STATE_PATH=<V5 月度状态文件>
```

- `WORKBENCH_STATE_PATH` 仅作为规则包、产品计划、角色和渠道的只读来源。
- `V5_MONTHLY_STATE_PATH` 默认是 `data/v5-monthly-workbench.json`。
- GET 在 V5 文件不存在时返回空状态，不会创建文件。
- 第一次成功保存月度计划时才创建 V5 文件。
- 未配置或找不到真实 V4 状态时，接口返回 `seed_fallback`；该来源下规则包不可进入生产池。

## 3. 接口契约

### GET `/api/v5/monthly-workspace?month=YYYY-MM`

一次返回页面所需的聚合读模型：

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
```

不传 `month` 时，优先返回 V5 状态中最新月份；没有任何 V5 数据时返回当前月份。

### PUT `/api/v5/monthly-plans/[month]`

请求头：

```text
x-idempotency-key: <8-200 characters>
```

请求体：

```json
{
  "config": {
    "month": "2026-08",
    "businessGoal": "本月业务目标",
    "baselineRatio": 20,
    "ratioAdjustmentReason": "",
    "groups": []
  },
  "expectedVersion": 0
}
```

写接口服务端执行：

1. 角色权限校验，仅允许 `content_growth`、`workbench_operator`、`developer_admin`。
2. 路径月份与配置月份一致性校验。
3. 规则包 active、月度生产就绪、产品与渠道匹配校验。
4. 配额、重复规则包、20/80 调整原因和文本长度校验。
5. `expectedVersion` 乐观锁校验。
6. `x-idempotency-key` 幂等重放和冲突校验。
7. 审计记录写入。

## 4. 数据边界

V5 状态由 `src/lib/v5/monthly-repository.ts` 管理，使用临时文件加 rename 的原子覆盖方式。数据结构包含：

```text
plans
strategyRows
batchQueueItems
exceptionItems
scheduleDraftItems
auditLog
idempotency
```

策略生成、矩阵生成、异常处理和排程服务后续只需要向对应月份数组写入真实记录，现有两个页面无需重新设计信息架构。

## 5. 页面状态规则

- `persisted`：该月份已有真实 V5 计划或队列数据。
- `empty`：接口已接通，但该月份尚无 V5 数据。
- `v4_runtime`：规则包与渠道来自真实 V4 状态。
- `seed_fallback`：真实 V4 状态未连接，只允许查看，不允许作为生产准入依据。

页面不再回退到 `src/lib/v5-ui-mock-data.ts` 的月度矩阵或批量队列数据。



# EvidencePack 与证据充分性判断

## 1. 目标

把检索候选分别组织成平台表达准备使用的 `EvidencePreview` 和正文生成使用的 Final `EvidencePack`，并判断候选角度或最终主张是否有足够证据、是否存在冲突、是否缺少必须披露的限制。

EvidencePreview 不是生成许可；Final EvidencePack 不是 Top-K Chunk 数组，而是一次冻结任务的证据快照和生成许可决策。

## 2. 两阶段证据对象

### 2.1 EvidencePreview

在月度策略批准并生成矩阵草稿后、月度矩阵审核前生成。它包含可用核心 Claim、限制、官网引用、禁止用于标题的数字与案例、证据缺口和可证明角度。

状态：

- `preview_ready`
- `needs_material`
- `needs_review`
- `blocked`
- `pending_config`

EvidencePreview 可以支持矩阵标题候选、内容类型选择、三项前置检查和人工矩阵审核，但不能进入正式正文 Prompt，也不能写入正式 `evidenceGateStatus`。

### 2.2 Final EvidencePack

在月度策略和月度矩阵人工审核后，根据 approved ContentMatrixItem execution snapshot 生成。它必须逐项证明标题承诺和正文 ClaimPlan，并由其决策写入正式 `evidenceGateStatus`，才可授予生成许可。

## 3. Final EvidencePack 生成前提

只为已批准月度矩阵项形成的冻结执行任务组装 Final EvidencePack。任务至少需要：

- `monthlyPlanId`
- `matrixVersionId`
- `matrixItemId`
- `taskId`
- `taskVersion`
- `contentType`
- `platformContentType`
- `productId`
- `channel`
- `title`
- `sourceProblem`
- `primaryDistilledTermId`
- `knowledgeBaseIds`
- `rulePackageVersionId`
- `platformExpressionProfileId`
- 调用权限

检索器不能重新改变这些业务决策。

## 4. Final EvidencePack 结构

```yaml
evidencePackId: "ep-..."
status: "generatable"
createdAt: ""

taskSnapshot:
  monthlyPlanId: ""
  matrixVersionId: ""
  matrixItemId: ""
  taskId: ""
  taskVersion: 1
  contentType: ""
  platformContentType: ""
  productId: ""
  channel: ""
  title: ""
  sourceProblem: ""
  primaryDistilledTermId: ""

governanceSnapshot:
  rulePackageVersionId: ""
  allowedExpressionIds: []
  conditionalExpressionIds: []
  blockedRuleIds: []
  officialCitationRequirements: []

retrievalSnapshot:
  indexSnapshotIds: []
  routeId: ""
  routeVersion: ""
  retrievalPolicyVersion: ""
  embeddingModel: ""
  rerankerModel: ""
  candidateCount: 0
  selectedCount: 0

claimPlan:
  requiredClaims: []
  optionalClaims: []
  forbiddenClaims: []

evidenceGroups:
  productDefinitions: []
  capabilities: []
  scenarios: []
  cases: []
  limitations: []
  faqs: []
  officialCitations: []
  industryBackground: []

gaps: []
conflicts: []
outdatedEvidence: []
unverifiedClaims: []

decision:
  status: "generatable"
  reasons: []
  requiredActions: []
  downgradeInstructions: []
```

## 5. EvidenceItem

每条证据至少包含：

```yaml
evidenceItemId: "ev-..."
chunkId: "chk-..."
primaryClaimId: "claim-..."
claimIds: []
sourceId: "src-..."
sourceRevisionId: "src-rev-..."
sourceLocator: {}
title: ""
summary: ""
originalQuote: ""
canonicalUrl: ""
documentType: ""
authorityLevel: "A2"
supportMode: "direct"
claimScope: "public_product"
capabilityStatus: "current"
productVersion: ""
conditions: []
limitations: []
validFrom: ""
validUntil: ""
selectionReason: ""
allowedUsage: []
forbiddenUsage: []
```

正文模型需要的是可使用范围，不只是相关文本。

## 6. ClaimPlan

EvidencePack 组装前先根据任务和规则包生成 `ClaimPlan`，明确文章计划使用哪些主张。

例如场景方案文章需要：

- 一个产品定义。
- 一个用户问题或场景。
- 一至三项相关能力。
- 每项能力的条件或限制。
- 一个官方引用。
- 案例可选，但使用时必须有范围。

ClaimPlan 只规划证据槽位，不替正文生成观点和语言。

## 7. 证据槽位

### 6.1 产品定义

至少一条当前高权威官方证据；跨产品任务每个产品分别满足。

### 6.2 能力

每项准备写入正文的核心能力都要有直接或条件支持的 Claim。不能用同一条泛化资料证明全部能力。

### 6.3 场景

场景证据需要说明用户、环境、问题和产品介入方式。行业背景不能单独证明产品适用。

### 6.4 限制

能力为 `conditional`、特定版本、特定部署或涉及外部依赖时，限制槽位为必填。

### 6.5 案例

保留授权、匿名状态、实施范围、结果口径和时间。缺少这些信息时只可作为场景参考。

### 6.6 官方引用

需要官网引用的渠道或规则，至少包含 canonical URL、规范实体名和可支撑主张。

### 6.7 外部背景

只支撑法规、标准、行业风险和概念解释，不得证明产品能力。

## 8. 证据充分性

证据充分性按“计划使用的主张”判断，不按 Chunk 数量判断。

### 7.1 单条主张判断

```text
Claim 已确认
+ 来源权威满足规则要求
+ 原文定位完整
+ 版本和作用域匹配任务
+ 条件与限制齐全
+ 无未解决阻断冲突
= 可使用
```

### 7.2 整体任务判断

- 所有必需 Claim 有证据。
- 规则包要求的限制和官网引用齐全。
- 没有使用禁止 Claim。
- 案例、数字和比较满足额外证据要求。
- 权限与目标渠道匹配。

## 9. 决策状态

### `generatable`

核心事实、限制、官方引用和规则边界齐全，可以进入第四阶段。

### `generatable_with_downgrade`

存在非核心证据不足，但有明确降级写法。例如删除性能数字、把“完全自动化”降为“支持工作流编排”。

### `needs_material`

缺少正式产品证据、案例授权、测试报告、部署说明或官网引用。

### `needs_review`

存在非阻断冲突、匿名案例泛化风险、版本不明、竞品时效或条件不完整，需要人确认。

### `blocked`

产品混淆、权限越界、核心事实无证据、来源隔离、重大冲突或触发硬拦截。

### `pending_config`

真实 embedding、检索 Provider 或必要服务未配置。可以返回治理 Preview，但不能授予正式正文生成许可。

## 10. 降级规则

降级必须来自规则包，不能由检索器临场创造：

| 缺口 | 可接受降级 |
| --- | --- |
| 性能报告缺失 | 删除数字，使用机制或定性表达 |
| 客户授权缺失 | 删除客户身份和结果，改为适用场景 |
| 兼容矩阵缺失 | 写“需按当前版本验证” |
| 数据流不明 | 禁止“数据绝不出网”，写“支持私有化选项，路径需确认” |
| Beta/规划状态 | 明确标记测试或规划，不写成当前正式能力 |
| 竞品资料过期 | 删除绝对比较，只保留比较维度 |

涉及产品身份、合规资质、绝对安全、客户效果和重大冲突时，不允许仅靠降级自动通过，应进入人工确认或阻断。

## 11. 冲突处理

EvidencePack 不裁决冲突，只继承第二阶段结果：

- 已裁决：使用选定 Claim 和适用版本。
- 临时保守口径：使用保守 Claim，并附限制。
- 未解决非阻断冲突：`needs_review`。
- 未解决阻断冲突：`blocked`。

不得同时把互相冲突的两个事实交给正文模型“自行判断”。

## 12. 多产品任务

品牌矩阵和跨产品方案：

- 每个产品独立 ClaimPlan 和证据组。
- 一个产品的证据不能补另一个产品的能力缺口。
- 比较结论需要双方同期资料。
- 官网引用分别保留。

如果任一产品核心证据不足，应缩小文章范围或进入补资料，而不是用其他产品内容填满。

## 13. Token 预算

EvidencePack 先保留结构化元数据，再按正文模型上下文预算选择原文：

1. 必需产品定义、能力和限制优先。
2. 官方引用优先于重复解释。
3. 同主题重复内容压缩为一个代表证据。
4. 案例和背景按任务类型分配预算。
5. 不因预算删除条件和限制。

摘要用于筛选，最终引用仍保留关键原文。

## 14. 快照与复现

EvidencePack 一旦用于生成，应保存不可变快照：

- 任务版本。
- 规则包版本。
- 索引快照。
- 路由和重排版本。
- 选中证据及原文。
- 决策状态和原因。

后续来源更新不修改历史 Pack；需要重新生成时创建新版本并比较差异。

## 15. 页面呈现

月度内容矩阵的 Evidence Gate 面向内容增长负责人展示：

- 可以生成还是缺证据。
- 选用了哪些关键事实。
- 哪些表达必须带条件。
- 官网是否齐全。
- 下一步补什么。

Weekly View 和 Today Execution 只展示该矩阵项已计算的证据状态与入口，不重新检索或生成另一套业务结论。

Chunk ID、得分明细、embedding、Reranker 和原始调用日志进入治理或开发视图。

## 16. 验收标准

1. 每个核心主张都能追溯到 Claim 和原文。
2. 条件能力不会缺少限制证据。
3. 外部行业背景不会支撑产品能力。
4. 未解决阻断冲突不会进入正文生成。
5. Pack 可以复现索引、路由、规则和证据选择。
6. 生成许可由 Final EvidencePack 的证据槽位满足情况决定，不由 Preview 或 Top-K 数量决定。
7. 标题或平台表达修改后旧 Final EvidencePack 失效，必须基于新任务版本重新组装。
8. Final EvidencePack 与 monthlyPlanId、matrixVersionId 和 matrixItemId 一一对应。
9. 月度矩阵未批准时不能生成正式 Pack；Final EvidencePack 决策为 blocked、pending_config 或需要补资料时，必须写入对应 Evidence Gate 结果且不能进入 BatchGenerationRun。

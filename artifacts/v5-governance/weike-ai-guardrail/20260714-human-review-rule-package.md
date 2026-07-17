# 唯客 AI 护栏 V5 人工审核规则包

## 结论

- 产品：`weike-ai-guardrail`
- 规则包版本：`weike-guardrail-pilot-20260714-rule-v0.1.0`
- 语义版本：`0.1.0-draft.1`
- 当前状态：`draft_pending_product_confirmation`
- 来源快照 Hash：`657d56f37af2ad24d9363f87331e6a1acfd15f7427dcb8988f300ed3ecb1d331`
- 人工审批记录：`0`
- `monthlyProductionReady`：`false`
- 决策：保持在生产池之外，不允许进入月度矩阵。

本文件是数据库结构化规则包的人类审核视图。它不替代 `rule_package_version`、`product_claim`、`evidence_gap`、`approval_record` 和 `source_snapshot` 真源。

## 执行边界

设计与判断只依据：

- `docs/V5 -07-09`
- `docs/V5 07-07`

两套目录全程只读。真实写入发生在 `database/`、`src/`、`scripts/`、`artifacts/` 和 MySQL V5 治理表。

## 灰度样本

- 真实公开资料：15 份。
- 模拟敏感资料：1 份，不含真实隐私或凭证。
- G0 隔离：4 份，其中 3 份真实文章命中高置信个人标识符模式，1 份为模拟敏感资料。
- 继续治理：12 份。
- SourceRevision：12 个。
- 候选 ProductClaim：9 条，全部保持 `candidate`。

| 类别 | 真实资料数 | 当前处理 |
| --- | ---: | --- |
| PII / 隐私 | 3 | 2 份隔离；其余只形成候选场景 |
| 内容与生成式 AI 合规 | 2 | 1 份隔离；不得写成“保证合规” |
| Dify 集成 | 2 | 形成兼容候选；版本和应用类型待确认 |
| 性能 / 毫秒级 | 2 | 不抽取性能事实；转为测试条件缺口 |
| 私有化部署 / 数据边界 | 2 | 形成条件候选；数据流和外部处理器待确认 |
| 输入输出检测 | 2 | 形成安全控制候选 |
| 越狱 / 幻觉 | 1 | 形成安全控制候选 |
| 案例 / 客户效果 | 1 | 不抽取客户效果事实；转为授权证据缺口 |

## G0-G6 结果

| Gate | 结果 | 说明 |
| --- | --- | --- |
| G0 | `conditional` | 隔离 4 份，只允许 12 份安全资料继续 |
| G1 | `passed` | 12 份正文、64 位 Hash、canonical 和原文定位可用 |
| G2 | `passed` | 统一分类为 B2 官网博客，绑定稳定 `productId` |
| G3 | `conditional` | 9 条候选 Claim 需要责任角色逐条复核 |
| G4 | `conditional` | 5 个 blocking 缺口、3 个 high 缺口；采用保守阻断口径 |
| G5 | `blocked` | Agent 不得激活；无批准 Claim；6 个角色待确认 |
| G6 | `blocked` | 没有 active 规则包，月度准备度为 false |

## 产品身份草稿

- 产品名：唯客 AI 护栏。
- 候选类别：大模型应用运行时安全与内容治理产品。
- 证据状态：`blocking_gap`。
- 待补：当前正式产品页、正式主体、产品类别、当前版本与正式产品定义。

## 当前只允许的条件表达

1. 可在具体验证范围内帮助识别和治理大模型应用风险。
2. 可作为 Dify 等大模型应用链路中的候选安全治理组件。
3. 必须同时披露：具体能力、产品版本、部署方式和适用范围以正式资料为准。

## 硬阻断表达

1. 禁止把“帮助合规”改写成“保证合规”或“确保合规”。
2. 无完整测试环境、样本量、平均/P95 口径、配置和产品版本时，禁止使用 `<300ms`、`毫秒级`等绝对性能承诺。
3. 无正式部署架构、第三方处理器和数据流资料时，禁止承诺“数据不出域”“完全不出网”或同义表述。
4. 无授权、统计时间和测量基线时，禁止使用客户数量、客户效果、检出率、误报率和资质数字。
5. PII 类型 taxonomy 和统计口径未确认前，禁止对外使用具体 PII 类型数量。
6. 禁止把 Dify、模型 Provider、云扫描或合作方能力归为唯客 AI 护栏原生能力。

## Evidence Requirements

| 主张 | 最低资料 | 必填条件 |
| --- | --- | --- |
| 性能 | A1 正式评测 | 测试环境、样本量、平均/P95、配置、产品版本 |
| 数据流与隐私 | A1 架构/隐私资料 | 部署架构、外部处理器、云扫描链路、数据边界 |
| 客户效果 | B1 授权案例/验收 | 客户授权、统计时间、测量基线、适用范围 |
| 资质与合规 | A1 资质/正式法律口径 | 资质文件或正式法律结论 |
| Dify 兼容 | A1/A2 技术文档 | Dify 版本、应用类型、接入位置、不兼容范围 |
| PII 类型数量 | A1 正式规格 | taxonomy、统计规则、产品版本 |

## 证据缺口

| 严重度 | 缺口 | 责任角色 |
| --- | --- | --- |
| blocking | 当前正式产品页与正式产品定义 | `product_owner` |
| blocking | `<300ms` 等性能口径的正式测试报告 | `technical_owner` |
| high | Dify 应用类型与版本兼容矩阵 | `technical_owner` |
| blocking | 云扫描与数据不出域边界的数据流说明 | `privacy_owner` |
| high | 检出率、误报率与攻击覆盖正式评测 | `security_owner` |
| blocking | 客户数量和案例效果授权证据 | `delivery_owner` |
| blocking | 资质与合规主张正式证明 | `legal_owner` |
| high | PII 类型数量统一基线 | `security_owner` |

## 人工审批顺序

1. `product_owner`：确认产品身份、正式产品页、当前能力和版本。
2. `technical_owner`：确认 Dify 兼容矩阵、部署条件和性能测试口径。
3. `security_owner`：确认 PII taxonomy、检出率、误报率和攻击覆盖。
4. `privacy_owner`：确认云扫描、外部处理器、数据流和数据出域边界。
5. `legal_owner`：确认“帮助合规”口径、资质和法律边界。
6. `delivery_owner`：确认客户数量、案例授权、实施范围和效果基线。

每个角色必须写入独立 `ApprovalRecord`。只有全部必要审批完成、至少存在一条 `supported/conditional` Claim、blocking 冲突与全局缺口解除后，人工才能重新发起 G5 激活。

## 月度矩阵范围

- `allowedContentTypes`: `[]`
- `conditionalContentTypes`: `risk_education`, `concept_explainer`
- `blockedContentTypes`: `performance_benchmark`, `customer_case`, `compliance_claim`, `deployment_guarantee`, `product_comparison`
- `allowedChannels`: `[]`
- `maxMonthlyQuota`: `null`

注意：条件内容类型只表示规则草稿建议，不授予月度生产资格。在规则包变为 `active` 前，任何渠道和配额都保持不可用。

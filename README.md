# JOTO GTM Content Workbench

JOTO GTM 内容工作台服务真实的月度内容生产、发布记录和效果复盘。唯一业务主链路是：

`MonthlyPlan -> 日期执行 -> 发布与指标 -> MonthlyReview -> 下月方案`

WorkBuddy 和腾讯云 ADP 是当前主要推广对象，其他 JOTO 产品也可以通过产品规则、知识证据和动态推广配置接入；领域代码不写死任何产品名、身份句、CTA 文案或 URL。

## 1. V5 内容生产目标链路

`知识治理 -> 月度任务冻结 -> FinalEvidencePack -> 生产合同编译 -> 生成前门禁 -> 模型生成与内部自检 -> 确定性机器校验 -> 最多一次自动修复 -> 可用正文 -> 发布确认`

正文事实只能来自知识库检索形成的冻结 `FinalEvidencePack`。内容类型决定文章如何回答问题，渠道规则决定平台格式，动态推广配置决定在给定产品、渠道和 CTA 意图下使用哪个已批准推广资产。

CTA 不由模型自由选择。系统会根据冻结任务依次匹配目标产品、渠道、CTA 意图、内容类型、标题类别、推广目标、有效期和优先级，并把唯一结果写入 `CTAPlan`。同业务优先级存在多个候选时直接阻断；必需 CTA 无匹配时阻断；非必需 CTA 无匹配时生成无 CTA 正文。

## 2. 当前分支已实现

- 产品无关的内容任务、证据包、产品规则、内容类型、渠道规则和推广配置契约。
- 动态推广/CTA 确定性解析，包含审批、有效期、公开 HTTPS URL、Claim、渠道呈现和冲突门禁。
- 不可变 `ProductionContractSnapshot` 编译及稳定哈希。
- 字数、结构、事实追踪、边界、CTA、URL、敏感信息、重复和跨渠道相似度校验。
- Provider 技术失败最多三次尝试；业务规则失败最多一次自动修复。
- 13 项领域测试，覆盖多产品多渠道 CTA、缺配置、冲突、EvidencePack 门禁、输出校验和重试状态。

实现位于 `src/lib/v5/`，详细设计见 `docs/V5-07-20/内容生产规则链路与动态推广确定性解析方案.md`。

## 3. 当前能力边界

当前代码完成的是可独立测试的 V5 领域核心，不等于页面端已经具备完整真实内容生产链路。

尚未接通：

- MySQL `PromotionProfileVersion` 仓库、版本审批和管理 UI。
- 本分支知识库页面到正式 Claim、SourceRevision、产品规则包和 `FinalEvidencePack` 的真实治理链路。
- OpenSearch 检索及真实 WorkBuddy、ADP 和其他产品证据入库。
- 批量生成 API/UI 到 `ProductionContractSnapshot`、真实模型 Provider 和校验结果的接线。
- 可用正文到排程、真实平台发布及发布回执的自动桥接。

因此，当前可以证明“规则如何确定性执行”，不能宣称用户已经能在页面上完成从知识检索到公开发布的端到端生产。旧流程中的人工终稿确认仍存在；当新链路接入后，人工职责应收敛为规则审批、关键判断和发布确认，不再承担逐段机器质检。

## 4. Verification

```powershell
npm.cmd run typecheck
npm.cmd run validate:structure
npm.cmd run test:v5-content-production
```

## 5. Documents

- `docs/V5-07-20/内容生产规则链路与动态推广确定性解析方案.md`: 规则分层、动态推广、确定性解析、状态机、测试和执行计划。
- `docs/usage.md`: 当前工作台试运行、Pipeline、诊断和验证命令。
- `design/low-fi-prototype.md`: 现有页面与主流程原型基线。

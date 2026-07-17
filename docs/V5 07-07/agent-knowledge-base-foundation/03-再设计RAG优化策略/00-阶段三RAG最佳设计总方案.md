# 阶段三：RAG 最佳设计总方案

## 1. 文档定位

本阶段负责把第二阶段确认后的来源资料、原子事实和生效产品规则包，加工成稳定、可过滤、可追溯、可评测的检索与证据组装系统。

它解决的不是“如何把文字做成向量”，而是：系统如何先为已批准策略生成的月度内容矩阵草稿提供可证明角度的 EvidencePreview，再针对已批准 ContentMatrixItem 的执行快照，从正确产品、正确版本、正确权限和正确证据等级中形成可审计的 Final EvidencePack。

第三阶段的最终结果不是一批 embedding，而是五类生产资产：

1. 受第二阶段准入控制的 RAG 索引版本。
2. 与 `ProductClaim` 绑定的语义 Chunk。
3. 可配置的检索路由、硬过滤和混合排序规则。
4. 面向矩阵审核的 EvidencePreview，以及面向矩阵项正式正文生成的 Final EvidencePack。
5. 可复现的检索评测集、运行记录和 Badcase 回流。

## 2. 核心判断

不采用以下路径：

```text
知识库全部资料
-> 固定 Token 切片
-> 向量相似度 Top-K
-> 直接交给模型写正文
```

这条路径会把相似度误当成可信度，导致：

- 历史博客压过正式产品页。
- 规划能力被写成当前能力。
- 匿名案例数字被泛化。
- 不同产品的相似能力相互串库。
- 隐私政策和官网营销口径冲突时由模型自行选择。
- 来源已经失效或规则包已回滚，旧索引仍继续命中。

最佳路径是：

```text
ragIngestionManifest 准入
-> SourceRevision / ProductClaim 快照
-> MonthlyProductionReadiness 与月度生产池校验
-> Claim 感知语义切片
-> 分命名空间索引
-> 任务路由与权限硬过滤
-> 关键词 + 向量混合召回
-> 权威、时效、状态、规则重排
-> 去重、冲突与多样性控制
-> 月度矩阵 Evidence Gate
-> EvidencePreview / Final EvidencePack 证据充分性判断
-> 可生成 / 补资料 / 人工确认 / 阻断
```

## 3. 阶段边界

### 3.1 本阶段负责

1. 消费第二阶段输出的 `ragIngestionManifest`。
2. 建立生产、治理预览、内部受限和隔离命名空间。
3. 生成 Claim 感知的父子 Chunk、元数据和索引版本。
4. 管理真实 embedding、关键词索引、过滤索引和重排策略。
5. 按产品、任务、渠道、用户问题和蒸馏词进行检索路由。
6. 执行产品、权限、状态、版本和冲突硬过滤。
7. 月度策略批准并生成矩阵草稿后组装 EvidencePreview，矩阵批准并形成执行快照后组装 Final EvidencePack。
8. 管理索引更新、失效、重建、回滚和缓存。
9. 建立检索评测、运行监控和 Badcase 反馈。

### 3.2 本阶段不负责

1. 不重新判定资料类型、产品实体和事实真伪；这些属于第二阶段。
2. 不修改 `ProductClaim`、来源冲突裁决和产品规则包。
3. 不最终决定标题、产品、渠道和主蒸馏词；EvidencePreview 只说明哪些角度可被证据支持，最终选择由月度策略与矩阵审核完成。
4. 不直接生成正式正文；正文生成属于第四阶段。
5. 不允许检索器用低权威资料补齐被规则包禁止的表达。
6. 不因 embedding 配置缺失而伪造真实向量或检索效果。

第三阶段发现来源、事实或规则问题时，只能创建缺口、冲突候选或 Badcase，回到第二阶段确认。

## 4. 上下游契约

### 4.1 第二阶段输入

第三阶段只接收：

- `productId`
- `knowledgeBaseIds`
- `activeRulePackageVersionId`
- `approvedSourceRevisionIds`
- `approvedClaimIds`
- `blockedClaimIds`
- `unresolvedConflictIds`
- `authorityPolicyVersion`
- `monthlyPlanId`
- `monthlyProductionReadinessId`
- `matrixScopeVersion`

没有进入 `ragIngestionManifest` 的资料不能进入生产索引。

### 4.2 第四阶段输出

第三阶段分两次向第四阶段输出。平台表达准备前输出 `EvidencePreview`，说明可用 Claim、不可用强主张、证据缺口和可证明角度；任务冻结后输出 Final `EvidencePack`：

- 任务与路由快照。
- 生效规则包摘要。
- 结构化证据组。
- 可引用原文和官方 URL。
- 条件、限制、作用域和版本。
- 缺口、冲突、过期和未验证信号。
- `generatable / needs_material / needs_review / blocked` 决策。

第四阶段不能用 EvidencePreview 直接生成正式正文，也不能绕过 Final `EvidencePack` 把随机 Chunk 塞给正文模型。

## 5. 七层架构

### 5.1 准入层

验证 Manifest、来源状态、事实状态、规则包版本和公开权限。

### 5.2 加工层

将来源修订和原子事实加工成父 Chunk、Claim Chunk、上下文 Chunk 和引用 Chunk。

### 5.3 索引层

建立关键词、向量、结构化过滤和关系索引，并按命名空间和版本隔离。

### 5.4 路由层

根据任务类型决定允许召回的 Chunk 类型、资料类型、权威等级和数量配额。

### 5.5 召回与重排层

硬过滤后执行关键词、向量、实体和标签召回，再按权威、时效、规则和多样性重排。

### 5.6 证据组装层

围绕任务需要使用的主张，组装定义、能力、场景、案例、限制、FAQ、官方引用和外部背景。

### 5.7 评测治理层

记录索引版本、检索配置、候选与最终选择，形成可复现测试和 Badcase。

## 6. 关键原则

1. **准入优先于切片**：上传成功不等于可索引。
2. **硬过滤优先于相似度**：产品、权限、状态、版本和冲突先过滤。
3. **Claim 优先于文本窗口**：每个生产 Chunk 必须说明支撑哪些事实。
4. **可信度与相关性分离**：语义相似不代表证据权威。
5. **限制证据优先保留**：限制、条件和否定事实不能被营销内容淹没。
6. **生产与预览隔离**：草稿和未确认事实只能进入治理预览。
7. **索引必须可回滚**：规则包或来源回滚后，旧索引不能继续无感命中。
8. **缺配置保持真实**：无 embedding 时返回 `pending_config`，不使用 fallback Hash 冒充真实向量。
9. **正文只消费 Final EvidencePack**：EvidencePreview 只服务平台表达准备，正文不直接面对 Preview 或无结构 Top-K。
10. **问题回到正确层解决**：缺资料回第二阶段，检索错误留第三阶段，表达错误进入第四/第五阶段。

## 7. 三类产品的差异化风险

| 产品 | 数据特征 | 主要检索风险 | 重点保护 |
| --- | --- | --- | --- |
| Pharaoh Command | 正式产品与行业方案页较集中 | 匿名案例、自动执行、兼容和效果数字混在同页 | 权限条件、兼容矩阵、案例范围、部署边界 |
| Noteflow | 少量产品页 + 大量历史博客 | 博客压过产品页、规划能力和隐私冲突 | 产品页优先、状态过滤、第三方处理器、版本区分 |
| 唯客 AI 护栏 | 产品页 + 大量安全文章 | 行业知识被归为产品能力、绝对安全与性能承诺 | 产品事实隔离、检测范围、评测条件、合规边界 |

默认禁止跨产品召回。只有品牌矩阵、跨产品方案或人工指定比较任务可以跨库，并必须按产品分别组装证据组。

## 8. 生产检索主流程

```text
接收月度策略候选或已批准 ContentMatrixItem
-> 校验 monthlyPlanId / matrixItemId / productId / rulePackageVersionId / permissions
-> 选择 RetrievalRoute
-> 读取对应 IndexSnapshot
-> 硬过滤 namespace / product / status / version / visibility / conflict
-> 生成关键词、实体、标签和向量查询
-> 多路召回候选池
-> 权威与任务相关性重排
-> 去重簇、多样性和来源配额控制
-> 对齐任务需要的主张与证据槽位
-> 组装 EvidencePreview 或 Final EvidencePack
-> 执行证据充分性与规则校验
-> 回写矩阵项 Evidence Gate 和可解释摘要
```

## 9. 文档真源分工

| 文档 | 负责内容 |
| --- | --- |
| `01-RAG准入索引命名空间与生命周期.md` | Manifest、索引隔离、版本、更新和回滚 |
| `02-Claim感知Chunk数据契约与语义切片.md` | Chunk 结构、切片、父子关系、去重和产品差异 |
| `03-检索路由混合召回重排与权限过滤.md` | 路由、过滤、召回、评分、重排和降级 |
| `04-EvidencePack与证据充分性判断.md` | 证据槽位、组装、缺口和生成决策 |
| `05-RAG评测监控与Badcase闭环.md` | 离线评测、在线监控、解释、Badcase 和反馈 |
| `06-实施迁移验收与跨阶段交接.md` | V4 迁移、上线顺序、接口、验收和第四阶段交接 |

## 10. 阶段完成标准

1. 生产索引只消费第二阶段准入的来源、事实和 active 规则包。
2. Chunk 可追溯到 `sourceRevisionId + claimIds + sourceLocator`。
3. 产品、权限、状态、版本和冲突在相似度计算前完成硬过滤。
4. 不同内容任务使用不同路由、候选池、配额和重排权重。
5. 真实 embedding 缺失时明确返回 `pending_config`。
6. 来源、事实和规则变更能够触发精确失效或重建。
7. 每个 EvidencePreview 和 Final EvidencePack 可复现其索引、路由、候选和选择过程。
8. 缺证据时准确进入补资料、人工确认或阻断，不硬生成。
9. 三产品固定评测集达到产品隔离、状态保护和证据追溯要求。
10. 第四阶段的平台表达准备只接收 EvidencePreview，正式正文生成只接收 Final EvidencePack，不直接访问无治理 Chunk。
11. 每个 EvidencePreview 和 Final EvidencePack 都绑定 monthlyPlanId、matrixVersionId 和 matrixItemId 或策略候选 ID。
12. 未进入月度生产池、未批准矩阵或 Evidence Gate 不通过的对象不能获得正式生成许可。

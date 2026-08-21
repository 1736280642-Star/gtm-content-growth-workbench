# GEO 调研链路改造 P0 阶段总结

> 阶段范围：M1 渠道规则包、M2 查询编译器扩展、M3 平台打标
> 完成日期：2026-08-19
> 验证结果：`npm.cmd run typecheck` 通过；`npm.cmd run validate:structure` 534/534 通过

## 一、本阶段目标回顾

P0 是"配置与打标"阶段：不动任何门禁逻辑，让链路获得**平台感知能力**——知道目标平台是哪些、按内容类型采集证据、统计各平台收录分布。

## 二、完成内容

### M1 渠道规则包（新文件 [geo-channel-rule-pack.ts](../../src/lib/v5/geo-channel-rule-pack.ts)）

- `GeoChannelRulePack` / `GeoChannelRule` 契约：channelKey、domains、inclusionPatterns、structureRequirements、faqBoards、comparisonDimensions、ctaVariantRefs、authorAccountPolicy、evidenceCandidateIds；
- 读取方式：环境变量 `GEO_CHANNEL_RULE_PACK_JSON` 注入（后续切换治理存储表）；未配置返回 undefined（仅允许自有渠道模式）；配置但非法**抛错 fail-closed**（含激活人/激活时间、channelKey 格式、域名合法性和去重校验）；
- 辅助函数：`matchChannelForHost`（主域+子域匹配）、`listChannelFaqBoards`、`listChannelComparisonDimensions`；
- 合规性：零硬编码平台域名/文案，符合 AGENTS.md 规则 8。

### M2 查询编译器扩展（[geo-product-identity.ts](../../src/lib/v5/geo-product-identity.ts)、[geo-search-contracts.ts](../../src/lib/v5/geo-search-contracts.ts)）

1. `GeoSearchQuery` 新增 `channelKey?` 字段；
2. 新增五类查询意图（expectedEvidenceRole）：
   - `platform_inclusion_landscape`（site: 平台格局）、`pitfall_evidence`（踩坑）、`selection_alternative`（开源替代）、`metric_benchmark`（量化基准）、`misconception`（误区）；
3. 核心查询预算最多 6 条；每个研究边界内、且被规则包覆盖的第三方目标渠道另追加一条 `site:` 平台查询，避免平台查询被核心查询的 `maxQueries` 截断；
4. 补充轮定向化：新增 `GeoSupplementaryGap` 类型与 `evidenceGap` 参数——平台全空时补 `site:` 平台查询（platform_evidence），否则补独立来源（independent_sources，保持旧 suffix 行为）；**未传 evidenceGap 时行为与旧版完全一致**（向后兼容）；
5. provider 侧 `GEO_RESEARCH_ZHIPU_MAX_QUERIES` 默认 3→6、上限 5→6；round 循环按 `inferSupplementaryGap`（基于 channelStats 推断）定向补搜。

### M3 平台打标（[geo-search-adapters.ts](../../src/lib/v5/geo-search-adapters.ts)）

1. `toEvidenceCandidate`：候选 URL 域名命中渠道规则包 → 携带 `channelKey`（authority 分级不变，CSDN 仍是 community/medium）；
2. `mergeCandidates`：同 URL 合并时保留 channelKey；
3. 新增 `recomputeChannelStats`：从当前候选集派生 `channelStats`（candidateCount / verifiedCount），并为已查询但零命中的目标渠道保留零值统计，使补充轮可以识别“平台证据为空”；
4. 三处 pack 构造接入：`runMultiProviderWebSearch`、`combineMultiSearchEvidencePacks`（adapters）与 `recalculatePack`（geo-product-identity，实体解析后更新）——`MultiSearchEvidencePack.channelStats` 就是"各平台在收录什么"的原始答案。

## 三、行为兼容性

- 未配置 `GEO_CHANNEL_RULE_PACK_JSON` 时：只含自有渠道的研究仍可运行；一旦研究边界声明第三方渠道，读、写路径都会 fail-closed；
- 配置后：每个任务最多执行“6 条核心查询 + 每个第三方目标渠道 1 条平台查询”。请求量随目标渠道数线性增加，应通过缩小研究边界控制成本。

## 四、附带修复

- [WechatArticlePreview.tsx](../../src/components/free-production/WechatArticlePreview.tsx)：HEAD 既有的 3 个 TS2322 错误（可选 props 传入必填子组件），改为三值齐全时才渲染 `WechatCoverBindingPanel`，行为不变，typecheck 恢复绿色。

## 五、遗留到后续阶段

- M4：五类查询意图对应的任务指令与输出 schema（faqBoard/misconception/selectionAlternatives/platformStrategy）；
- M5：实体命名硬校验 + 平台挂靠/数字门禁软校验；
- M6：`deriveEntityNamingStandard` 实体命名表。

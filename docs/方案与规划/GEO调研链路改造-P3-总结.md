# GEO 调研链路改造 P3 阶段总结

> 阶段范围：M9 就绪检查微调（渠道规则包校验）
> 完成日期：2026-08-19
> 验证结果：`npm.cmd run typecheck` 通过；`npm.cmd run validate:structure` 537/537 通过；GEO 相关测试套件全绿（foundation 14、multi-search 20、source-quality 4、parallel-geo-monitoring 10、website-geo-closed-loop 3、product-strategy 15、probe-compiler + result-pack 含 M8/M9 新增测试全部通过）

## 一、本阶段目标回顾

P3 是"守门"阶段：P0 引入渠道规则包后，`targetChannels` 里声明的第三方平台渠道（知乎/CSDN/小红书等）只有在**规则包已激活且覆盖该渠道**时，平台感知查询、打标、channelStats 才有真实依据。M9 把这件事从"运行时静默降级"提升为"就绪检查显式拦截"——研究边界声明了平台渠道却没有规则包时，直接 blocked（fail-closed），避免产出看似平台化实则无据的调研结果。

## 二、完成内容

### M9 就绪检查微调（[geo-channel-rule-pack.ts](../../src/lib/v5/geo-channel-rule-pack.ts)、[geo-research-service.ts](../../src/lib/v5/geo-research-service.ts)）

**1. 渠道规则覆盖评估 `evaluateTargetChannelRuleCoverage`**

- 新增 `GEO_OWNED_CHANNEL_KEYS`（`wechat` / `official_website` / `ai_frontend`）：自有渠道的内容形态由我们自己决定，不依赖第三方平台的收录规则包，**不参与校验**；
- 其余渠道视为第三方平台渠道，必须被已激活规则包的 `channels[].channelKey` 集合覆盖；
- 三种 blocked 情形（返回中文阻塞原因，直接展示在就绪检查面板）：
  1. `GEO_CHANNEL_RULE_PACK_JSON` 配置了但解析/结构非法 → "渠道规则包配置非法：…"（规则包存在但坏 = fail-closed，与 M1 的解析策略一致）；
  2. 声明了平台渠道但未配置规则包 → "研究边界声明了第三方平台渠道（…），但尚未激活渠道规则包"；
  3. 规则包已激活但缺个别渠道 → "目标平台渠道未包含在已激活的渠道规则包中：…（规则包 {versionId}）"；
- `targetChannels` 为空或只含自有渠道 → 不阻塞（默认配置零成本通过，向后兼容）。

**2. 就绪检查集成（`getGeoResearchWorkspace`）**

- `research_boundary` 检查项接入上述评估：命中阻塞原因时状态置为 blocked，detail 展示具体原因；
- 规则包读取用 try/catch 包裹：`getActiveGeoChannelRulePack()` 抛错（配置非法）时把错误转交评估函数，同样落入 blocked 而非 500；
- 五项检查结构不变，其余检查项（产品身份/资料快照/Provider 就绪/前台采集）逻辑未动。

**3. 测试（[v5-geo-result-pack.test.mjs](../../scripts/v5-geo-result-pack.test.mjs)）**

新增 `target channel rule coverage` 用例，覆盖五条分支：自有渠道不校验、空渠道不校验、平台渠道全覆盖通过、缺规则包阻塞、规则包缺个别渠道（报 xiaohongshu）、配置非法（packError）阻塞。

## 三、行为兼容性

- 未配置规则包 + targetChannels 只含自有渠道（默认形态）：行为与升级前完全一致；
- 未配置规则包 + targetChannels 含平台渠道：由"静默无平台感知"变为"就绪检查 blocked，附修复指引"——这是有意的语义收紧，用户可通过补配规则包或从研究边界移除平台渠道解除；
- 规则包校验只发生在就绪检查（read 路径），不改变 run 创建/任务图/幂等结构。

## 四、验证记录

| 命令 | 结果 |
|---|---|
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run validate:structure` | 537/537 通过 |
| `npm.cmd run test:v5-geo-research` | 14/14 |
| `npm.cmd run test:v5-geo-multi-search` | 20/20 |
| `npm.cmd run test:v5-geo-source-quality` | 4/4 |
| `npm.cmd run test:v5-parallel-geo-monitoring` | 10/10 |
| `npm.cmd run test:v5-website-geo-closed-loop` | 3/3 |
| `npm.cmd run test:v5-product-strategy` | 15/15 |
| `node --import ./workers/typescript-loader.mjs --test scripts/v5-geo-result-pack.test.mjs scripts/v5-geo-probe-compiler.test.mjs` | 全部通过（含 M8 复测探针集、M9 渠道覆盖新测试） |

## 五、P0–P3 全景收束

至此方案九个模块全部落地：

- **P0（平台感知地基）**：M1 渠道规则包、M2 查询编译器扩展（channelKey + 五类查询意图 + 定向补充轮）、M3 平台打标与 channelStats；
- **P1（模型输出与校验）**：M4 任务指令扩展（faqBoard/selectionAlternatives/platformStrategy/contentClusterPlan）、M5 双轨校验（实体命名硬校验 + 平台挂靠/数字门禁软校验）、M6 实体命名表；
- **P2（落地与闭环）**：M7 下游候选扩展（faqBoard/channelDistribution/contentCluster/retestAligned）、M8 提及率 KPI 闭环（mention_baseline 持久化 + post_publish_retest 激活 + delta 归因 + 编排三态周期）；
- **P3（守门）**：M9 就绪检查微调（渠道规则包覆盖校验，自有渠道豁免、平台渠道 fail-closed）。

公理贯彻：唯一 KPI 是 AI 提及率；代码判对错（信任 fail-closed），模型产好坏（软标注），复测 delta 是最终裁判；平台规则全部走受治理的规则包配置，域名与文案不进领域代码。

## 六、遗留事项

- 规则包当前为环境变量驱动（`GEO_CHANNEL_RULE_PACK_JSON`），后续可切换治理存储表 + 人工激活记录（契约字段 `activatedBy/activatedAt` 已预留）；
- `GEO_RETEST_INTERVAL_DAYS` 默认 7 天，可按产品线调优；
- 渠道规则包的 `evidenceCandidateIds` 回填（用调研证据支撑平台收录规则，人工确权后固化）尚无 UI 入口，属后续治理功能。

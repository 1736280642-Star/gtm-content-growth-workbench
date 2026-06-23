# Phase 0 资产审计与开发准备清单

## 1. 阶段结论

Phase 0 的目标是为开发建立可执行输入。本阶段确认：

1. 前端采用 `React / Next.js + Ant Design`。
2. 后端短期采用 `Next.js / Node API + Worker 脚本`。
3. 数据库采用 `MySQL`。
4. 官网博客内容同步由 `XCrawl` 承担。
5. AI Bot 指标 MVP 阶段使用 `Demo CSV / 模拟日志`，后续接入 `Nginx/CDN access log`。
6. GEO 测试使用 `DeepSeek / 豆包 / ChatGPT` 三个平台 API。

## 2. 可迁移资产

| 来源 | 资产 | Phase 处理方式 |
|---|---|---|
| GEOFlow | 品牌事实库 | P0 迁移，作为最高可信事实源 |
| GEOFlow | 唯客产品知识库 | P0 迁移，作为最高可信事实源 |
| GEOFlow | 官网博客知识库 | P0 迁移/同步，作为高可信内容资产 |
| GEOFlow | 竞品知识库 | P1 迁移，只用于对比、差异化和市场分析 |
| GEOFlow | AI/API/Prompt 配置 | P0 迁移为工作台 AI 配置中心 |
| GEOFlow | TrafficClassifier | P1 迁移为 AI Bot user-agent 识别逻辑 |
| GEO SEO | 渠道分发规则 | P0 迁移为渠道规则库 |
| GEO SEO | 历史选题与文章生产库 | P0 迁移为去重与选题参考库 |
| XCrawl | 官网博客采集脚本 | P0 封装为 Worker |
| GEO Citation Monitor | GEO 测试 Prompt | P0 迁移为 GEO 测试 Prompt 组 |
| 原信源站 | 内容资产 | P2 作为低可信参考语料，不作为模块 |

## 3. 知识库分级

| 知识库 | 可信等级 | 默认调用范围 |
|---|---|---|
| 品牌事实库 | 最高 | 所有 JOTO 品牌相关任务 |
| 唯客产品知识库 | 最高 | 所有唯客 AI 护栏相关任务 |
| 官网博客知识库 | 高 | 选题、生成、诊断、补强建议 |
| 历史渠道文章库 | 中 | 去重、标题参考、风格参考 |
| 竞品知识库 | 参考 | 仅对比类、差异化选题、市场分析 |
| 信源站内容资产 | 低-中 | 仅参考，不作为事实源 |

## 4. 首批渠道

| 渠道 key | 渠道名称 | 主要用途 |
|---|---|---|
| wechat | 公众号 | 品牌观点、业务场景、认知文章 |
| csdn | CSDN | 技术解释、部署、安全治理 |
| juejin | 掘金 | 开发者视角、工程实践 |
| zhihu_toutiao_general | 知乎/头条通用稿 | 问题回答、场景解释、搜索型内容 |

## 5. AI Provider 配置项

| Provider | 用途 | 必要配置 |
|---|---|---|
| OpenAI / ChatGPT | GEO 测试、内容生成可选 | base_url、api_key、model |
| DeepSeek | GEO 测试、内容生成可选 | base_url、api_key、model |
| 豆包 | GEO 测试 | base_url、api_key、model |

密钥不写入文档和代码，后续通过环境变量或配置中心管理。

## 6. Demo 日志 CSV 字段

| 字段 | 说明 |
|---|---|
| timestamp | 访问时间 |
| path | 被访问路径 |
| status_code | HTTP 状态码 |
| user_agent | 访问者 user-agent |
| referrer | 来源 |
| ip | IP |
| source_type | manual_demo / simulated / nginx_log / cdn_log |

## 7. 开发边界

MVP 不做：

1. 官网博客创作主流程。
2. 原信源站模块。
3. 全渠道自动发布。
4. 完整 CRM。
5. 复杂权限系统。
6. 复杂 BI 看板。
7. 多产品矩阵。


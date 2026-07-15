# JOTO GTM 内容增长工作台

JOTO GTM 内容增长工作台是一个本地化的内容增长工作台，用来支持 JOTO 相关内容的月度规划、正文生产、发布执行、数据回传、GEO 诊断和周期复盘。

V5 UI 分支采用局部替换：V5 已重构的内容生产主流程按月度矩阵标准呈现，V5 未涉及的知识库、AI 配置、GEO 测试、博客监控、真实接入、工作台设置和数据回传继续保持 V4 页面与功能。

```text
月度内容矩阵 -> 批量生成与人工排程 -> 当日执行 -> 月度复盘
```

当前 V5 配置、策略、生成、排程和复盘仍是明确标注的 `demo / mock` UI 契约；未接入真实 V5 后端前，不能作为生产数据或真实发布结果。

## 项目定位

这个工作台同时服务两个目标：

1. 短期目标：支持 JOTO 内容推广、发布执行和线索获取。
2. 长期目标：把重复出现的内容增长工作沉淀为可复用的流程、Prompt、清单和规则。

它不是单纯的文章生成器。文章只是中间产物，真正要解决的是内容增长工作里最容易断掉的几个环节：

1. 选题和业务目标脱节。
2. 正文生成后缺少质检和人工确认。
3. 发布完成后 URL 和数据没有回填。
4. 博客、GEO、AI Bot 数据没有进入下周计划。
5. 周报只做总结，没有反哺下一轮执行。

## V5 覆盖边界

V5 只替换已经重构的内容生产职责，不把整个工作台升级成另一套系统。

| 模块 | 当前职责 |
| --- | --- |
| 首页 | 区分 V5 月度 mock 与现有 V4 运行态，提供统一入口 |
| 月度内容矩阵 | 配置月度目标、审核策略包、确认矩阵准备度 |
| 批量生成中心 | 标题确认、Final Evidence Gate、生成质检、异常处理和人工排程 |
| 当日执行 | 只查看昨日、今日、明日的发布状态和失败接管 |
| 月度复盘 | 按蒸馏词和产品回看 GEO 结果与下月候选 |
| 数据回传 | 导入或手动补录渠道阅读、点赞、线索等指标 |
| 博客监控 | 诊断官网博客 SEO/GEO 准备度，并生成候选主题 |
| GEO 测试 | 按平台、Prompt 组、蒸馏词和引用层级诊断 AI 搜索可见性 |
| 知识库、AI 配置、设置、真实接入 | 保持 V4 原有页面和功能，不纳入 V5 UI 重构 |

## 主流程

1. 在 `月度内容矩阵` 配置月度目标并审核策略包。
2. 在 `批量生成中心` 确认标题、证据准入、生成质检、异常和人工排程。
3. 在 `当日执行` 查看发布状态并处理失败或人工接管。
4. 在 `数据回传` 继续使用 V4 渠道指标导入和补录能力。
5. 在 `博客监控` 和 `GEO 测试` 继续使用 V4 诊断与候选处理能力。
6. 在 `月度复盘` 回看蒸馏词、baseline / exploration 和下月候选调整。

旧 `/weekly-plan`、`/today`、`/weekly-report` 路由仍保留用于迁移回归，但不再作为 V5 主导航入口。

## 本地启动

安装依赖：

```powershell
npm install
```

启动本地开发服务：

```powershell
npm run dev -- --hostname 127.0.0.1 --port 3047
```

打开：

```text
http://127.0.0.1:3047
```

当前技术栈：

- Next.js 14
- React 18
- Ant Design
- 本地 JSON 状态，用于当前 Demo 和本地试运行
- MySQL 脚本预留，用于后续生产级持久化

## 验证命令

常用验证命令：

```powershell
npm run typecheck
npm run validate:structure
npm run smoke:interactions
npm run smoke:pages -- --base-url=http://127.0.0.1:3047
npm run smoke:workflow
npm run smoke:workflow:isolated
npm run smoke:browser
npm run smoke:browser:roles
npm run smoke:browser:content
npm run smoke:browser:content:isolated
npm run smoke:browser:responsive
npm run smoke:browser:v5
npm run smoke:browser:publish
npm run build
```

其中默认 `smoke:workflow` 和 `smoke:browser*` 都使用隔离状态文件，不写入 `data/workbench-state.json`，避免 Smoke / Browser Smoke 验收资料污染主工作台。只有显式运行 `smoke:workflow:main` 或 `smoke:browser:*:main` 时才会写入当前主状态。

`smoke:browser` 是完整真实浏览器入口；如果只验证某个阶段，可以使用分段入口：

- `smoke:browser:roles`：角色受限态与普通业务页字段边界。
- `smoke:browser:content`：周计划、今日 Brief、规则包、蒸馏词、GEO 缺口和周报建议的浏览器链路；默认写入隔离状态文件。
- `smoke:browser:content:isolated`：同样使用独立状态文件运行 content 浏览器链路，保留为兼容入口。
- `smoke:browser:responsive`：周计划展开、草稿质检、周报抽屉和 GEO 详情的移动端 DOM 验收。
- `smoke:browser:v5`：V5 月度内容矩阵、配置弹窗、批量生成、当日执行和月度复盘的桌面/移动端专项验收。
- `smoke:browser:publish`：今日发布确认、URL 回填和状态刷新。

当前已完成以下验证：

- TypeScript 类型检查
- 结构契约检查
- 页面交互契约 smoke
- 页面和 API smoke
- 主流程 workflow smoke
- 浏览器真实点击 smoke
- Next.js 生产构建

## GitHub 文档上传规则

当前仓库只允许上传以下文档：

1. `docs/usage.md`
2. `docs/方案与规划/*.md`

其他内部阶段状态、开发过程、runbook、复盘记录和临时说明文档默认只保留在本地，不上传到 GitHub。

这一规则已经写入 `.gitignore`。

## 不应提交的文件

以下文件不应提交到 GitHub：

- `.env`
- `.env.local`
- `data/workbench-state.json`
- `.next/`
- `node_modules/`
- 日志文件
- 构建缓存

不要提交 API Key、Token、私有链接、真实客户数据或其他敏感信息。

## 当前仍待真实接入的部分

V3 已完成主要本地流程和页面职责改造，后续真实接入重点包括：

1. 完整 MySQL CRUD repository。
2. 真实 AI Provider 密钥配置。
3. 真实知识库 URL 抓取配置：`XCRAWL_API_KEY` 或 `KNOWLEDGE_PROXY_FETCH_BASE_URL`。
4. XCrawl 博客数据源配置。
5. Nginx/CDN 固定日志路径配置。
6. 平台草稿真实接入：已提供微信公众号草稿 bridge 最短路径，仍需在本机配置公众号 AppID、AppSecret 和封面 `media_id` 后验收；CSDN、掘金、知乎按平台逐个补 adapter。
7. 渠道平台导出模板规范化。
8. 系统级定时调度，例如 Windows Task Scheduler、cron 或生产队列。

## 更多使用说明

本地试运行流程、Pipeline、诊断页面和验证命令说明见：

```text
docs/usage.md
```

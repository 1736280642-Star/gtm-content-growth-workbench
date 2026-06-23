# JOTO GTM Content Workbench

本目录用于沉淀 JOTO GTM 内容工作台的产品规划、需求文档、流程设计、开发说明和后续复盘。

## 1. Project Positioning

JOTO GTM 内容工作台不是单纯的 AI 写作工具，也不是继续做深一个通用 GEO 系统。

它的 MVP 目标是服务 JOTO 当前真实的市场内容工作：

1. 自动化生成渠道文章选题与内容。
2. 支持人工确认终稿后进入发布队列。
3. 对官网博客进行 SEO、GEO、AI Bot、AI 引用测试等监控与诊断。
4. 将渠道数据与官网博客诊断结果反哺下一周选题。
5. 为后续接入官网博客创作模块预留入口。

## 2. Current MVP Scope

MVP 阶段聚焦两个对象：

1. JOTO 官方品牌传播。
2. 唯客 AI 护栏单一产品内容自动化。

当前阶段不把官网博客创作作为主流程。官网博客只做监控、分析判断和优化建议；后续可从博客候选池进入“博客创作任务”模块。

## 3. Document Index

| 文档 | 用途 |
|---|---|
| `MVP-PRD1.md` | MVP 方向版 PRD，说明项目背景、目标、范围、流程、迁移资产和成功指标 |
| `PRD2.md` | 工程开发前 PRD，说明页面、数据结构、接口、字段、开发边界和验收标准 |
| `design/low-fi-prototype.md` | MVP 低保真原型，说明页面线框、主流程、状态和关键交互 |
| `docs/development-plan.md` | 开发计划说明，包含技术审查、选型清单、开发阶段和阶段验收标准 |
| `docs/development-task-list.md` | 开发任务清单，按 Phase 0~7 拆解具体任务、交付物和验收标准 |
| `docs/development.md` | 本地开发说明，包含启动、环境变量、数据库和 Worker 说明 |
| `docs/usage.md` | 本地试运行使用说明，包含启动、主流程、Pipeline、诊断和验证命令 |
| `docs/phase7-runbook.md` | Phase 7 试运行、真实接入任务和缺配置清单 |
| `docs/phase-status.md` | Phase 0~6 当前完成状态与真实接入缺口 |
| `docs/phase0-6-verification.md` | Phase 0~6 结构验收记录，包含验证命令、通过结果和生产级接入缺口 |

## 4. Directory Usage Rules

后续建议按以下方式扩展：

1. `prd/`: 存放不同版本 PRD。
2. `design/`: 存放信息架构、页面流程、原型说明。
3. `docs/`: 存放开发说明、部署说明、配置说明。
4. `workflow/`: 存放自动化内容生产流程、SOP、Prompt、检查清单。
5. `review/`: 存放阶段复盘、问题记录、迭代建议。

当前先保持最小结构，避免在 MVP 方向尚未完全验证前过度设计。

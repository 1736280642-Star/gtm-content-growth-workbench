# Vercel 演示模式（vercel-demo 分支）

本分支在 JOTO GTM 工作台之上叠加了一层「演示适配层」，让整套产品在无
MySQL / OpenSearch / 真实 API Key / 真实邮件投递的情况下，也能以「已接入真实
数据」的形态跑起来，用于 Vercel 演示。

## 开启方式

- 服务端：`DEMO_MODE=true`
- 客户端角标 / 一键演示登录按钮：`NEXT_PUBLIC_DEMO_MODE=true`

本地运行：`set DEMO_MODE=true && set NEXT_PUBLIC_DEMO_MODE=true && npm.cmd run dev`

## 演示行为

| 维度 | 演示行为 |
| --- | --- |
| 存储 | 内存 DemoStore，冷启动从打包 fixtures 重放；可交互但冷启动重置 |
| 邮箱 | 内存收件箱，不真实投递；`GET /api/demo/outbox` 可查看 |
| 托管登录 | 固定验证码 `000000` + 登录页「一键演示登录」 |
| 外部 API | 各 provider 边界短路为仿真成功数据（AI、Embedding、MySQL 治理等） |
| 数据 | fixtures 覆盖主工作台 / 月度计划 / 复盘 / 知识库 / 自由生产等模块 |

## 目录结构

```text
src/lib/demo/
  config.ts                 # isDemoMode() / 固定验证码 / 演示月份 / 延迟
  store.ts                  # 内存 store（globalThis 挂载）
  providers.ts              # 仿真 AI 正文 / embedding 向量
  email.ts                  # 内存收件箱
  fixtures/                 # 打包进 bundle 的种子数据（非运行时 fs 读取）
  repositories/             # （主仓 demo 实现在 ../repositories/demo.ts）
```

## 约束

- `src/lib/demo/` 只承载演示适配层，不得引入业务领域逻辑。
- mock UI 数据与产品名只允许出现在 fixtures 中，不得写进 `src/lib/v5`。
- 演示路径下禁止任何 `fs.readFile(process.cwd(), ...)` 与 `execFileSync`，
  以保证 Vercel 只读运行时可用。
- 演示写入在 serverless 冷启动后重置，不代表持久化能力。

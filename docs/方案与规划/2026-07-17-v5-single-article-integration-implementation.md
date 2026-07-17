# V5 Pharaoh Command 单篇正式正文集成实施与复盘

日期：2026-07-17
分支：`codex/v5-single-article-integration`
状态：代码与本地静态验收已完成，真实运行状态为 `pending_config`

## 1. 结论

本轮已经在不修改父进程 RAG 核心检索实现、不删除 V4 表和不读取密钥值的前提下，补齐 1 个 Pharaoh Command 正式矩阵项到 Markdown DraftVersion 的集成链路：

```text
正式矩阵项
-> active production_public IndexSnapshot
-> RetrievalRun
-> 不可变 Final EvidencePack
-> 正文 Provider
-> 硬规则与 8 条事实追溯
-> MySQL GenerationRun / DraftVersion
-> 批量生成中心查看正文
```

当前独立环境没有 MySQL、OpenSearch、Embedding 和正式正文 Provider 配置，因此不能宣称真实 E2E 已通过，也不能创建伪造 Manifest、Snapshot、EvidencePack 或正文。

## 2. 实现范围

- 新增加法迁移 `20260717_010_v5_single_article_production.sql`，保存 Prompt Group、ChannelRule、幂等操作、GenerationRun 和 DraftVersion。
- 新增幂等 Bootstrap，只创建一个正式 Pharaoh Command 月度计划、矩阵版本和矩阵项。
- 新增 `POST /api/v5/content-tasks/:taskId/prepare-and-generate`。
- 新增 MySQL 正式生产队列 Repository，并在 MySQL 已配置时优先显示正式任务。
- 新增 `GET /api/v5/drafts/:id` 和 `/v5/drafts/:id` 页面。
- 保留 V4 页面、API、JSON 状态与现有内容生成链路。
- 整月批量、图片、HTML、自动发布、完整 Eval Runner 和 Workflow Agent 不在本轮范围。

## 3. 核心实现逻辑

### 3.1 Bootstrap

Bootstrap 只接受人工确认的 Pharaoh Command 产品、active 规则包、approved Manifest、active Snapshot 和 G6 月度生产准入。标题从 Manifest 内 A1/A2 官网 ProductClaim 选择，不手工编造能力。Prompt Group、ChannelRule 和矩阵项都使用稳定 ID，并在插入后重新读取验证绑定，避免 `ON DUPLICATE KEY` 把唯一键冲突伪装成成功。

### 3.2 幂等与审计

请求进入后先写入 `single_article_operation`，唯一键为 `task_id + idempotency_key`。同一键重复请求只返回原 GenerationRun 和 DraftVersion，不重新执行 Retrieval 或正文生成。操作 ID 同时作为 correlation ID，GenerationRun、DraftVersion 和审计事件均保留操作者与原因。

### 3.3 RAG 与版本保护

编排只调用父进程现有 RAG Service。Final EvidencePack 创建后，再次核对：

- 当前矩阵任务 ID 与任务版本。
- RulePackage、Prompt Group、Prompt Group Version 和 ChannelRule Version。
- 唯一 active IndexSnapshot。

任一版本不一致都会在调用正文 Provider 前阻断。

### 3.4 正式正文与事实追溯

Provider 必须返回结构化 `markdown + factTraces`。服务端确定性校验冻结标题、Markdown 分节、禁止表达、至少 8 个完整事实句、EvidenceItem/Claim/SourceRevision 映射，以及至少一条限制或人工边界事实。只有全部通过才写入 `testOnly=false` DraftVersion，并将 `copyAllowed` 设为 `true`。

### 3.5 页面读取

批量生成中心只对正式 MySQL 矩阵项开放单篇“生成正文”。生成期间禁用重复操作；失败时展示原因和下一步；成功后进入正式 Draft 页面。页面不展示完整 Prompt、Embedding、Provider 原始响应或密钥。

## 4. 关键踩坑与底层原因

### 4.1 EvidencePreview 导致任务版本漂移

父进程 `createEvidencePreview()` 会更新矩阵项并递增版本。若编排顺序为 `Retrieval -> EvidencePreview -> Final EvidencePack`，RetrievalRequest 仍绑定旧版本，Final EvidencePack 会因版本不一致而必然失败。

本轮修正为：

```text
Retrieval -> Final EvidencePack
```

目标验收并未要求持久化 EvidencePreview；Final EvidencePack 已包含证据、缺口、冲突和决策。该修正不需要修改父进程 RAG 核心代码，也避免重复检索。

### 4.2 文本契约测试不能证明真实 SQL 与版本语义

原契约测试可以证明文件和关键调用存在，但无法发现 Preview 导致的版本漂移，也无法证明 8 条事实能回到数据库中的 Claim 和原文。验收脚本因此增加了 ProductClaim、SourceRevision、原文引用、Markdown 原句、关联 ID、操作者和审计原因回查。

### 4.3 唯一键冲突不能静默视为幂等成功

Bootstrap 的 `ON DUPLICATE KEY UPDATE id = id` 只能防重复写，不能证明冲突记录就是目标记录。现在每个正式绑定都会插入后回读校验；已有冲突时明确失败并给出下一步。

### 4.4 Windows 绝对状态路径不能使用 `path.join`

独立浏览器验收需要把 `WORKBENCH_STATE_PATH` 指向临时目录。原 Repository 使用 `path.join(cwd, absolutePath)`，会在 Windows 上错误拼成 `worktree/C:/...`。现已改为 `path.resolve`：相对路径仍相对项目根解析，绝对路径则保持原位置，从而可以真正隔离运行态而不写父工作区。

### 4.5 页面存在不等于角色可访问

浏览器验收发现 `/batch-generation` 虽然已经登记路由标签，却没有加入任何角色的可见路由，导致正式功能永远被权限页拦截。现在工作台运营和开发管理员可以访问月度矩阵、批量生成、当日执行、月度复盘和正式 Draft 子页；动态 Draft 路由通过父路径继承权限。

### 4.6 移动端全宽导航会遮蔽首屏任务状态

原移动 CSS 将侧栏改为 100% 宽，但菜单默认完整展开，390px 视口进入批量生成中心时只能看到导航，核心状态被推到首屏之后。现在移动端首次加载自动收起菜单，用户点击导航后也会再次收起，同时保留展开按钮。

## 5. 对使用者的影响

- 使用者只需在批量生成中心点击一次，不需要手工选择 Snapshot、Manifest、Prompt 或规则版本。
- 证据不足、配置缺失、版本漂移和 Provider 失败都会显示真实原因，不会出现伪成功正文。
- 同一幂等键重试不会新增 Draft。
- 正文页面可直接核对事实追溯与硬规则结果，只有通过后才能复制 Markdown。
- V4 原有执行入口仍保持可用。

## 6. 已完成验证

- `npm.cmd run typecheck`
- `npm.cmd run test:v5-single-article:contracts`：4/4
- `npm.cmd run test:v5-rag`：18/18
- `npm.cmd run validate:structure`：257/257
- `npm.cmd run smoke:interactions`：66/66
- `npm.cmd run build`
- `node scripts/init-v5-monthly-schema.mjs --plan`：包含 `010`，排除 V4 Drop migration

Build 仍报告 `today` 和 `weekly-plan` 的既有 React Hook warning；本轮没有修改这两个 V4 页面。

## 7. 真实 E2E 剩余条件

以下条件缺一不可：

- 独立 MySQL 配置与已执行迁移。
- Pharaoh Command Source Import、人工确认 ProductClaim 和 active RulePackage。
- approved Manifest 与 active `production_public` IndexSnapshot。
- OpenSearch 与真实 Embedding Provider。
- 正式正文 Provider。
- 可信服务端操作者配置。

配置完成后执行：

```powershell
node scripts/init-v5-monthly-schema.mjs --plan
node scripts/init-v5-monthly-schema.mjs
npm.cmd run script:v5-single-article:bootstrap
npm.cmd run dev -- --hostname 127.0.0.1 --port 3077
npm.cmd run test:v5-single-article -- --base-url=http://127.0.0.1:3077
```

验收通过后再执行完整 V4 smoke、敏感信息扫描、提交、推送分支和创建 GitHub PR。

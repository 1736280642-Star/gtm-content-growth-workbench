# JOTO GTM 内容工作台使用说明

## 1. 文档定位

本文档是 JOTO GTM 内容工作台当前版本的使用说明，用于记录本地启动、配置诊断、核心流程、验证命令和常见问题处理方式。

它面向工作台的日常使用者和交接维护者，不承担 PRD、改造方案或开发计划职责。

## 2. 当前结论

当前版本按 V4 工作流边界继续收敛：周计划只做标题级计划预览，今日发布负责批量生成、确认发布和 URL 回填，草稿预览负责人工修改与 AI 二次质检，数据回传只负责渠道指标导入。博客监控优先展示诊断，周度复盘展示指标、图表和蒸馏词矩阵。知识库已拆成列表、内容导入、详情编辑、切片向量化和产品表达规则包维护等子页面，避免把导入、编辑和治理动作塞进同一个抽屉。

在 V5 月度页面分支中，月度内容矩阵是后续唯一月度计划真源。V5 生产界面收敛为：`月度内容矩阵 -> 批量生成与人工排程 -> 当日执行 -> 数据回传`。内容策略包的创建、配置、生产预检和批准全部在月度内容矩阵完成；批量生成中心位于其子路由，只保留“内容”和“排程”两个页签。

用户只配置目标问题、内容类型、每渠道配额、渠道、产品表达规则包和知识库。内容类型统一承载类型语义、结构、CTA、篇幅、风格、证据偏好和渠道提示；用户可在 `/monthly-matrix/content-types` 创建、复制、编辑新版本和停用类型。月度策略在 `/monthly-matrix/strategy` 通过 AI 多标签语义匹配给出推荐理由，用户接受、排除或手动加入后冻结内容类型版本与 Prompt 约束快照。Provider 未配置时显示 `pending_config`，仍可走人工选择路径。渠道成品数按每个渠道分别计算，例如官网和知乎各 4 篇等于 8 篇渠道成品。系统在后台承担事实依据、公开范围、禁止表达、结构和渠道适配检查，并自动修复或恢复技术失败；语义匹配不能绕过 Evidence Gate。只有缺少文章主题成立所需关键事实时才显示“待补资料”并打开知识库待处理事项。正文从任务行抽屉预览和按需编辑，不再使用独立正文导航页。

它还不是生产级最终版本。真实 MySQL、AI Provider、XCrawl、Nginx/CDN 日志和渠道导出模板仍需要补齐外部配置后逐项验收。

## 2. 启动本地工作台

```powershell
cd D:\GTM\工作台
npm.cmd install
npm.cmd run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

如需固定本地端口：

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3047
```

## 3. 推荐试用顺序

### 3.1 V5 月度生产 UI

当前页面是“月度策略与矩阵持久化 + 单篇正式生产链路”的独立开发阶段。问题版本、知识快照和表达预设暂时通过现有正式接口适配；分支一合入 `main` 后必须重新对齐正式契约。缺少 MySQL 或正式 Provider 时显示 `pending_config`，不会生成演示正文冒充真实结果。

1. 打开首页数据看板，区分 V5 月度生产 mock 与现有数据回传、博客监控运行态。
2. 进入“月度内容矩阵”，配置月度目标、目标问题、文章类型、每渠道配额、规则包、知识库和表达预设，运行生产预检后批准策略。
3. 从月度内容矩阵进入“批量生成中心”，查看内容生产状态、正文抽屉和人工排程；页面不提供质检或异常处理待办。
4. 进入“当日执行”，按昨日、今日、明日查看发布状态和失败接管。
5. 进入“月度复盘”，查看蒸馏词发布完成度、证据问题和下月候选。

### 3.2 V5 Pharaoh Command 单篇正式正文

该链路只验收 1 个正式矩阵项，不开放整月批量生成、自动排程或发布。运行前必须已经存在人工批准的规则包、approved Manifest 和 active `production_public` IndexSnapshot。

推荐在独立 worktree、数据库、OpenSearch 索引前缀和端口中执行：

```powershell
node scripts/init-v5-monthly-schema.mjs --plan
node scripts/init-v5-monthly-schema.mjs
npm.cmd run script:v5-single-article:bootstrap
npm.cmd run dev -- --hostname 127.0.0.1 --port 3077
npm.cmd run test:v5-single-article -- --base-url=http://127.0.0.1:3077
```

操作流程：

1. 打开 `http://127.0.0.1:3077/monthly-matrix/batch-generation`。
2. 确认页面只显示 1 个带正式状态的 Pharaoh Command 矩阵项。
3. 点击“生成正文”；系统使用一个幂等键依次执行 Retrieval、冻结 Final EvidencePack、调用正式正文 Provider，并将 `testOnly=false` 的 GenerationRun 和 DraftVersion 写入 MySQL。
4. 若 EvidencePack 不是 `generatable`，系统立即阻断且不调用正文 Provider，并展示失败原因和下一步。
5. 成功后从任务行点击“预览正文”，在抽屉中查看 Markdown 和业务化内容依据；内部规则结果、EvidencePack、Claim 和模型错误不在业务页面展示。

运行边界：

- 不使用 `20260714_002_drop_v4_weekly_tables.sql`，也不得添加 `--include-drop-v4` 或 `--confirm-drop-v4`。
- 不从聊天、日志或文档读取和输出任何密钥值；只允许检查配置项是否存在。
- 缺少 MySQL、OpenSearch、Embedding 或正式正文 Provider 时，结果必须保持 `pending_config`。
- `EvidencePreview` 会改变矩阵项版本，因此该单篇编排直接使用 `Retrieval -> Final EvidencePack`，避免冻结时出现任务版本漂移；父进程 RAG 核心代码保持不变。

### 3.3 V4 保留能力与迁移期真实执行

知识库、AI 配置、博客监控、真实接入、工作台设置和数据回传继续保持 V4 页面与功能。旧周计划、今日发布和周度复盘路由仅用于迁移回归，在真实 V5 后端接通前仍承载现有执行能力。

1. 进入“知识库”，先在列表查看资料状态；点击“导入资料”进入内容导入子页面，按 URL 或文档分别导入。
2. URL 导入支持一行一个 URL，解析为 Markdown 预览后保存为待向量化；文档导入会调用服务端解析器，把 Markdown/TXT、PDF、Word(docx) 转为 Markdown 预览。旧版 `.doc` 需先转换成 `.docx`，不会伪装成已解析正文。
3. 进入知识库“编辑详情”，在详情页内编辑基础信息、追加 URL 或补充文本，并查看内容预览、切片与向量化记录、关联蒸馏词和更新记录。
4. 进入“切片与向量化”，选择待向量化知识库和策略；如果没有真实 Embedding 配置，系统显示 `pending_config`，不会写入伪向量。
5. 进入“产品表达规则包”，从已有知识库生成允许表达、禁止表达和边界提示；草稿必须人工确认后才生效。
6. 进入“工作台设置”，继续维护 V4 默认产品、渠道、知识库和规则包配置。
7. 迁移回归需要真实执行时，直接访问 `/weekly-plan`、`/today` 和 `/weekly-report`，现有接口和数据行为不变。
8. 进入“数据回传”，导入渠道数据表或手动补录阅读、点赞、收藏、评论、分享等指标。
9. 进入“博客监控”，先看诊断摘要、问题分布和优先动作，再看博客明细。

## 4. Pipeline 试跑

Pipeline 入口保留在命令行 Worker 和自动化配置中，用于串联博客同步、日志导入、渠道指标导入和运行记录保存；首页不再提供一次性手动触发按钮。

```powershell
npm.cmd run worker:run-pipeline -- --base-url http://127.0.0.1:3000 --skip-blog --log-file-path data/demo-ai-bot-log.csv --channel-metrics-path imports/channel-metrics-smoke.csv
```

## 5. 数据与状态

当前默认使用本地 JSON 状态：

```text
data/workbench-state.json
```

页面通过以下 API 读取运行态：

```text
GET /api/workbench-state
```

如果运行态同步失败，页面会显示“运行态数据同步失败”提示。关键判断前应先点击“重试”，确认状态已经刷新。

## 6. 配置诊断

推荐先打开“真实接入”或“AI 配置”页面运行诊断。页面只展示配置项名称、缺失字段和状态，不读取或显示密钥值。

```text
GET /api/runtime-config/status
GET /api/config-diagnostics
```

常见状态：

1. `ready`：配置存在且基础检查通过。
2. `pending_config`：缺少必要环境变量或外部路径。
3. `failed`：配置存在，但连接、读取或调用失败。

知识库 URL 抓取现在是独立真实接入项。生产导入建议至少配置下面两类之一：

```text
# 方案 A：XCrawl
XCRAWL_API_KEY=
XCRAWL_BASE_URL=
XCRAWL_TIMEOUT_MS=

# 方案 B：代理抓取服务
KNOWLEDGE_PROXY_FETCH_BASE_URL=
KNOWLEDGE_PROXY_FETCH_API_KEY=
KNOWLEDGE_PROXY_FETCH_TIMEOUT_MS=

# 可选：抓取策略
KNOWLEDGE_CRAWL_PRIMARY_PROVIDER=
KNOWLEDGE_CRAWL_TIMEOUT_MS=
KNOWLEDGE_CRAWL_DOMAIN_DELAY_MS=
KNOWLEDGE_CRAWL_MIN_TEXT_LENGTH=
```

说明：

1. `XCRAWL_API_KEY` 和 `KNOWLEDGE_PROXY_FETCH_BASE_URL` 二选一即可；两者都配置时默认先走 XCrawl，再走代理抓取。
2. `KNOWLEDGE_CRAWL_PRIMARY_PROVIDER` 可填 `xcrawl`、`proxy_fetch` 或 `local_fetch`，用于临时调整主链路。
3. URL 导入执行顺序为：历史缓存 -> XCrawl -> 代理抓取 -> 本地 fetch 兜底。
4. 本地 fetch 只适合作兜底；如果目标站点封锁当前出口 IP，系统会返回 `blocked`，不会把拦截页写入知识库。

### 微信公众号草稿真实接入

平台草稿分发分两层：工作台负责把已确认终稿发送到本机 bridge；bridge 负责调用真实平台接口创建草稿。当前最短路径先接微信公众号草稿箱，只创建草稿，不自动发布。

本机启动真实模式需要：

```text
WECHATSYNC_ENABLED=true
WECHATSYNC_BRIDGE_URL=http://127.0.0.1:9528

WECHAT_MP_APP_ID=
WECHAT_MP_APP_SECRET=
WECHAT_MP_THUMB_MEDIA_ID=
# 或者直接给一张本地封面图路径，由 bridge 自动上传永久素材并使用返回的 media_id
WECHAT_MP_THUMB_IMAGE_PATH=
```

可选配置：

```text
WECHATSYNC_BRIDGE_TOKEN=
WECHAT_MP_AUTHOR=
WECHAT_MP_DIGEST=
WECHAT_MP_CONTENT_SOURCE_URL=
WECHAT_MP_NEED_OPEN_COMMENT=
WECHAT_MP_ONLY_FANS_CAN_COMMENT=
```

获取方式：

1. `WECHAT_MP_APP_ID` 和 `WECHAT_MP_APP_SECRET`：在微信公众号后台的开发配置中获取，不要粘贴到聊天或文档里。
2. `WECHAT_MP_THUMB_MEDIA_ID`：需要先在公众号素材库上传一张永久图片素材，再使用该素材的 `media_id` 作为草稿封面。
3. 更短路径是配置 `WECHAT_MP_THUMB_IMAGE_PATH`，填写本机图片路径；bridge 会调用微信永久素材接口上传图片，自动把返回的 `media_id` 用作草稿封面。
4. 如果公众号后台要求服务器 IP 白名单，需要把当前机器调用微信 API 的公网出口 IP 加入白名单，否则诊断会失败。

启动顺序：

```powershell
cd D:\GTM\工作台
npm.cmd run bridge:wechatsync
```

另一个终端启动工作台真实模式：

```powershell
cd D:\GTM\工作台
$env:WECHATSYNC_ENABLED="true"
$env:WECHATSYNC_BRIDGE_URL="http://127.0.0.1:9528"
npm.cmd run dev -- --hostname 127.0.0.1 --port 3047
```

跑通判断：

1. `GET http://127.0.0.1:9528/status` 返回 `ok=true`，说明本机 bridge 已启动。
2. 真实接入页中“本机平台草稿 Bridge”为就绪。
3. “微信公众号草稿”为就绪后，在今日发布页发送一篇平台草稿。
4. 公众号后台草稿箱出现草稿后，人工预览、发布，再回工作台回填正式 URL。

微信跑通后再逐个接入 CSDN、掘金、知乎。当前 bridge 已补入三类平台草稿 adapter；未配置 Cookie、标签或平台 headers 时应显示 `pending_config` / `auth_required`，不应标记为真实草稿成功。

### CSDN / 掘金 / 知乎草稿 adapter

当前 bridge 已按 `CSDN -> 掘金 -> 知乎` 顺序补入 adapter。三者仍然只创建草稿，不自动发布；如果平台接口或登录态失效，工作台会记录失败原因，发布记录仍保持 `queued`，等待人工处理。

配置顺序建议：

```text
# CSDN
CSDN_COOKIE=
CSDN_DRAFT_API_URL=
CSDN_HEADERS_JSON=
CSDN_DRAFT_PAYLOAD_JSON=
CSDN_TAGS=
CSDN_CATEGORIES=
CSDN_AUTH_CHECK_URL=

# 掘金
JUEJIN_COOKIE=
JUEJIN_TAG_IDS=
JUEJIN_CATEGORY_ID=
JUEJIN_CSRF_TOKEN=
JUEJIN_UUID=
JUEJIN_DRAFT_API_URL=
JUEJIN_DRAFT_API_QUERY=
JUEJIN_HEADERS_JSON=
JUEJIN_DRAFT_PAYLOAD_JSON=
JUEJIN_AUTH_CHECK_URL=

# 知乎
ZHIHU_COOKIE=
ZHIHU_XSRF_TOKEN=
ZHIHU_DRAFT_API_URL=
ZHIHU_DRAFT_PAYLOAD_JSON=
ZHIHU_DRAFT_UPDATE_URL_TEMPLATE=
ZHIHU_DRAFT_UPDATE_PAYLOAD_JSON=
ZHIHU_DRAFT_UPDATE_METHOD=
ZHIHU_HEADERS_JSON=
ZHIHU_AUTH_CHECK_URL=
```

最短路径：

1. CSDN 先只补 `CSDN_COOKIE`，如接口返回鉴权或签名错误，再从浏览器请求里补 `CSDN_HEADERS_JSON` 或覆盖 `CSDN_DRAFT_API_URL`。
2. 掘金至少补 `JUEJIN_COOKIE` 和 `JUEJIN_TAG_IDS`，标签 ID 用英文逗号分隔；分类可先用默认值，后续再补 `JUEJIN_CATEGORY_ID`。
3. 知乎先补 `ZHIHU_COOKIE`，必要时补 `ZHIHU_XSRF_TOKEN`；如果知乎写作接口要求额外风控头，再用 `ZHIHU_HEADERS_JSON` 覆盖。

注意：Cookie、csrf token 和 headers 都属于敏感配置，只写入本机 `.env.local`，不要粘贴到聊天或文档。平台接口如果发生变更，优先通过 `*_DRAFT_API_URL`、`*_HEADERS_JSON`、`*_DRAFT_PAYLOAD_JSON` 做配置覆盖，不先改业务页面。

### P0 正式发布排程

平台草稿分发只代表“写入平台草稿箱”，不代表正式发布。P0 正式发布使用独立排程状态：

完整能力边界、技术方案、四平台字段获取步骤和验收清单见：`docs/方案与规划/P0-自动化发布能力与渠道配置说明书.md`。

```text
POST /api/publish-schedules
POST /api/publish-schedules/[id]/run
POST /api/direct-publish
GET  /api/publish-schedules
```

最小调用示例：

```json
{
  "publishRecordId": "pub-xxx",
  "platforms": ["wechat", "juejin", "csdn", "zhihu"],
  "scheduledAt": "2026-07-09T10:00:00.000Z",
  "matrixItemId": "monthly-matrix-item-placeholder"
}
```

状态口径：

1. `scheduled`：等待执行。
2. `pending_config`：平台正式发布配置缺失。
3. `precheck_failed`：登录态、载荷、平台参数等预检查失败。
4. `publishing`：适配器正在执行。
5. `published_verified`：平台返回正式发布且可验证结果。
6. `published_pending_url`：正式发布已确认，但公开 URL 等待后续 CSV 或人工回填。
7. `pending_verify`：发布动作完成，但平台仍在审核或待验证。
8. `manual_takeover_required`：验证码、手机确认、安全挑战等需要人工处理。
9. `failed`：执行或验证失败。

本地 smoke 默认使用 mock direct publish，只验证排程、适配器合同、状态流转和失败分类，不会写入外部平台。真实模式需要显式配置：

```text
DIRECT_PUBLISH_ENABLED=true
```

真实模式下缺少微信公众号 AppID、AppSecret、封面 media_id，或缺少掘金 / CSDN / 知乎登录态、分类、标签等配置时，系统只返回 `pending_config` / `auth_required` / `manual_takeover_required`，不会伪造平台文章 ID 或公开 URL。

## 7. 本地验证命令

开发或修改后建议按顺序运行：

```powershell
npm.cmd run typecheck
npm.cmd run validate:structure
npm.cmd run build
```

启动本地服务后，可以继续跑 smoke：

```powershell
npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3047
npm.cmd run smoke:interactions
npm.cmd run smoke:browser
npm.cmd run smoke:browser:roles
npm.cmd run smoke:browser:content
npm.cmd run smoke:browser:content:isolated
npm.cmd run smoke:browser:responsive
npm.cmd run smoke:browser:publish
npm.cmd run smoke:browser:v5
npm.cmd run smoke:workflow
npm.cmd run smoke:workflow:isolated
```

说明：

1. `smoke:pages` 检查主要页面、只读 API 和周报 Markdown 导出 API 是否可访问。
2. `smoke:interactions` 检查页面职责合约，包括今日发布、数据回传、GEO 诊断、博客诊断、知识库导入/详情/向量化/规则包和周报矩阵。
3. `smoke:workflow` 默认临时启动独立服务，使用 `data/workbench-smoke-state.json`，不写入主状态 `data/workbench-state.json`；隔离 smoke 默认把 AI Provider 超时收敛到 2 秒，用于验证 fallback 链路，不代表真实生产 Provider 超时配置。
4. `smoke:browser` 使用系统 Chrome 跑完整浏览器验收，默认使用隔离状态文件，不写入主状态。
5. `smoke:browser:roles` 只检查角色受限态和普通业务页字段边界，默认使用隔离状态文件。
6. `smoke:browser:content` 检查周计划、今日 Brief、规则包、蒸馏词、GEO 缺口和周报建议的浏览器链路，默认写入 `data/workbench-browser-smoke-state.json`。
7. `smoke:browser:responsive` 只检查周计划展开、草稿质检、周报抽屉和 GEO 详情的移动端 DOM。
8. `smoke:browser:publish` 只检查今日发布的平台草稿创建、人工发布确认、URL 回填和状态刷新。
9. `smoke:browser:v5` 只检查月度内容矩阵、月度配置弹窗、批量生成中心、当日执行和月度复盘的桌面/移动端 DOM，使用独立状态文件和构建目录。
10. `smoke:workflow:isolated` 保留为兼容入口，与默认 `smoke:workflow` 一样使用隔离状态。
11. 只有显式运行 `smoke:workflow:main` 或 `smoke:browser:*:main` 时，才会写入 `data/workbench-state.json`；日常开发不要使用这些主状态入口。
12. 不要同时运行两个 Next.js dev 服务共用同一个 `.next` 目录；如果需要跑隔离 smoke，先停止当前主服务，验收完成后再重新启动。

## 8. 真实接入还需要什么

1. 除已接入的单篇正式队列、GenerationRun 和 DraftVersion 外，其余完整月度 MySQL CRUD repository。
2. 真实 AI Provider 配置，包括 OpenAI、DeepSeek、豆包的 key 和 model。
3. 真实知识库 URL 抓取链路：XCrawl 或稳定代理抓取服务。
4. Nginx/CDN 日志固定路径与读取权限。
5. 微信、CSDN、掘金、知乎/头条等渠道数据导出模板。
6. Wechatsync 本机 bridge / 浏览器扩展真实连接配置；当前已补微信公众号草稿 bridge，默认 smoke 仍使用本地 mock，不会真实写入外部平台。
7. 系统级定时任务，例如 Windows Task Scheduler、cron 或生产队列。
8. 继续扩展浏览器点击级 smoke，覆盖导入表单、批量选择和更多异常路径。

## 9. 使用风险

1. 本地 JSON 适合单人试运行，不适合多人并发。
2. Demo、imported、real 数据要按页面标签区分，不要把 Demo 指标当作真实策略依据。
3. 缺少真实 AI 配置时，内容生成可以走本地规则 fallback，但 GEO 不会生成假命中结果。
4. 外部配置接入后，要先跑配置诊断和 smoke，再做正式内容判断。
5. 博客、日志、渠道指标导入都会写入本地状态，确认弹窗通过后才会执行。

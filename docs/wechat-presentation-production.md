# 公众号人工选版与自动排版生产链路

## 解决的问题

把微信渠道中已通过正文检查的 V5 `DraftVersion` 转为可审、可追溯、可直接写入微信公众号草稿箱的 HTML。系统负责推荐模板，人工必须选择并确认单篇模板；系统再负责渲染、校验和发布交接。

八个排版样式来自 `GEO SEO/渠道分发/2026-07-12/公众号排版样式预览`。运行时不读取该外部目录，而是把样式语义和微信兼容的内联样式固化在服务端 renderer，避免部署环境依赖个人目录。

## 生产流程

```text
正式 DraftVersion
-> 校验矩阵 channel 必须精确为 wechat
-> 读取内容类型、受众、结构、CTA、已批准图片角色
-> 系统推荐 official / natural 家族内的优先模板
-> 展示 8 个真实模板缩略预览
-> 人工选择并确认模板
-> 记录正文 Hash、推荐结果、人工选择和操作人
-> 服务端渲染微信内联 HTML
-> 安全与结构校验
-> 人工审核最终呈现
-> approved HTML + 封面资产引用
-> Wechatsync bridge 直写公众号草稿箱
```

非 `wechat` 渠道不会显示排版节点，服务端也会返回 `wechat_layout_not_applicable`，避免仅靠前端隐藏造成越权调用。正文修改后会产生新的 `DraftVersion`。发布前同时校验正文 Hash、人工选择、模板版本、HTML 校验状态和最终审核状态，旧选择与旧工件不能继续发布。

## 输入与封面

`GET /api/v5/drafts/:id/wechat-presentation/templates` 返回系统推荐、当前人工选择和 8 个模板预览。`POST /api/v5/drafts/:id/wechat-presentation/selection` 保存人工选择。只有选择成功后，`POST /api/v5/drafts/:id/wechat-presentation` 才会使用正式正文和矩阵元数据生成 HTML。上游配图节点可额外传入：

- `approvedImageRoles`: 已批准正文图片的角色列表，用于记录图文工件输入并支持推荐。
- `coverImageRef`: `media_id:<id>` 或工作台内本地图片路径。

bridge 也兼容环境级 `WECHAT_MP_THUMB_MEDIA_ID` 或 `WECHAT_MP_THUMB_IMAGE_PATH`。为避免服务端请求伪造风险，不直接下载任意远程封面 URL；远程封面需先进入资产服务并取得永久素材 `media_id`。

## 前端节点与人工边界

- `正文草稿`: 查看或编辑正文，保存后自动复检。
- `排版模板`: 系统给出推荐及理由，人工从 8 个模板中选择并明确确认。
- `图文预览`: 仅消费已确认模板，生成 HTML、执行结构校验并完成最终审核。

关键状态：

- `recommendation_unavailable`: 系统没有稳定推荐，但人工仍可查看全部模板并选择。
- `selected`: 人工模板选择已生效；更换后旧选择转为 `superseded`。
- `pending_review`: HTML 校验通过，等待最终呈现审核。
- `approved`: 可写入公众号草稿箱。
- `rejected`: 记录呈现问题，重新选择模板或修订正文后再生成。
- `stale`: 正文 Hash 或模板版本不一致，必须重新选择并生成。

发布采用 `not_sent -> sending -> draft_created/failed`，重复提交已成功工件会返回既有结果，不重复创建草稿。

## 部署与验收

1. 执行 `database/migrations/20260724_011_v5_wechat_presentation.sql`。
2. 配置 V5 服务端身份、Wechatsync bridge、公众号 AppID/AppSecret 和封面素材。
3. 运行 `npm.cmd run test:v5-wechat-presentation`、`npm.cmd run typecheck`、`npm.cmd run validate:structure` 和 `npm.cmd run build`。
4. 分别用微信和非微信渠道正文验证门禁；微信正文依次验证系统推荐、人工选版、手机预览、退回、批准、写入草稿箱和重复提交。

# 公众号自动排版生产链路

## 解决的问题

把已通过正文检查的 V5 `DraftVersion` 转为可审、可追溯、可直接写入微信公众号草稿箱的 HTML。系统负责唯一模板选择，人工不参与单篇模板选择，只确认最终呈现能否发布。

八个排版样式来自 `GEO SEO/渠道分发/2026-07-12/公众号排版样式预览`。运行时不读取该外部目录，而是把样式语义和微信兼容的内联样式固化在服务端 renderer，避免部署环境依赖个人目录。

## 生产流程

```text
正式 DraftVersion
-> 读取内容类型、受众、结构、CTA、已批准图片角色
-> 锁定 official / natural 模板家族
-> 对家族内 active 模板确定性评分
-> 唯一最优模板或 selection_blocked
-> 服务端渲染微信内联 HTML
-> 安全与结构校验
-> 人工只审核最终呈现
-> approved HTML + 封面资产引用
-> Wechatsync bridge 直写公众号草稿箱
```

正文修改后会产生新的 `DraftVersion`。发布前同时校验正文 Hash、HTML 校验状态和人工审核状态，旧工件不能继续发布。

## 输入与封面

`POST /api/v5/drafts/:id/wechat-presentation` 默认直接使用正式正文和矩阵元数据。上游配图节点可额外传入：

- `approvedImageRoles`: 已批准正文图片的角色列表，用于模板评分。
- `coverImageRef`: `media_id:<id>` 或工作台内本地图片路径。

bridge 也兼容环境级 `WECHAT_MP_THUMB_MEDIA_ID` 或 `WECHAT_MP_THUMB_IMAGE_PATH`。为避免服务端请求伪造风险，不直接下载任意远程封面 URL；远程封面需先进入资产服务并取得永久素材 `media_id`。

## 状态与人工边界

- `selection_blocked`: 规则或元数据不足，修正规则后重跑，不让人工挑模板。
- `pending_review`: 自动选版和 HTML 校验通过，等待最终呈现审核。
- `approved`: 可写入公众号草稿箱。
- `rejected`: 记录呈现问题，回到规则治理后重跑。
- `stale`: 正文 Hash 不一致，必须重新生成。

发布采用 `not_sent -> sending -> draft_created/failed`，重复提交已成功工件会返回既有结果，不重复创建草稿。

## 部署与验收

1. 执行 `database/migrations/20260724_011_v5_wechat_presentation.sql`。
2. 配置 V5 服务端身份、Wechatsync bridge、公众号 AppID/AppSecret 和封面素材。
3. 运行 `npm.cmd run test:v5-wechat-presentation`、`npm.cmd run typecheck`、`npm.cmd run validate:structure` 和 `npm.cmd run build`。
4. 用一篇正式正文依次验证自动排版、手机预览、退回、批准、写入草稿箱和重复提交。

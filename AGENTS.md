# AGENTS.md - V5 Backend Integration

## 0. Branch Purpose

This worktree is dedicated to branch `codex/v5-backend-integration`.

Goal: connect the validated V5 monthly UI to explicit API contracts and repository-backed runtime data without changing unrelated V4 capabilities.

The integration branch should deliver backend contracts and real runtime data for:

1. Monthly content matrix.
2. Monthly strategy package review.
3. Batch generation center.
4. Exception queue.
5. Scheduled publish board.
6. Daily execution board.
7. Monthly review.

This branch may implement monthly read models, local JSON persistence, repository adapters and guarded API mutations. It must not implement real external publishing, credentials, full RAG generation or Workflow Agent orchestration unless separately requested.

## 1. Required Context Loading

Before any analysis or implementation, read:

1. `D:/GTM/memory/user_collab.md`
2. `D:/GTM/memory/project_progress.md`
3. `docs/phase-status.md`
4. `docs/usage.md`

If V5 planning docs exist in this worktree, also read:

1. `docs/V5 -07-09/01-重构后影响范围分析.md`
2. `docs/V5 -07-09/02-新版用户流程图.md`
3. `docs/V5 -07-09/03-推荐页面低保真原型图.md`

If these V5 docs are missing, continue with this `AGENTS.md` as the branch truth source and mention the missing docs in the response.

## 2. Core Product Boundary

This branch is responsible for:

1. Typed V5 API request and response contracts.
2. Repository-backed monthly plan, matrix, generation, schedule and review read models.
3. Local JSON persistence as the single-user runtime adapter, with a future MySQL boundary.
4. Guarded mutations with validation, role checks, audit fields and idempotent behavior.
5. Replacing page-local mock imports with API-backed loading, error and empty states.
6. Preserving all V4 pages, APIs and data behavior outside the explicit V5 surface.
7. Chinese business-facing page language and mock/real/pending_config source labels.

This branch is not responsible for:

1. Direct external platform publish adapters.
2. Real platform credentials or secrets.
3. Full RAG / EvidencePack generation.
4. Rule engine or evaluation Runner implementation beyond persisted status contracts.
5. Workflow Agent orchestration.
6. Rewriting unrelated V4 knowledge, AI configuration, GEO, blog or data-return flows.

## 3. Integration Non-Negotiables

1. Do not change unrelated V4 backend business behavior.
2. Do not edit `data/workbench-state.json`.
3. Store V5 runtime data in a dedicated file or repository namespace.
4. Do not make current V4 pages unusable.
5. Do not make page-local mock constants the source of truth after a page is connected.
6. Do not expose internal fields such as full Prompt, model trace, raw model logs, raw answers, raw citation URLs, citation rank, or embedding similarity on business pages.
7. Do not represent seeded, fallback or pending_config data as real data.
8. Every mutation must validate input, check role permission and return an actionable business error.

Use clear labels:

```text
demo
mock
pending_config
待接入
```

## 4. Recommended Integration Scope

Primary pages to connect:

```text
src/app/monthly-matrix/page.tsx
src/app/monthly-strategy/page.tsx
src/app/batch-generation/page.tsx
src/app/exceptions/page.tsx
src/app/publish-schedule/page.tsx
src/app/daily-execution/page.tsx
src/app/monthly-review/page.tsx
```

Presentational components should remain prop-driven:

```text
src/components/MonthlyMatrixTable.tsx
src/components/EvidenceGateTag.tsx
src/components/PublishStatusTag.tsx
src/components/ExceptionQueuePreview.tsx
src/components/ScheduleCalendarLite.tsx
src/components/V5StatusRail.tsx
```

Safe to modify carefully:

```text
src/components/AppShell.tsx
src/components/PageHeader.tsx
src/components/MetricCard.tsx
src/app/globals.css
src/app/page.tsx
```

Modify shared V4 files only when a V5 adapter cannot be isolated. Prefer new files under:

```text
src/lib/v5/*
src/app/api/v5/*
data/v5-*.json
```

Do not modify `src/lib/types.ts`, `src/lib/workbench-store.ts`, existing V4 routes or `data/workbench-state.json` unless the user explicitly approves a cross-version migration.

## 5. Required V5 Information Architecture

The V5 main flow is monthly, not weekly:

```text
monthly goal
-> monthly strategy package
-> monthly content matrix
-> batch generation
-> exception queue
-> scheduled publish board
-> daily execution
-> monthly review
```

Weekly plan and today publish remain execution views, not the V5 primary planning model.

UI should make this clear:

1. `月度内容矩阵` is the primary V5 planning entry.
2. `当日执行` is only a daily operational board.
3. `定时发布排程` is separate from content generation.
4. `异常队列` is where humans make judgment calls.
5. `AI 配置 / 治理日志` is for internal operations, not ordinary publishing users.

## 6. Page-Level Goals

### 6.1 Monthly Content Matrix

Show:

1. Month.
2. Monthly goal.
3. Product quota.
4. Channel mix.
5. Evidence Gate status per item.
6. Matrix status.
7. Disabled actions for future backend integration.

Actions can be visual placeholders:

```text
生成策略包
审核通过
批量生成
```

Use disabled state or mock toast unless backend is explicitly requested.

### 6.2 Monthly Strategy Review

Show:

1. Strategy summary.
2. Product allocation.
3. Channel allocation.
4. Rule package check.
5. Evidence check.
6. Risk summary.

### 6.3 Batch Generation Center

Show:

1. Pending count.
2. Generated count.
3. Passed count.
4. Exception count.
5. Queue table.
6. EvidencePack / rule / evaluation status columns.

### 6.4 Scheduled Publish Board

Show:

1. Scheduled date and time.
2. Platform.
3. Publish status.
4. URL or failure reason placeholder.
5. Manual takeover action placeholder.

Do not implement real publish calls.

### 6.5 Exception Queue

Show:

1. Exception type.
2. Product.
3. Affected item.
4. Reason.
5. Recommended next action.
6. Drawer or panel for handling context.

### 6.6 Daily Execution

Show:

1. Today's scheduled items.
2. Content state.
3. Publish state.
4. Failure handling placeholder.

This page must not become the generation entry.

### 6.7 Monthly Review

Show:

1. Matrix completion rate.
2. Generation success rate.
3. QA pass rate.
4. Publish success rate.
5. Badcase count.
6. Next month recommendations.

## 7. Design Requirements

Use the existing Next.js 14, React 18, Ant Design, and TypeScript patterns.

Style:

1. Business-facing Chinese.
2. Clear, restrained B2B product UI.
3. Information hierarchy before decoration.
4. Dense but readable tables.
5. No marketing-page hero sections.
6. No decorative gradient blobs or ornamental cards.
7. Cards only for repeated items, summaries, modals, and tool surfaces.
8. Do not put cards inside cards.
9. Keep buttons and text responsive; no overlapping text.

Recommended signature element:

```text
Evidence Gate
```

Every monthly matrix item can show one of:

1. `可生成`
2. `缺证据`
3. `规则风险`
4. `待配置`
5. `需人工确认`

## 8. Data Rules

Use mock data only inside UI files or small local mock modules, such as:

```text
src/app/monthly-matrix/mock-data.ts
src/lib/v5-ui-mock-data.ts
```

Mock data must be clearly labeled as mock/demo in UI when it could be mistaken for real data.

Do not write mock data into:

```text
data/workbench-state.json
```

Do not add fake AI hits, fake platform publish success, fake citations, or fake integration health.

## 9. Development Rules

1. Keep UI branch focused on front-end layout and page structure.
2. Prefer presentational components that can later receive real props.
3. Keep existing V4 pages functional.
4. Avoid touching shared domain model files unless absolutely necessary.
5. Do not add broad dependencies for charts or calendars unless the existing Ant Design stack cannot cover the page.
6. Use icons from existing icon library if available.
7. Use `npm.cmd` commands on Windows.

## 10. Validation Requirements

Minimum validation after UI changes:

```powershell
npm.cmd run typecheck
npm.cmd run validate:structure
```

If navigation, routes, or page shell changes:

```powershell
npm.cmd run smoke:interactions
npm.cmd run smoke:pages -- --base-url=http://127.0.0.1:3047
```

If you start a dev server, use port `3047` unless occupied:

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3047
```

Do not run isolated smoke in parallel with a dev server sharing `.next`.

## 11. Completion Criteria

This branch is successful when it provides:

1. A clear V5 monthly navigation surface.
2. Monthly content matrix page shell.
3. Monthly strategy review page shell.
4. Batch generation center page shell.
5. Scheduled publish board page shell.
6. Exception queue page shell.
7. Monthly review page shell.
8. Reusable presentational components.
9. No backend business behavior changes.
10. A future backend can connect without redesigning the front-end information architecture.

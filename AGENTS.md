# JOTO GTM Workbench Rules

## Product Scope

- The V5 workbench uses the calendar month as the only planning and review business cycle.
- The primary flow is `MonthlyPlan -> date execution -> publish and metrics -> MonthlyReview -> next month proposal`.
- JOTO service capabilities for WorkBuddy and Tencent Cloud ADP are the primary promotion focus. Other JOTO products are secondary content topics.

## Naming And Data Rules

- Use `monthly-plan`, `monthly-review`, `MonthlyPlan`, `MonthlyReview`, `monthStart`, `monthEnd`, and `monthlyPlanId` in routes, APIs, code, schemas, tests, and documentation.
- A date or weekday filter may exist only as an execution view under an approved monthly plan. It must not become an independent planning source or review cycle.
- Do not introduce weekly-plan, weekly-report, weekly-review, or equivalent Chinese product wording.
- A monthly plan starts on the first calendar day and ends on the last calendar day of the same month.

## Verification

- Before delivery, run `npm.cmd run typecheck` and `npm.cmd run validate:structure`.
- Search maintained workbench code, documentation, scripts, and state fixtures for obsolete weekly planning or review identifiers.
- External source material under `保存/` is reference content and is not rewritten solely because it contains ordinary mentions of weekly reports.

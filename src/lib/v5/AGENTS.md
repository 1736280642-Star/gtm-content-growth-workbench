# V5 formal domain rules

## Purpose

This directory is the formal V5 domain source for monthly planning, knowledge governance, and product-agnostic content production.

The dependency direction is:

```text
formal contracts
-> resolver / compiler / validator / Repository / Service
-> API or MonthlyWorkspaceReadModel adapter
-> V5 UI
```

## Boundaries

1. `monthly-contracts.ts` and `knowledge-governance-contracts.ts` are domain truth sources.
2. UI read models and API DTOs must use a separate file such as `monthly-workspace-contracts.ts`; do not redefine or replace the formal contracts here.
3. Temporary JSON repositories are adapters only and must not masquerade as the formal MySQL repository.
4. Agent output cannot create human approvals or activate rule packages.
5. Missing config, evidence, approvals, or source snapshots must fail closed.
6. Writes require idempotency, optimistic concurrency, actor identity, audit reason, and source traceability.
7. Do not add pages, components, styles, mock UI data, secrets, or real credentials in this directory.
8. Domain code must not hard-code product names, identity statements, CTA copy, or service URLs.
9. Product facts must enter generation through a traceable evidence pack; prompts are not fact sources.
10. Promotion resolution must be deterministic. Equal-priority ambiguity fails closed.
11. Model self-check is advisory. A deterministic output validator decides whether a draft is usable.
12. Business-rule repair runs at most once. Evidence gaps and rule conflicts are not repairable generation errors.
13. Content production adapters must reuse the formal knowledge and monthly contracts instead of creating a second rule truth source.

## Validation

Run `npm.cmd run typecheck`, `npm.cmd run validate:structure`, and the affected V5-specific Node tests after changing this directory.

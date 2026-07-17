# V5 formal domain rules

## Purpose

This directory is the formal V5 domain source for monthly planning and knowledge governance.

The dependency direction is:

```text
formal contracts
-> Repository / Service
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

## Validation

Run `npm.cmd run typecheck` plus the V5-specific Node test files after changing this directory.

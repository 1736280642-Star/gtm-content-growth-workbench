# V5 formal domain rules

## Purpose

This directory contains product-agnostic V5 domain logic for monthly content production.

Dependency direction:

```text
formal contracts
-> resolver / compiler / validator / service
-> repository or API adapter
-> UI
```

## Boundaries

1. Domain code must not hard-code product names, identity statements, CTA copy, service URLs, secrets, or credentials.
2. Product facts must enter generation through a traceable evidence pack; prompts are not fact sources.
3. Promotion resolution must be deterministic. Equal-priority ambiguity fails closed.
4. Missing evidence, approvals, source snapshots, required promotion configuration, or compatible rule ranges fail closed before model invocation.
5. Model self-check is advisory. A deterministic output validator decides whether a draft is usable.
6. Business-rule repair runs at most once. Evidence gaps and rule conflicts are not repairable generation errors.
7. Writes added later must require idempotency, optimistic concurrency, actor identity, audit reason, and source traceability.
8. Do not add UI components, mock production data, or persistence shortcuts in this directory.

## Validation

Run `npm.cmd run typecheck`, `npm.cmd run validate:structure`, and the V5 content production contract tests after changing this directory.

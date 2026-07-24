# Arcs Local Publish Runner Rules

## Scope

- This directory contains the local browser executor for CSDN, Juejin, and Zhihu formal publishing.
- The runner is an adapter. V5 `PublishSchedule` and `PublishAttempt` remain the business truth source.
- The runner must never implement monthly planning, content generation, or review logic.

## Security

- Bind only to a loopback host.
- Require a non-empty bearer token for every request.
- Store browser profiles and the idempotency ledger outside the repository.
- Never log or return cookies, tokens, local storage, phone numbers, or private account URLs.
- Never bypass CAPTCHA, phone confirmation, or platform security challenges.

## Publishing

- Every write requires `scheduleId`, `platform`, `contentHash`, and a matching `idempotencyKey`.
- A repeated idempotency key returns the stored result and never clicks publish again.
- A browser click is not success. Verify through a public URL or creator-management state.
- Security challenges return `manual_takeover_required` and stop automation.

## Verification

- Run the Python unit tests and the repository TypeScript/structure checks after changes.

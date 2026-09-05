# Demo runtime rules

- Reuse the maintained `src/app` pages, components, styles and API response contracts. Do not add a replacement workbench.
- All fixtures are independently authored synthetic material. Never load production state, environment files, credentials, or company knowledge to build fixtures.
- Keep the monthly business cycle. Dates in scenarios must remain within their calendar month.
- A single state graph owns products, orders, drafts, publication results, notifications and metrics. Projections must agree across pages.
- Mock external execution at the boundary. Missing handlers fail explicitly; never fall through to production or return a generic successful placeholder.
- Mutations must validate inputs, support version checks and idempotency where the original contract uses them, and persist in the current demo session.
- Test all maintained page routes, redirects, dynamic links and significant tabs. Include full email, strategy approval, sample approval and notification preferences.
- Public demo artifacts may reference only synthetic local assets and safe example domains. Never send real emails or publish externally.

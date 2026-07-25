# JOTO Arcs Local Publish Runner

This loopback-only service adapts the Arcs/DrissionPage browser approach for formal publishing to CSDN, Juejin, and Zhihu. V5 remains the source of truth for schedules and attempts.

## Runtime boundary

- The runner binds to `127.0.0.1` by default and rejects non-loopback hosts.
- Every request requires `JOTO_PUBLISH_RUNNER_TOKEN` or `WECHATSYNC_BRIDGE_TOKEN`.
- Each platform uses a separate persistent Chromium profile outside the repository.
- Repeated idempotency keys return the stored result without clicking publish again.
- CAPTCHA, phone confirmation, and security challenges stop with `manual_takeover_required`.

## Setup

```powershell
cd arcs-runner
uv sync
$env:WECHATSYNC_BRIDGE_TOKEN = "set-locally"
uv run python run.py
```

Configure profiles locally when the defaults under `%LOCALAPPDATA%/JotoPublishProfiles` are not suitable:

```text
CSDN_BROWSER_PROFILE_DIR
JUEJIN_BROWSER_PROFILE_DIR
ZHIHU_BROWSER_PROFILE_DIR
```

Platform pages change over time. Selector overrides may be supplied as local JSON through `ARCS_CSDN_SELECTORS_JSON`, `ARCS_JUEJIN_SELECTORS_JSON`, and `ARCS_ZHIHU_SELECTORS_JSON`. Do not commit browser profiles, cookies, selector dumps containing account data, or tokens.

## Acceptance boundary

Passing unit tests proves the local contract, token boundary, idempotency logic, and state mapping. It does not prove a real platform accepted an article. Each platform still requires one approved live test article and public-page verification.

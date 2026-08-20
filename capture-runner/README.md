# V5 Local Capture Runner

Start with `npm.cmd run capture-runner:start` from the repository root. The Runner binds only to `127.0.0.1:17321`, accepts task traffic only from a Chrome extension origin, and forwards sanitized capture packages to the local V5 API.

For normal Windows use, double-click `start-capture-companion.cmd` or run `npm.cmd run capture-companion:start`. The desktop companion keeps the Runner alive, exposes a tray menu, and starts the configured Chrome Profile when Chrome is fully closed. Register or remove per-user startup with `npm.cmd run capture-companion:autostart` and `npm.cmd run capture-companion:autostart:remove`.

Set `V5_CAPTURE_EXTENSION_ID` and `NEXT_PUBLIC_V5_CAPTURE_EXTENSION_ID` to the published extension ID before production use. `V5_CAPTURE_CHROME_PROFILE_DIRECTORY` selects the paired Chrome Profile; its default is `Default`.

It does not store or forward cookies, passwords, tokens, browser storage, autofill data, or private request headers. The Runner does not simulate login and does not bypass consent dialogs, verification challenges, captcha, or platform access controls.

Task failures are written back to the formal capture task. `needs_login` also marks the selected connection as requiring login; `isolation_unverified` records the isolation reason and blocks neutral-baseline evidence.

The Runner targets `http://127.0.0.1:3027` by default. Set `V5_WORKBENCH_BASE_URL` only when the host workbench uses another address.

When the workbench runs in Docker, the Web container reaches this host Runner through `http://host.docker.internal:17321`; `compose.yaml` configures that route automatically.

# V5 Local Capture Runner

Start with `npm.cmd run capture-runner:start` from the repository root. The Runner binds only to `127.0.0.1:17321`, accepts task traffic only from a Chrome extension origin, and forwards sanitized capture packages to the local V5 API.

It does not store or forward cookies, passwords, tokens, browser storage, autofill data, or private request headers. The Runner does not simulate login and does not bypass consent dialogs, verification challenges, captcha, or platform access controls.

The Runner targets `http://127.0.0.1:3027` by default. Set `V5_WORKBENCH_BASE_URL` only when the host workbench uses another address.

When the workbench runs in Docker, the Web container reaches this host Runner through `http://host.docker.internal:17321`; `compose.yaml` configures that route automatically.

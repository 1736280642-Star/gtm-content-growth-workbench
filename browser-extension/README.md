# AI Front Test Browser Companion

Load this directory as an unpacked Chrome Manifest V3 extension after starting the local capture Runner.

The extension is deliberately limited to the official Doubao, DeepSeek, Qwen, ChatGPT web frontends and `http://127.0.0.1:17321/*`. It reads only a task page, masks account and history areas before screenshots, and never reads or sends cookies, passwords, browser storage, autofill data, private request headers, or unrelated tabs.

Supported platform keys and official task-page hosts:

- `doubao`: `https://www.doubao.com/*`
- `deepseek`: `https://chat.deepseek.com/*`
- `chatgpt`: `https://chatgpt.com/*`
- `qwen`: `https://tongyi.aliyun.com/qianwen/*` and `https://chat.qwen.ai/*`

Open the extension popup once to enter the workbench pairing code and bind a user-named AI account connection. A repeatable neutral benchmark must use a dedicated AI account with no prior JOTO history, platform memory/history reference disabled, and no custom instructions. A dedicated Chrome Profile is still recommended for login separation, but it cannot isolate server-side AI memory. The extension never reads or uploads the platform account identifier.

In daily use, click the bound account on the hosted workbench. The page wakes the extension immediately, and the extension creates a non-focused capture window in the same Chrome Profile. The background alarm remains as a recovery poll. Login prompts, consent dialogs, verification challenges, and captcha must be handled by the user; the extension does not bypass platform access controls.

Each leased task opens its platform's official new-conversation URL in a separate non-focused window and closes it after success or failure. Before submitting the prompt, the adapter verifies the connection's isolation policy. A neutral benchmark fails closed when the required new-conversation and dedicated-account attestation, temporary-chat, memory-off, or custom-instructions check is missing. Personalized accounts remain in a separate sample cohort and never count as neutral baseline evidence.

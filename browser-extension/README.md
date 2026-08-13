# AI Front Test Browser Companion

Load this directory as an unpacked Chrome Manifest V3 extension after starting the local capture Runner.

The extension is deliberately limited to the official Doubao, DeepSeek, Qwen, ChatGPT web frontends and `http://127.0.0.1:17321/*`. It reads only a task page, masks account and history areas before screenshots, and never reads or sends cookies, passwords, browser storage, autofill data, private request headers, or unrelated tabs.

Supported platform keys and official task-page hosts:

- `doubao`: `https://www.doubao.com/*`
- `deepseek`: `https://chat.deepseek.com/*`
- `chatgpt`: `https://chatgpt.com/*`
- `qwen`: `https://tongyi.aliyun.com/qianwen/*` and `https://chat.qwen.ai/*`

Click the extension action to poll immediately. The background alarm also polls once per minute. Login prompts, consent dialogs, verification challenges, and captcha must be handled by the user; the extension does not bypass platform access controls.

Each leased task opens its platform's official new-conversation URL in a separate browser tab. The tab is left open after capture for human review. Before submitting the prompt, the adapter rejects any page that already contains an assistant answer, preventing an existing conversation from contaminating formal GEO evidence.

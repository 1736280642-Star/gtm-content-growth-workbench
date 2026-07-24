# AI Front Test Browser Companion

Load this directory as an unpacked Chrome Manifest V3 extension after starting the local capture Runner.

The extension is deliberately limited to `https://chatgpt.com/*` and `http://127.0.0.1:17321/*`. It reads only a user-initiated task page, masks account and history areas before screenshots, and never reads or sends cookies, passwords, browser storage, autofill data, private request headers, or unrelated tabs.

Click the extension action to poll immediately. The background alarm also polls once per minute. Login prompts, consent dialogs, verification challenges, and captcha must be handled by the user; the extension does not bypass platform access controls.

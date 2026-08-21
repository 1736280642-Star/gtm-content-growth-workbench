const statusNode = document.querySelector("#status");
const buttons = Array.from(document.querySelectorAll("button"));

function setStatus(message, error = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", error);
}

async function send(message) {
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "操作失败");
    return response;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

document.querySelector("#pair-device").addEventListener("click", async () => {
  const pairingCode = document.querySelector("#pairing-code").value.trim();
  if (!pairingCode) return setStatus("请输入一次性配对码。", true);
  try {
    await send({ type: "PAIR_DEVICE", pairingCode });
    document.querySelector("#pairing-code").value = "";
    setStatus("设备配对成功，可以继续绑定 AI 账号。");
  } catch (error) { setStatus(error.message, true); }
});

document.querySelector("#bind-account").addEventListener("click", async () => {
  const platform = document.querySelector("#platform").value;
  const accountAlias = document.querySelector("#account-alias").value.trim();
  const dedicated = document.querySelector("#dedicated-account").checked;
  if (!accountAlias) return setStatus("请填写账号连接名称。", true);
  try {
    await send({
      type: "BIND_ACCOUNT",
      platform,
      accountAlias,
      browserProfileSlot: "default",
      isolationPolicy: dedicated
        ? { mode: "dedicated_account", benchmarkCohort: "neutral_benchmark", requiredChecks: ["new_conversation", "dedicated_account", "memory_off", "custom_instructions_off"] }
        : { mode: "new_conversation_only", benchmarkCohort: "personalized_user_sample", requiredChecks: ["new_conversation"] }
    });
    setStatus("账号连接已绑定。返回托管页后，点击该账号即可自动发送测试问题。");
  } catch (error) { setStatus(error.message, true); }
});

document.querySelector("#poll-now").addEventListener("click", async () => {
  try { await send({ type: "POLL_NOW" }); setStatus("已检查任务队列。"); }
  catch (error) { setStatus(error.message, true); }
});

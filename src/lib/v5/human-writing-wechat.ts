export const HUMAN_WRITING_WECHAT_PROFILE_VERSION = "human-writing.wechat.v1.1.0";

export const HUMAN_WRITING_WECHAT_DIRECTIVES = [
  "按非虚构中文长文处理。先确认材料能否托住篇幅，事实、数字、引语和产品能力只能来自已提供且可追溯的材料。",
  "材料不足时缩短正文或收窄问题，不得用假案例、想象现场、重复解释或常识推演填充篇幅。",
  "开头尽快碰到具体业务问题。每个新段落都要增加事实、动作、区别、条件或后果，避免先预告全文结构。",
  "先写清谁做了什么，再补时间、原因、条件和例子。让自然白话打底，保留长短句变化。",
  "判断可以明确，但依据要放在附近，材料只能支持到哪里就写到哪里。",
  "正文不用翻案腔、三项以上同构排比、破折号、提示性冒号、商业黑话或模型惯用洞察路标。",
  "不要强装升华、首尾呼应或在末段重新摘要全文。写到问题和行动已经讲清楚就结束。",
  "只输出作品要求的结构化结果，不展示材料计数、内部提纲、写作规则或检查过程。"
] as const;

const wechatChannels = new Set(["wechat", "weixin", "wechat_official_account", "公众号", "微信公众号"]);

export function isWechatContentChannel(channel: string) {
  return wechatChannels.has(String(channel || "").trim().toLocaleLowerCase());
}

function proseForStyleCheck(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/[^\s)\]}，。；;]+/g, "https-url")
    .replace(/\r/g, "");
}

function hasDisallowedColon(line: string) {
  const colonCount = (line.match(/[：:]/g) || []).length;
  if (!colonCount) return false;
  return !(colonCount === 1 && /(?:说|问|答|写道|回复)[^：:]{0,24}[：:]\s*[“「\"]/.test(line));
}

export function findHumanWritingWechatIssues(markdown: string) {
  const prose = proseForStyleCheck(markdown);
  const issues: string[] = [];
  if (/[—–]/.test(prose)) issues.push("正文使用了破折号。请改成普通句子或逗号、句号。 ");
  if (/(?:不是|并非)[^。！？\n]{0,40}(?:而是|只是)|与其说[^。！？\n]{0,40}不如说|表面[^。！？\n]{0,30}(?:实际|实则)|看似[^。！？\n]{0,30}实则|你以为[^。！？\n]{0,30}其实/.test(prose)) {
    issues.push("正文使用了先立误解再推翻的翻案腔。请直接给判断和依据。");
  }
  if (/(?:说白了|说穿了|先说结论|更微妙的是|还有一层|只说对了一半|值得注意的是|需要指出的是|从某种意义上说)/.test(prose)) {
    issues.push("正文使用了模型惯用的提示性路标。请直接承接上一段的事实或问题。");
  }
  if (prose.split("\n").some((line) => hasDisallowedColon(line))) {
    issues.push("正文使用了提示性冒号。冒号只保留给人物直接原话，网址和代码除外。");
  }
  if (/^(?:总结|总的来说|综上所述)[，,：:\s]/m.test(prose)) {
    issues.push("结尾重新摘要全文。请在最后一个事实、判断或行动建议处结束。");
  }
  return issues.map((value) => value.trim());
}

export function humanWritingWechatPromptDirectives(channel: string) {
  return isWechatContentChannel(channel)
    ? [`使用写作配置 ${HUMAN_WRITING_WECHAT_PROFILE_VERSION}。`, ...HUMAN_WRITING_WECHAT_DIRECTIVES]
    : [];
}

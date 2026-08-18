export const HUMAN_WRITING_WECHAT_PROFILE_VERSION = "human-writing.wechat.v1.2.0";

export const HUMAN_WRITING_WECHAT_DIRECTIVES = [
  "按非虚构中文长文处理。先确认材料能否托住篇幅，事实、数字、引语和产品能力只能来自已提供且可追溯的材料。",
  "材料不足时缩短正文或收窄问题，不得用假案例、想象现场、重复解释或常识推演填充篇幅。",
  "开头尽快碰到具体业务问题。每个新段落都要增加事实、动作、区别、条件或后果，避免先预告全文结构。",
  "先写清谁做了什么，再补时间、原因、条件和例子。同一主语的连续动作、同一因果链或尚未讲完的判断要沿着主干自然展开，可用逗号或分号承接，不要把每个小分句都切成句号。",
  "逐段检查句子节奏。连续四句长度接近，或后一句只用“这组数字”“这个结果”“这种情况”短接前句时，优先合并成一到两句完整的主从或因果句；短句只留给动作已经落地或确实需要强调的位置。",
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

function proseParagraphs(markdown: string) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.split("\n").filter((line) => !/^\s{0,3}#{1,6}\s/.test(line)).join(" ").trim())
    .filter(Boolean);
}

function cadenceSentences(paragraph: string) {
  return paragraph
    .split(/[。！？!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => ({ sentence, length: sentence.replace(/\s/g, "").length }));
}

function hasUniformSentenceCadence(paragraph: string) {
  const sentences = cadenceSentences(paragraph);
  for (let index = 0; index <= sentences.length - 4; index += 1) {
    const lengths = sentences.slice(index, index + 4).map((item) => item.length);
    if (lengths.every((length) => length >= 16 && length <= 45) && Math.max(...lengths) - Math.min(...lengths) <= 10) return true;
  }
  return false;
}

function hasMechanicalDemonstrativeContinuation(paragraph: string) {
  const sentences = cadenceSentences(paragraph);
  return sentences.some((item, index) => {
    const next = sentences[index + 1];
    if (!next || item.length < 20 || item.length > 50 || next.length > 30) return false;
    return /^(?:这组数字|这些数字|这个结果|这一结果|这种结果|这项结果|这一差距|这种差距|这个现象|这一现象|这种情况|这个情况|这一情况|这个事实|这一事实|这个问题|这一问题)/.test(next.sentence);
  });
}

export function findHumanWritingWechatIssues(markdown: string) {
  const prose = proseForStyleCheck(markdown);
  const issues: string[] = [];
  if (/[—–]/.test(prose)) issues.push("正文使用了破折号。请改成普通句子或逗号、句号。 ");
  if (/(?:不是|并非)[^。！？\n]{0,40}(?:而是|只是)|不在(?:于)?[^。！？\n]{0,40}而在(?:于)?|与其说[^。！？\n]{0,40}不如说|表面[^。！？\n]{0,30}(?:实际|实则)|看似[^。！？\n]{0,30}实则|你以为[^。！？\n]{0,30}其实/.test(prose)) {
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
  const paragraphs = proseParagraphs(prose);
  if (paragraphs.some((paragraph) => hasUniformSentenceCadence(paragraph))) {
    issues.push("正文出现连续四个长度接近的句子，同一动作链被句号切碎。请把仍共用主语、宾语或因果关系的内容合成一到两句，并只保留真正需要停顿的短句。");
  }
  if (paragraphs.some((paragraph) => hasMechanicalDemonstrativeContinuation(paragraph))) {
    issues.push("正文出现前句给事实、后句只用“这组数字”“这个结果”或同类指代作短承接的机械断句。请把结果、影响或判断接回前句，形成完整的主从句或因果句。");
  }
  return issues.map((value) => value.trim());
}

export function humanWritingWechatPromptDirectives(channel: string) {
  return isWechatContentChannel(channel)
    ? [`使用写作配置 ${HUMAN_WRITING_WECHAT_PROFILE_VERSION}。`, ...HUMAN_WRITING_WECHAT_DIRECTIVES]
    : [];
}

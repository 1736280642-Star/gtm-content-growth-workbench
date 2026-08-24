import { demoId } from "./config";

/** 仿真 AI 正文：在演示模式下代替真实模型返回。 */
export function demoAiContent(userPrompt: string): string {
  const topic = userPrompt.replace(/\s+/g, " ").trim().slice(0, 120);
  const lead = topic ? `围绕「${topic}」这一主题，` : "";
  return [
    `# 企业 AI 落地的关键判断`,
    ``,
    `${lead}企业在推进智能体与 AI 能力时，真正的难点往往不在模型本身，而在交付、治理与可归因的增长闭环。`,
    ``,
    `## 一、从单点能力到完整交付`,
    ``,
    `选型时应把长期运维、权限治理、知识库治理与业务流程适配一并纳入评估，而不是只看首次部署。`,
    ``,
    `## 二、把证据放进内容`,
    ``,
    `内容应建立在可追溯的产品事实与工作流证据之上，避免无依据的承诺。`,
    ``,
    `## 三、用 GEO 闭环验证结果`,
    ``,
    `以 AI 提及率与公开 URL 存活验证为准，形成「调研 → 生产 → 发布 → 验证 → 复盘」的月度增长闭环。`
  ].join("\n");
}

const DEMO_VECTOR_DIM = 64;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 仿真 embedding 向量：确定性伪随机，保证相同输入得到相同向量。 */
export function demoEmbeddingVector(seed: string): number[] {
  const base = hashString(seed);
  const vector = new Array<number>(DEMO_VECTOR_DIM);
  for (let i = 0; i < DEMO_VECTOR_DIM; i += 1) {
    const v = Math.sin(base + i * 12.9898) * 43758.5453;
    vector[i] = Number((v - Math.floor(v)).toFixed(6));
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

export function demoEmbeddingVectors(input: string | string[]): number[][] {
  const inputs = Array.isArray(input) ? input : [input];
  return inputs.map((item, index) => demoEmbeddingVector(item || `${demoId("seed")}-${index}`));
}

import { markdownSections } from "@/lib/v5/joto-wechat-layout-renderer";
import type { FreeProductionBatch, FreeProductionFactInput, FreeProductionSourceExcerpt } from "@/lib/v5/free-production-contracts";
import { renderDemoArticle } from "./production";
export function applyFactArticle(batch: FreeProductionBatch, facts: FreeProductionFactInput[], meetingText?: string) {
    batch.factItems = facts;
    batch.meetingText = meetingText;
    const artifact = batch.draftArtifacts[0];
    const sources: FreeProductionSourceExcerpt[] = facts.map((fact, index) => ({
        id: `fact-${batch.id}-${index}`, sourceType: "human_fact", sourceName: `已确认虚拟事件 ${index + 1}`,
        excerpt: `${fact.time}，${fact.location}，${fact.people}：${fact.event}`,
    }));
    if (meetingText)
        sources.push({ id: `meeting-${batch.id}`, sourceType: "meeting_text", sourceName: "虚拟会议记录", excerpt: meetingText });
    const body = `# ${artifact.selectedTitle}\n\n> 演示资料：以下事件、人物和记录均为虚构。\n\n${sources.map((source, index) => `## ${index ? "补充事实与记录" : "本次事件"}\n\n${source.excerpt}`).join("\n\n")}\n\n## 本次表达重点\n\n${batch.expressionFocus}\n\n## 后续行动与使用边界\n\n保存已确认的事实，明确责任人与交付结果。本文只整理所输入的虚拟事实，不额外推断活动效果，也不生成未经确认的数据。`;
    artifact.articleBody = body;
    artifact.sourceExcerpts = sources;
    artifact.sections = markdownSections(artifact.selectedTitle, body).map(section => ({ ...section, citations: [{ claimText: "经人工确认的虚拟事件", sourceIds: sources.map(source => source.id) }] }));
    artifact.wechatPresentation = { ...artifact.wechatPresentation!, previewHtml: renderDemoArticle(artifact.selectedTitle, body), publishHtml: renderDemoArticle(artifact.selectedTitle, body) };
    batch.sourceExcerpts = sources;
    batch.knowledgeSnapshotIds = [];
    batch.inputSnapshots[0].knowledgeSnapshots = sources.map(source => ({ ...source }));
}

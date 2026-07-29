"use client";

import type { ContentDraftArtifact } from "@/lib/v5/free-production-contracts";
import { VisualSuggestionPlaceholder } from "./VisualSuggestionPlaceholder";

export function WechatArticlePreview({ artifact }: { artifact: ContentDraftArtifact }) {
  if (artifact.wechatPresentation) {
    return (
      <article className="wechat-official-preview" aria-label="JOTO 官方公众号正式 HTML 预览">
        <div className="wechat-official-preview-meta">
          <strong>JOTO 官方排版</strong>
          <span>预览与写入公众号草稿箱使用同一渲染器；配图建议仅作预览批注。</span>
        </div>
        <iframe
          className="wechat-official-preview-frame"
          title={`${artifact.selectedTitle}的公众号排版预览`}
          srcDoc={artifact.wechatPresentation.previewHtml}
          sandbox=""
        />
      </article>
    );
  }

  return (
    <article className="wechat-article-preview" aria-label="公众号排版预览">
      <div className="wechat-brand-bar"><span>JOTO AI</span><em>让 AI 进入真实工作流</em></div>
      <header><h1>{artifact.selectedTitle}</h1><p>{artifact.summary}</p></header>
      <div className="wechat-article-body">
        {artifact.sections.map((section, index) => {
          const suggestion = artifact.visualSuggestions.find((item) => item.placementAnchor === section.sectionKey && !item.boundAssetRef);
          return (
            <section key={section.sectionKey}>
              <span className="wechat-section-index">{String(index + 1).padStart(2, "0")}</span>
              <h2>{section.heading}</h2>
              {section.markdown.split(/\n{2,}/).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph.replace(/^#+\s*/, "")}</p>)}
              {suggestion ? <VisualSuggestionPlaceholder suggestion={suggestion} /> : null}
            </section>
          );
        })}
      </div>
      <footer><strong>JOTO</strong><p>AI 承担重复、机械、耗时工作，人保留专业判断和最终决策权。</p></footer>
    </article>
  );
}

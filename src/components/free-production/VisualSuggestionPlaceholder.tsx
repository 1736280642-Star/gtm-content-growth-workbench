"use client";

import { PictureOutlined } from "@ant-design/icons";
import type { VisualMaterialSuggestion } from "@/lib/v5/free-production-contracts";

export function VisualSuggestionPlaceholder({ suggestion }: { suggestion: VisualMaterialSuggestion }) {
  return (
    <figure className="visual-suggestion-placeholder">
      <div><PictureOutlined /><span>视觉素材位置</span></div>
      <figcaption><strong>{suggestion.recommendation}</strong><span>{suggestion.captionSuggestion}</span><em>{suggestion.purpose}</em></figcaption>
    </figure>
  );
}

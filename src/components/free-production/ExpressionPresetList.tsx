"use client";

import { ArrowRightOutlined, DatabaseOutlined, EyeOutlined, FileTextOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Button, Empty } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";
import type { FreeContentExpressionTypeSummary, FreeProductionSourceMode } from "@/lib/v5/free-production-contracts";
import { ExpressionSettingsDrawer } from "./ExpressionSettingsDrawer";

const sourceMeta: Record<FreeProductionSourceMode, { label: string; icon: ReactNode }> = {
  knowledge: { label: "产品与知识库", icon: <DatabaseOutlined /> },
  facts: { label: "事件事实", icon: <UnorderedListOutlined /> },
  facts_with_meeting_text: { label: "事件事实 + 会议文本", icon: <FileTextOutlined /> }
};

export function ExpressionPresetList({ expressions, onUse }: { expressions: FreeContentExpressionTypeSummary[]; onUse: (expression: FreeContentExpressionTypeSummary) => void }) {
  const [detailProfile, setDetailProfile] = useState<FreeContentExpressionTypeSummary>();
  if (!expressions.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可用内容类型" />;
  return (
    <>
      <div className="expression-preset-list">
        {expressions.map((profile) => {
          const expression = profile.activeVersion!;
          return (
            <article className="expression-preset-row" key={profile.typeId}>
              <div className="expression-preset-identity">
                <div><h2>{expression.name}</h2></div>
                <p>{expression.description}</p>
                <span className="expression-source-mode">{sourceMeta[expression.sourceMode].icon}{sourceMeta[expression.sourceMode].label}</span>
              </div>
              <div className="expression-preset-actions">
                <Button icon={<EyeOutlined />} onClick={() => setDetailProfile(profile)}>查看设置</Button>
                <Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end" onClick={() => onUse(profile)}>使用此类型</Button>
              </div>
            </article>
          );
        })}
      </div>
      <ExpressionSettingsDrawer profile={detailProfile} onClose={() => setDetailProfile(undefined)} onUse={onUse} />
    </>
  );
}

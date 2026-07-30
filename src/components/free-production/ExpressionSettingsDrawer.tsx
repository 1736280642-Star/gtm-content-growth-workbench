"use client";

import { ArrowRightOutlined, CloseOutlined } from "@ant-design/icons";
import { Button, Drawer } from "antd";
import { useEffect, useState } from "react";
import type { FreeContentExpressionTypeSummary, FreeProductionSourceMode } from "@/lib/v5/free-production-contracts";
import { freeProductionChannelLabels } from "@/lib/v5/free-production-contracts";

const sourceModeLabels: Record<FreeProductionSourceMode, string> = {
  knowledge: "产品与知识库资料",
  facts: "时间、地点、人物与事件事实",
  facts_with_meeting_text: "事件事实与会议文本"
};

const structureLabels: Record<string, string> = {
  real_scene: "真实场景",
  pain_cost: "痛点与代价",
  key_judgment: "核心判断",
  product_positioning: "产品定位",
  workflow_sections: "工作流程变化",
  human_ai_boundary: "人机协作边界",
  value_close: "价值收束",
  cta: "行动引导",
  deadline_scene: "时限场景",
  task_complexity: "任务复杂性",
  old_workflow: "原有工作流程",
  assistant_action: "AI 执行动作",
  result_evidence: "结果依据",
  announcement: "官宣事实",
  cooperation_background: "合作背景",
  cooperation_scope: "合作范围",
  complementary_capabilities: "双方能力",
  cooperation_value: "合作价值",
  next_steps: "下一阶段",
  brand_close: "品牌收束",
  event_facts: "活动事实",
  event_thesis: "活动主张",
  speaker_insights: "嘉宾观点",
  case_evidence: "案例依据",
  product_context: "产品关联",
  contrarian_thesis: "核心观点",
  scene_details: "场景细节",
  root_cause: "根本原因",
  industry_judgment: "行业判断",
  product_response: "产品回应",
  workflow_change: "工作流变化",
  soft_cta: "软性引导"
};

export function ExpressionSettingsDrawer({ profile, onClose, onUse }: { profile?: FreeContentExpressionTypeSummary; onClose: () => void; onUse: (profile: FreeContentExpressionTypeSummary) => void }) {
  const [mobile, setMobile] = useState(false);
  const expression = profile?.activeVersion;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return (
    <Drawer
      className="expression-settings-drawer"
      title="内容类型设置"
      open={Boolean(expression)}
      onClose={onClose}
      placement={mobile ? "bottom" : "right"}
      height={mobile ? "92vh" : undefined}
      width={mobile ? undefined : 620}
      footer={profile ? <div className="drawer-action-row"><Button icon={<CloseOutlined />} onClick={onClose}>关闭</Button><Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end" onClick={() => { onClose(); onUse(profile); }}>使用此类型</Button></div> : null}
    >
      {expression ? (
        <div className="expression-settings-content">
          <header>
            <span className="v5-kicker">只读设置</span>
            <h2>{expression.name}</h2>
            <p>{expression.description}</p>
          </header>

          <section>
            <h3>用途</h3>
            <dl className="expression-settings-grid">
              <div><dt>适用场景</dt><dd>{expression.scenario}</dd></div>
              <div><dt>内容目标</dt><dd>{expression.contentGoal}</dd></div>
              <div><dt>默认受众</dt><dd>{expression.defaultAudience}</dd></div>
              <div><dt>推荐篇幅</dt><dd>{expression.recommendedLength.min} - {expression.recommendedLength.max} 字</dd></div>
            </dl>
          </section>

          <section>
            <h3>生产规则</h3>
            <dl className="expression-settings-grid">
              <div><dt>资料入口</dt><dd>{sourceModeLabels[expression.sourceMode]}</dd></div>
              <div><dt>事实依据</dt><dd>{expression.evidenceRequirements.minimumEvidenceCount > 0 ? `至少 ${expression.evidenceRequirements.minimumEvidenceCount} 条可追溯来源` : "使用本次提供的可追溯来源"}</dd></div>
            </dl>
            {expression.defaultExpressionFocus.length ? <div className="expression-settings-focus"><strong>默认表达重点</strong><ul>{expression.defaultExpressionFocus.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          </section>

          <section>
            <h3>正文结构</h3>
            <ol className="expression-settings-structure">{expression.structureModules.map((item) => <li key={item}>{structureLabels[item] || item}</li>)}</ol>
            {expression.additionalWritingRequirements ? <p className="expression-settings-note"><strong>写作要求</strong>{expression.additionalWritingRequirements}</p> : null}
          </section>

          <section>
            <h3>发布设置</h3>
            <dl className="expression-settings-grid">
              <div><dt>发布渠道</dt><dd>{freeProductionChannelLabels[expression.channelBinding.channel]}</dd></div>
              <div><dt>发布方式</dt><dd>人工确认正文后自动发布</dd></div>
              <div><dt>公众号封面</dt><dd>{expression.channelBinding.requiredPublishAssetKeys.includes("wechat_cover") ? "发布前必须补充" : "不要求"}</dd></div>
              <div><dt>正文配图</dt><dd>{expression.visualSuggestionMode === "placeholders" ? "生成配图位置建议" : "不生成配图建议"}</dd></div>
            </dl>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

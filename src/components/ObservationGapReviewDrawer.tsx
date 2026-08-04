"use client";

import { Alert, Button, Checkbox, Drawer, Input, Select, Space, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { CapturedAnswer, ObservationGap, ObservationGapDestination } from "@/lib/v5/observation-contracts";

const destinationLabels: Record<ObservationGapDestination, string> = {
  blog_candidate: "GEO 内容策略输入",
  knowledge_issue: "知识库问题与冲突",
  site_audit: "官网审计",
  manual_review: "人工复核队列"
};

export function ObservationGapReviewDrawer({ answer, gaps, open, submitting, onClose, onConfirm }: {
  answer?: CapturedAnswer;
  gaps: ObservationGap[];
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (selectedGapIds: string[], destinations: ObservationGapDestination[], note: string) => Promise<void>;
}) {
  const candidates = useMemo(() => gaps.filter((item) => item.status === "candidate"), [gaps]);
  const [selectedGapIds, setSelectedGapIds] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<ObservationGapDestination[]>([]);
  const [note, setNote] = useState("");
  const availableDestinations = useMemo(
    () => Array.from(new Set(candidates.filter((item) => selectedGapIds.includes(item.id)).flatMap((item) => item.suggestedDestinations))),
    [candidates, selectedGapIds]
  );

  useEffect(() => {
    if (!open) return;
    setSelectedGapIds(candidates.map((item) => item.id));
    setDestinations(Array.from(new Set(candidates.flatMap((item) => item.suggestedDestinations))));
    setNote("");
  }, [open, answer?.id, candidates]);

  useEffect(() => {
    setDestinations((current) => current.filter((item) => availableDestinations.includes(item)));
  }, [availableDestinations]);

  return (
    <Drawer
      title={answer ? `复核缺口：${answer.questionText}` : "复核候选缺口"}
      open={open}
      onClose={onClose}
      width={600}
      extra={<Button type="primary" loading={submitting} disabled={!selectedGapIds.length || !destinations.length} onClick={() => onConfirm(selectedGapIds, destinations, note)}>确认并分流</Button>}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Checkbox.Group value={selectedGapIds} onChange={(values) => setSelectedGapIds(values.map(String))}>
          <Space direction="vertical" style={{ width: "100%" }}>
            {candidates.map((gap) => (
              <Checkbox key={gap.id} value={gap.id}>
                <span className="gap-review-label"><strong>{gap.title}</strong><Tag>{gap.code}</Tag><span>置信度 {Math.round(gap.confidence * 100)}%</span></span>
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
        <div>
          <strong>业务去向</strong>
          <Select
            mode="multiple"
            style={{ width: "100%", marginTop: 8 }}
            value={destinations}
            onChange={setDestinations}
            options={availableDestinations.map((value) => ({ value, label: destinationLabels[value] }))}
          />
        </div>
        <div>
          <strong>复核说明</strong>
          <Input.TextArea style={{ marginTop: 8 }} rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录最终业务判断；原始回答不会被修改" />
        </div>
        <Alert showIcon type="info" message="确认后由系统继续处理" description="内容缺口进入 GEO 内容策略，证据缺口进入知识库治理；系统会在证据和规则门禁通过后自动生成月度任务，人工仍可修改。" />
      </Space>
    </Drawer>
  );
}

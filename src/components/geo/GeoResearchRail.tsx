import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  LoadingOutlined,
  PauseCircleFilled
} from "@ant-design/icons";
import { Tag } from "antd";
import Link from "next/link";
import type { GeoResearchTask, GeoResearchTaskStatus, GeoResearchTaskType } from "@/lib/v5/geo-research-contracts";

const stages: Array<{
  type: GeoResearchTaskType;
  label: string;
  helper: string;
}> = [
  { type: "context_validation", label: "资料校验", helper: "确认产品身份与快照" },
  { type: "research_planning", label: "研究规划", helper: "模型拆解问题和查询" },
  { type: "live_question_discovery", label: "问题发现", helper: "搜索真实用户提问" },
  { type: "live_competitor_discovery", label: "竞品研究", helper: "拆解竞品内容占位" },
  { type: "frontend_baseline", label: "AI 基线", helper: "记录回答、提及和引用" },
  { type: "evidence_alignment", label: "证据归并", helper: "对齐回答与公开来源" },
  { type: "blueprint_synthesis", label: "蓝图草案", helper: "形成可审核策略输入" }
];

const labels: Record<GeoResearchTaskStatus, string> = {
  blocked: "等待前置",
  queued: "待执行",
  running: "执行中",
  pending_config: "等待配置",
  completed: "已完成",
  failed: "需处理",
  cancelled: "已取消"
};

function StatusIcon({ status }: { status: GeoResearchTaskStatus }) {
  if (status === "completed") return <CheckCircleFilled />;
  if (status === "running") return <LoadingOutlined spin />;
  if (status === "pending_config") return <PauseCircleFilled />;
  if (status === "failed") return <CloseCircleFilled />;
  return <ClockCircleOutlined />;
}

export function GeoResearchRail({
  tasks,
  runHref
}: {
  tasks?: GeoResearchTask[];
  runHref?: string;
}) {
  const taskMap = new Map((tasks || []).map((task) => [task.taskType, task]));
  return (
    <div className="geo-research-rail" aria-label="GEO 研究链路">
      {stages.map((stage, index) => {
        const task = taskMap.get(stage.type);
        const status = task?.status || "blocked";
        const content = (
          <>
            <span className={`geo-rail-marker is-${status}`}><StatusIcon status={status} /></span>
            <span className="geo-rail-copy">
              <strong>{stage.label}</strong>
              <small>{task?.failureMessage || stage.helper}</small>
            </span>
            <Tag className="geo-rail-status" bordered={false}>{task ? labels[status] : "未创建"}</Tag>
          </>
        );
        return runHref ? (
          <Link className="geo-rail-stage" href={runHref} key={stage.type} aria-label={`查看${stage.label}`}>
            {content}
            {index < stages.length - 1 ? <span className="geo-rail-connector" /> : null}
          </Link>
        ) : (
          <div className="geo-rail-stage" key={stage.type}>
            {content}
            {index < stages.length - 1 ? <span className="geo-rail-connector" /> : null}
          </div>
        );
      })}
    </div>
  );
}

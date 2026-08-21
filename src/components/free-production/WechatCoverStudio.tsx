"use client";

import { CheckOutlined, PictureOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, Spin, Tag, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { FreeProductionBatch } from "@/lib/v5/free-production-contracts";
import type { WechatVisualPlanView, WechatVisualWorkspace } from "@/lib/v5/wechat-visual-contracts";

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const body = await response.json() as { ok?: boolean; data?: T; error?: { message?: string; nextAction?: string; details?: string[] } };
  if (!response.ok || !body.ok || !body.data) {
    throw new Error([body.error?.message, body.error?.details?.join("；"), body.error?.nextAction].filter(Boolean).join(" ") || "视觉方案请求失败。");
  }
  return body.data;
}

function statusCopy(plan: WechatVisualPlanView | undefined) {
  if (!plan) return "系统会根据当前正文给出品牌、系统和传播三种方向。";
  if (plan.status === "stale") return "正文已经变化，请基于最新版本重新生成。";
  if (plan.status === "pending_config") return "视觉方案已完成，图片 Provider 配置后即可生成候选。";
  if (plan.status === "failed") return "本轮图片没有生成成功，正文和已保存封面不受影响。";
  if (plan.status === "partial") return "部分候选已经完成，可以采用或重新生成整组。";
  if (plan.status === "applied") return "选中的封面已进入当前正文发布配置。";
  return "三张候选来自不同视觉策略，最终判断由你完成。";
}

export function WechatCoverStudio({ batchId, batchVersion, artifactId, artifactVersion, locked, onBatchChange }: {
  batchId: string;
  batchVersion: number;
  artifactId: string;
  artifactVersion: number;
  locked?: boolean;
  onBatchChange: (batch: FreeProductionBatch) => void;
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const [workspace, setWorkspace] = useState<WechatVisualWorkspace>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"generate" | string>();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setWorkspace(await request<WechatVisualWorkspace>(`/api/v5/free-production/batches/${encodeURIComponent(batchId)}/visual-plan`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "视觉方案读取失败。");
    } finally {
      setLoading(false);
    }
  }, [artifactId, artifactVersion, batchId]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setWorking("generate");
    setError("");
    try {
      const plan = await request<WechatVisualPlanView>(`/api/v5/free-production/batches/${encodeURIComponent(batchId)}/visual-plan`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey("generate-wechat-cover") },
        body: JSON.stringify({ expectedVersion: batchVersion, auditReason: "基于当前公众号正文生成三种封面候选", artifactId })
      });
      setWorkspace((current) => current ? { ...current, plan } : { applicable: true, plan, provider: { status: plan.providerStatus, label: "图片生成服务", missingConfig: plan.providerMissingConfig } });
      if (plan.status === "pending_config") messageApi.warning("视觉拆解已完成；配置图片 Provider 后重新生成即可看到候选。");
      else if (plan.status === "failed") messageApi.error("本轮图片没有生成成功，请按提示检查 Provider 后重试。");
      else messageApi.success(plan.status === "partial" ? "部分封面候选已生成。" : "3 个封面方案已生成，请选择最终封面。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "封面候选生成失败。");
    } finally {
      setWorking(undefined);
    }
  }

  async function select(candidateId: string) {
    const plan = workspace?.plan;
    if (!plan) return;
    setWorking(candidateId);
    setError("");
    try {
      const result = await request<{ batch: FreeProductionBatch; plan: WechatVisualPlanView }>(`/api/v5/free-production/batches/${encodeURIComponent(batchId)}/visual-plan/selection`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey("select-wechat-cover") },
        body: JSON.stringify({ expectedVersion: batchVersion, auditReason: "人工选择智能生成的公众号封面", artifactId, planId: plan.planId, candidateId })
      });
      setWorkspace((current) => current ? { ...current, plan: result.plan } : current);
      onBatchChange(result.batch);
      messageApi.success("已采用该封面，并写入当前正文的发布配置。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "封面应用失败。");
    } finally {
      setWorking(undefined);
    }
  }

  const plan = workspace?.plan;
  const candidates = plan?.candidates || [];
  const canGenerate = !locked && !working;
  const providerPending = workspace?.provider.status === "pending_config";

  return (
    <section className="wechat-cover-studio" aria-label="智能封面工作台">
      {contextHolder}
      <header className="wechat-cover-studio-heading">
        <div>
          <span className="v5-kicker">视觉样张</span>
          <strong>从当前正文生成 3 个封面方向</strong>
          <p>{statusCopy(plan)}</p>
        </div>
        <Button
          type={plan ? "default" : "primary"}
          icon={plan ? <ReloadOutlined /> : <ThunderboltOutlined />}
          loading={working === "generate"}
          disabled={!canGenerate}
          onClick={() => void generate()}
        >{plan ? "重新生成 3 个" : "生成 3 个封面"}</Button>
      </header>

      {loading ? <div className="wechat-cover-studio-loading"><Spin size="small" /><span>正在读取视觉方案</span></div> : null}
      {error ? <Alert showIcon type="error" message={error} /> : null}
      {!loading && providerPending && (!plan || plan.status === "pending_config") ? (
        <Alert
          showIcon
          type="warning"
          message="图片生成服务尚未配置"
          description={`请在服务端补充 ${workspace?.provider.missingConfig.join("、") || "图片 Provider 配置"}。原有手动上传封面仍可正常使用。`}
        />
      ) : null}

      {!loading && candidates.length ? (
        <div className="wechat-cover-contact-sheet">
          {candidates.map((candidate) => {
            const selected = plan?.selectedCoverCandidateId === candidate.candidateId;
            const ready = candidate.status === "ready" || candidate.status === "selected";
            return (
              <article className={`wechat-cover-proof${selected ? " is-selected" : ""}`} key={candidate.candidateId}>
                <div className="wechat-cover-proof-image">
                  {candidate.contentUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={candidate.contentUrl} alt={`${candidate.route.routeName}封面候选`} />
                  ) : (
                    <span><PictureOutlined />{candidate.status === "generating" ? "生成中" : candidate.status === "pending_config" ? "待配置" : "未生成"}</span>
                  )}
                  <Tag color={selected ? "success" : candidate.variantIndex === 1 ? "blue" : "default"}>{selected ? "已采用" : candidate.variantIndex === 1 ? "最推荐" : `方向 ${candidate.variantIndex}`}</Tag>
                </div>
                <div className="wechat-cover-proof-copy">
                  <span>{candidate.route.styleName}</span>
                  <strong>{candidate.route.routeName}</strong>
                  <p>{candidate.route.recommendation}</p>
                  {candidate.errorMessage && candidate.status === "failed" ? <small>{candidate.errorMessage}</small> : null}
                </div>
                <Button
                  type={selected ? "default" : "primary"}
                  ghost={!selected}
                  icon={<CheckOutlined />}
                  loading={working === candidate.candidateId}
                  disabled={!ready || selected || Boolean(working) || locked}
                  onClick={() => void select(candidate.candidateId)}
                >{selected ? "当前封面" : "采用此封面"}</Button>
              </article>
            );
          })}
        </div>
      ) : !loading && !providerPending ? (
        <div className="wechat-cover-studio-empty">
          <span><PictureOutlined /></span>
          <p>生成后会在这里直接比较品牌、系统和传播三种封面方向。</p>
        </div>
      ) : null}
    </section>
  );
}

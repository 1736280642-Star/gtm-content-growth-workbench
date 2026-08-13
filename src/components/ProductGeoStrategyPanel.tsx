"use client";

import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Collapse, Descriptions, Empty, Input, List, Popconfirm, Space, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { callJsonApi } from "@/lib/client-api";
import type {
  ProductGeoStrategyContentPlanV2,
  ProductGeoStrategyDecision,
  ProductGeoStrategyPackRecord,
  ProductStrategyArticleTypeVersionRecord,
  FixedExpressionPosition
} from "@/lib/v5/product-strategy-pack-contracts";
import { GeoStructuredData } from "@/components/geo/GeoStructuredData";

interface ProductGeoStrategyResponse {
  ok: true;
  productId: string;
  latestStrategyPack?: ProductGeoStrategyPackRecord | null;
  currentStrategyPack?: ProductGeoStrategyPackRecord | null;
  latestArticleTypeVersions?: ProductStrategyArticleTypeVersionRecord[];
  currentArticleTypeVersions?: ProductStrategyArticleTypeVersionRecord[];
}

interface ProductGeoStrategyDecisionResponse {
  ok: true;
  status: string;
  sample?: {
    status: "generated" | "failed";
    draftVersionId?: string;
    error?: { message?: string; nextAction?: string };
  };
}

const statusLabels: Record<string, { text: string; color: string }> = {
  draft: { text: "草稿", color: "default" },
  pending_strategy_review: { text: "待你确认", color: "gold" },
  strategy_approved: { text: "策略已确认", color: "blue" },
  pending_sample_review: { text: "待验收样稿", color: "gold" },
  production_ready: { text: "生产就绪", color: "green" },
  active: { text: "历史生产版本", color: "green" },
  rejected: { text: "已拒绝", color: "red" },
  superseded: { text: "已被新版本替代", color: "default" }
};

function isV2ContentPlan(value: ProductGeoStrategyPackRecord["contentPlan"]): value is ProductGeoStrategyContentPlanV2 {
  return Boolean(value && typeof value === "object" && "contractVersion" in value
    && value.contractVersion === "product-geo-strategy.v2");
}

function statusTag(status: string) {
  const item = statusLabels[status] || { text: status, color: "default" };
  return <Tag color={item.color}>{item.text}</Tag>;
}

const articleTypeOriginLabels = {
  matched: "复用现有模板",
  adapted: "基于现有模板调整",
  generated: "AI 新建模板",
  research_recommended: "调研推荐"
} as const;

const evidenceReadinessLabels = {
  ready: { text: "证据就绪", color: "green" },
  partial: { text: "资料待补", color: "gold" },
  blocked: { text: "禁止生产", color: "red" }
} as const;

const channelLabels: Record<string, string> = {
  wechat: "微信公众号",
  official_website: "官方网站",
  ai_frontend: "AI 前台",
  csdn: "CSDN",
  juejin: "稀土掘金"
};

function evidenceReadinessTag(readiness: keyof typeof evidenceReadinessLabels) {
  const item = evidenceReadinessLabels[readiness];
  return <Tag color={item.color}>{item.text}</Tag>;
}

export function ProductGeoStrategyPanel({ productId }: { productId: string }) {
  const [data, setData] = useState<ProductGeoStrategyResponse>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<ProductGeoStrategyDecision>();
  const [updatingFixedExpression, setUpdatingFixedExpression] = useState(false);
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);
  const [fixedText, setFixedText] = useState("");
  const [fixedPositions, setFixedPositions] = useState<FixedExpressionPosition[]>([]);
  const [fixedChannels, setFixedChannels] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [messageApi, contextHolder] = message.useMessage();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await callJsonApi<ProductGeoStrategyResponse>(
        `/api/v5/products/${encodeURIComponent(productId)}/strategy-pack`,
        { cache: "no-store" }
      ));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "产品 GEO 策略加载失败");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function decide(decision: ProductGeoStrategyDecision) {
    const pack = data?.latestStrategyPack;
    if (!pack) return;
    setWorking(decision);
    try {
      const idempotencyKey = `product-strategy:${pack.id}:${decision}:${crypto.randomUUID()}`;
      const result = await callJsonApi<ProductGeoStrategyDecisionResponse>(`/api/v5/products/${encodeURIComponent(productId)}/strategy-pack/apply`, {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({
          strategyPackId: pack.id,
          decision,
          expectedVersion: pack.rowVersion,
          selectedPortfolioItemIds: decision === "approve" ? selectedTypeIds : undefined,
          fixedExpression: decision === "approve" && fixedText.trim() ? {
            text: fixedText.trim(),
            positions: fixedPositions,
            channels: fixedChannels
          } : undefined,
          auditReason: decision === "approve"
            ? "用户确认产品 GEO 策略并允许生成示例正文"
            : "用户拒绝当前产品 GEO 策略，等待资料或调研调整"
        })
      });
      if (decision === "approve") {
        if (result.sample?.status === "generated") {
          messageApi.success("策略已确认，示例正文已生成，请直接验收内容质量");
        } else {
          messageApi.warning(result.sample?.error?.message || "策略已确认，示例正文等待系统恢复");
        }
        window.dispatchEvent(new CustomEvent("product-sample-updated"));
      } else {
        messageApi.success("当前策略已拒绝");
      }
      await refresh();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "策略确认失败");
    } finally {
      setWorking(undefined);
    }
  }

  async function saveFixedExpressionAndGenerateSample() {
    const pack = data?.latestStrategyPack;
    if (!pack || pack.status !== "strategy_approved" || !fixedExpressionValid) return;
    setUpdatingFixedExpression(true);
    try {
      await callJsonApi(`/api/v5/products/${encodeURIComponent(productId)}/strategy-pack`, {
        method: "PATCH",
        headers: { "x-idempotency-key": `product-strategy-fixed:${pack.id}:${crypto.randomUUID()}` },
        body: JSON.stringify({
          strategyPackId: pack.id,
          expectedVersion: pack.rowVersion,
          fixedExpression: { text: fixedText.trim(), positions: fixedPositions, channels: fixedChannels }
        })
      });
      await callJsonApi(`/api/v5/products/${encodeURIComponent(productId)}/sample-article`, {
        method: "POST",
        headers: { "x-idempotency-key": `product-sample-after-fixed:${pack.id}:${crypto.randomUUID()}` }
      });
      messageApi.success("固定文案已冻结，示例正文已生成，请继续验收内容质量");
      window.dispatchEvent(new CustomEvent("product-sample-updated"));
      await refresh();
    } catch (requestError) {
      messageApi.error(requestError instanceof Error ? requestError.message : "固定文案保存或样稿生成失败");
      await refresh();
    } finally {
      setUpdatingFixedExpression(false);
    }
  }

  const latest = data?.latestStrategyPack || undefined;
  const current = data?.currentStrategyPack || undefined;
  const plan = latest && isV2ContentPlan(latest.contentPlan) ? latest.contentPlan : undefined;
  const currentIsDifferent = Boolean(current && latest && current.id !== latest.id);
  const opportunityItems = useMemo(() => plan?.geoOpportunities || [], [plan]);
  const articleTypeItems = useMemo(() => plan?.articleTypePortfolio || [], [plan]);
  const availableChannels = useMemo(() => [...new Set((plan?.channelPriorities || []).map((item) => item.channel))], [plan]);
  const readyArticleTypeCount = useMemo(
    () => articleTypeItems.filter((item) => item.evidenceReadiness === "ready").length,
    [articleTypeItems]
  );
  const partialArticleTypeCount = useMemo(
    () => articleTypeItems.filter((item) => item.evidenceReadiness === "partial").length,
    [articleTypeItems]
  );

  useEffect(() => {
    setSelectedTypeIds(articleTypeItems
      .filter((item) => item.evidenceReadiness !== "blocked")
      .map((item) => item.portfolioItemId));
  }, [latest?.id, articleTypeItems]);

  useEffect(() => {
    setFixedText(plan?.fixedExpression?.text || "");
    setFixedPositions(plan?.fixedExpression?.positions || []);
    setFixedChannels(plan?.fixedExpression?.channels || []);
  }, [latest?.id, plan?.fixedExpression]);

  const fixedExpressionValid = !fixedText.trim() || (fixedPositions.length > 0 && fixedChannels.length > 0);
  const fixedExpressionEditable = latest?.status === "pending_strategy_review" || latest?.status === "strategy_approved";

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      {error ? <Alert showIcon type="error" message={error} action={<Button onClick={() => void refresh()}>重试</Button>} /> : null}
      <Card
        bordered={false}
        title="产品 GEO 策略"
        loading={loading && !latest}
        extra={<Space>{latest ? statusTag(latest.status) : null}<Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button></Space>}
      >
        {!loading && !latest ? (
          <Empty description="完成产品资料和 GEO 调研后，系统会在这里整理策略，不再要求你单独审批调研蓝图。" />
        ) : null}
        {latest ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {latest.status === "pending_strategy_review" ? (
              <Alert
                showIcon
                type="warning"
                message="请确认策略方向，再生成示例正文"
                description="确认范围包括产品定位、优先问题、文章类型和表达边界。联网搜索过程与内部综合稿已收进依据区。"
              />
            ) : latest.status === "strategy_approved" ? (
              <Alert showIcon type="success" message="产品策略已经确认" description="下一阶段会用同一正式生产链生成一篇示例正文，样稿通过前不会进入自动批量发布。" />
            ) : null}
            {currentIsDifferent ? (
              <Alert showIcon type="info" message="当前生产仍保留上一版已确认策略" description="新版本只有在你确认后才会替换当前策略；拒绝新版本不会清空旧版本。" />
            ) : null}

            {plan ? (
              <>
                <Card size="small" title="产品定位与表达边界">
                  <Descriptions column={{ xs: 1, lg: 2 }} size="small">
                    <Descriptions.Item label="产品定位" span={2}>
                      {plan.productPositioning.positioning?.length ? plan.productPositioning.positioning.join("；") : "以产品信息页中已确认的知识库资料为准"}
                    </Descriptions.Item>
                    <Descriptions.Item label="推广目的" span={2}>{plan.productPositioning.promotionPurpose || plan.productPositioning.expressionFocus}</Descriptions.Item>
                    <Descriptions.Item label="目标市场">{plan.productPositioning.targetMarkets.join("、") || "待补充"}</Descriptions.Item>
                    <Descriptions.Item label="内容语言">{plan.productPositioning.languages.join("、") || "待补充"}</Descriptions.Item>
                    <Descriptions.Item label="禁止或谨慎表达" span={2}>
                      {plan.productPositioning.prohibitedClaims.length ? plan.productPositioning.prohibitedClaims.join("；") : "沿用正式产品事实和渠道规则"}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                <Card size="small" title="固定表达">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Typography.Text type="secondary">设置后必须逐字出现，系统不允许模型改写或省略。</Typography.Text>
                    <Input.TextArea
                      value={fixedText}
                      onChange={(event) => setFixedText(event.target.value)}
                      disabled={!fixedExpressionEditable}
                      maxLength={500}
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      placeholder="输入需要逐字保留的固定文案"
                    />
                    <div>
                      <Typography.Text strong>出现位置</Typography.Text>
                      <div style={{ marginTop: 8 }}>
                        <Checkbox.Group
                          value={fixedPositions}
                          disabled={!fixedExpressionEditable || !fixedText.trim()}
                          options={[{ label: "开篇", value: "opening" }, { label: "正文", value: "body" }, { label: "结尾", value: "ending" }]}
                          onChange={(values) => setFixedPositions(values as FixedExpressionPosition[])}
                        />
                      </div>
                    </div>
                    <div>
                      <Typography.Text strong>适用渠道</Typography.Text>
                      <div style={{ marginTop: 8 }}>
                        <Checkbox.Group
                          value={fixedChannels}
                          disabled={!fixedExpressionEditable || !fixedText.trim()}
                          options={availableChannels.map((channel) => ({ label: channelLabels[channel] || channel, value: channel }))}
                          onChange={(values) => setFixedChannels(values as string[])}
                        />
                      </div>
                    </div>
                    {!fixedExpressionValid ? <Typography.Text type="danger">填写固定文案后，请至少选择一个出现位置和一个适用渠道。</Typography.Text> : null}
                    {latest.status === "strategy_approved" ? (
                      <Popconfirm
                        title="保存固定文案并重新生成样稿？"
                        description="仅允许在样稿尚未生成时补录；保存后正文必须逐字满足所选位置。"
                        okText="保存并生成"
                        cancelText="取消"
                        onConfirm={() => void saveFixedExpressionAndGenerateSample()}
                      >
                        <Button
                          type="primary"
                          loading={updatingFixedExpression}
                          disabled={!fixedText.trim() || !fixedExpressionValid}
                        >保存固定文案并生成示例</Button>
                      </Popconfirm>
                    ) : null}
                  </Space>
                </Card>

                <Card size="small" title={`优先 GEO 问题（${opportunityItems.length}）`}>
                  {opportunityItems.length ? (
                    <List
                      dataSource={opportunityItems}
                      renderItem={(item) => (
                        <List.Item>
                          <List.Item.Meta
                            title={<Space wrap><Typography.Text strong>{item.title}</Typography.Text>{item.priority ? <Tag>{item.priority}</Tag> : null}{item.evidenceReadiness ? <Tag>{item.evidenceReadiness}</Tag> : null}</Space>}
                            description={[item.intent, item.productFit, ...item.representativeQuestions].filter(Boolean).join(" · ") || "详细依据见高级信息"}
                          />
                        </List.Item>
                      )}
                    />
                  ) : <Alert showIcon type="info" message="调研综合稿尚未输出结构化问题簇" description="原始问题策略已保留在高级信息中；Phase 2B 会补齐统一问题与证据结构。" />}
                </Card>

                <Card size="small" title={`建议文章类型（${articleTypeItems.length}）`}>
                  {articleTypeItems.length ? (
                    <Alert
                      showIcon
                      type={readyArticleTypeCount > 0 ? "warning" : "error"}
                      message={`${readyArticleTypeCount} 种证据就绪，${partialArticleTypeCount} 种需要补充资料`}
                      description="资料待补的类型可以保留在策略中，但不会进入正式批量生产；系统只会用证据就绪的类型生成任务。"
                      style={{ marginBottom: 12 }}
                    />
                  ) : null}
                  {latest.status === "pending_strategy_review" && articleTypeItems.length ? (
                    <Alert
                      showIcon
                      type={selectedTypeIds.length >= 2 ? "info" : "error"}
                      message={`本次确认将冻结 ${selectedTypeIds.length} 种文章类型`}
                      description="可取消不需要的类型，但至少保留 2 种、最多 6 种；AI 改造或新建版本只有随策略确认成功后才会生效。"
                      style={{ marginBottom: 12 }}
                    />
                  ) : null}
                  {articleTypeItems.length ? (
                    <List
                      dataSource={articleTypeItems}
                      renderItem={(item) => (
                        <List.Item
                          extra={latest.status === "pending_strategy_review" ? (
                            <Checkbox
                              checked={selectedTypeIds.includes(item.portfolioItemId)}
                              disabled={item.evidenceReadiness === "blocked"
                                || (selectedTypeIds.includes(item.portfolioItemId) && selectedTypeIds.length <= 2)}
                              onChange={(event) => setSelectedTypeIds((current) => event.target.checked
                                ? [...new Set([...current, item.portfolioItemId])]
                                : current.filter((id) => id !== item.portfolioItemId))}
                            >纳入策略</Checkbox>
                          ) : null}
                        >
                          <List.Item.Meta
                            title={<Space wrap>
                              <Typography.Text strong>{item.name}</Typography.Text>
                              <Tag>{articleTypeOriginLabels[item.origin]}</Tag>
                              {evidenceReadinessTag(item.evidenceReadiness)}
                            </Space>}
                            description={(
                              <Space direction="vertical" size={2}>
                                <Typography.Text type="secondary">{[item.definition, item.contentGoal, item.recommendationReason].filter(Boolean).join(" · ")}</Typography.Text>
                                <Typography.Text type="secondary">结构：{item.structureModules.map((module) => module.key).join(" → ") || "待补充"}；篇幅：{item.lengthRange.min}-{item.lengthRange.max} 字</Typography.Text>
                                <Typography.Text type="secondary">适用：{item.suitableQuestions.join("；") || "见对应问题簇"}；不适用：{item.unsuitableQuestions.join("；") || "未标记"}</Typography.Text>
                                {item.evidenceReadiness === "partial" ? <Typography.Text type="warning">补齐正式资料前仅保留为策略候选，不进入批量生产。</Typography.Text> : null}
                                {item.evidenceReadiness === "blocked" ? <Typography.Text type="danger">当前证据不足，禁止生成或发布。</Typography.Text> : null}
                              </Space>
                            )}
                          />
                        </List.Item>
                      )}
                    />
                  ) : <Alert showIcon type="info" message="文章类型组合将在下一阶段生成" description="本阶段先保证策略门禁正确；AI 匹配、改造和新建文章类型不会绕过你的确认。" />}
                </Card>

                <Collapse
                  items={[{
                    key: "evidence",
                    label: "依据与高级信息",
                    children: <GeoStructuredData value={{
                      evidencePolicy: plan.evidencePolicy,
                      channelPriorities: plan.channelPriorities,
                      recommendedMonthlyMix: plan.recommendedMonthlyMix,
                      retestBaseline: plan.retestBaseline,
                      synthesis: plan.synthesis,
                      researchSynthesis: plan.researchSynthesis
                    }} />
                  }]}
                />
              </>
            ) : latest.contentPlan ? (
              <Alert
                showIcon
                type="info"
                message="这是 Phase 1 历史策略包"
                description={<Collapse items={[{ key: "legacy", label: "查看历史策略内容", children: <GeoStructuredData value={{ ...latest.contentPlan }} /> }]} />}
              />
            ) : <Alert showIcon type="error" message="策略包内容不完整，不能确认" />}

            {latest.status === "pending_strategy_review" ? (
              <Space wrap>
                <Popconfirm
                  title="确认这版产品 GEO 策略？"
                  description="确认后系统才会生成一篇正式链路示例正文。"
                  okText="确认策略"
                  cancelText="继续检查"
                  onConfirm={() => decide("approve")}
                >
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    loading={working === "approve"}
                    disabled={selectedTypeIds.length < 2 || selectedTypeIds.length > 6 || !fixedExpressionValid}
                  >确认策略并生成示例</Button>
                </Popconfirm>
                <Popconfirm
                  title="拒绝当前策略？"
                  description="旧的已确认策略会保留；系统等待资料或调研变化后生成新版本。"
                  okText="拒绝当前版本"
                  cancelText="取消"
                  onConfirm={() => decide("reject")}
                >
                  <Button danger icon={<CloseCircleOutlined />} loading={working === "reject"}>拒绝当前版本</Button>
                </Popconfirm>
              </Space>
            ) : null}
          </Space>
        ) : null}
      </Card>
    </Space>
  );
}

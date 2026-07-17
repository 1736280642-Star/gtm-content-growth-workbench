"use client";

import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Slider, Space, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { MonthlyPlanConfig, MonthlyPlanGroupQuota, RulePackageOption } from "@/lib/v5/monthly-workspace-contracts";

interface MonthlyPlanConfigPanelProps {
  open: boolean;
  value: MonthlyPlanConfig;
  rulePackages: RulePackageOption[];
  channels: string[];
  onClose: () => void;
  onSave: (value: MonthlyPlanConfig) => Promise<unknown>;
}

function cloneConfig(value: MonthlyPlanConfig): MonthlyPlanConfig {
  return {
    ...value,
    groups: value.groups.map((group) => ({ ...group, selectedChannels: [...group.selectedChannels] }))
  };
}

function isSelectablePackage(item: RulePackageOption) {
  return item.status === "active" && item.monthlyProductionReady;
}

function buildGroup(item: RulePackageOption): MonthlyPlanGroupQuota {
  return {
    groupQuotaId: `group-${item.id}`,
    rulePackageVersionId: item.id,
    productId: item.productId,
    productName: item.productName,
    selectedChannels: item.allowedChannels.slice(0, Math.min(2, item.allowedChannels.length)),
    articleQuota: 1
  };
}

export function MonthlyPlanConfigPanel({ open, value, rulePackages, channels, onClose, onSave }: MonthlyPlanConfigPanelProps) {
  const [messageApi, contextHolder] = message.useMessage();
  const [draft, setDraft] = useState<MonthlyPlanConfig>(() => cloneConfig(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(cloneConfig(value));
    }
  }, [open, value]);

  const selectedPackageIds = useMemo(() => new Set(draft.groups.map((group) => group.rulePackageVersionId)), [draft.groups]);
  const availablePackages = rulePackages.filter(isSelectablePackage);
  const unavailablePackages = rulePackages.filter((item) => !isSelectablePackage(item));
  const unusedPackages = availablePackages.filter((item) => !selectedPackageIds.has(item.id));
  const monthlyTotal = draft.groups.reduce((total, group) => total + group.articleQuota, 0);
  const coveredChannels = Array.from(new Set(draft.groups.flatMap((group) => group.selectedChannels)));
  const explorationRatio = 100 - draft.baselineRatio;
  const issues = [
    !draft.month ? "请选择月份。" : "",
    !draft.businessGoal.trim() ? "请填写月度业务目标。" : "",
    draft.groups.length === 0 ? "至少选择 1 个可进入生产池的规则包。" : "",
    draft.groups.some((group) => group.articleQuota <= 0) ? "每个产品分组的文章数量必须大于 0。" : "",
    draft.groups.some((group) => group.selectedChannels.length === 0) ? "每个产品分组至少选择 1 个发布渠道。" : "",
    selectedPackageIds.size !== draft.groups.length ? "同一个产品规则包不能重复配置。" : "",
    draft.baselineRatio !== 20 && !draft.ratioAdjustmentReason.trim() ? "调整默认 20/80 测试比例时必须填写原因。" : ""
  ].filter(Boolean);

  function getRulePackage(packageId: string) {
    return rulePackages.find((item) => item.id === packageId);
  }

  function updateGroup(index: number, patch: Partial<MonthlyPlanGroupQuota>) {
    setDraft((current) => ({
      ...current,
      groups: current.groups.map((group, groupIndex) => (groupIndex === index ? { ...group, ...patch } : group))
    }));
  }

  function handlePackageChange(index: number, packageId: string) {
    const nextPackage = getRulePackage(packageId);
    if (!nextPackage || !isSelectablePackage(nextPackage)) {
      return;
    }

    updateGroup(index, {
      rulePackageVersionId: nextPackage.id,
      productId: nextPackage.productId,
      productName: nextPackage.productName,
      selectedChannels: nextPackage.allowedChannels.slice(0, Math.min(2, nextPackage.allowedChannels.length))
    });
  }

  function handleAddGroup() {
    const nextPackage = unusedPackages[0];
    if (!nextPackage) {
      messageApi.info("没有更多可用且未选择的规则包。");
      return;
    }

    setDraft((current) => ({ ...current, groups: [...current.groups, buildGroup(nextPackage)] }));
  }

  function handleRemoveGroup(index: number) {
    setDraft((current) => ({ ...current, groups: current.groups.filter((_, groupIndex) => groupIndex !== index) }));
  }

  async function handleSave() {
    if (issues.length) {
      messageApi.warning("请先处理配置缺口。");
      return;
    }

    setSaving(true);
    try {
      await onSave(cloneConfig(draft));
      messageApi.success("月度计划已保存。");
      onClose();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "月度计划保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {contextHolder}
      <Modal
        className="monthly-plan-config-modal"
        width={980}
        open={open}
        title="月度计划配置"
        onCancel={saving ? undefined : onClose}
        footer={
          <Space wrap>
            <Button disabled={saving} onClick={onClose}>取消</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={Boolean(issues.length)}
              loading={saving}
              onClick={handleSave}
              data-testid="monthly-plan-save-button"
            >
              保存配置
            </Button>
          </Space>
        }
      >
        <Alert
          showIcon
          type="info"
          message="选择已审核的产品表达规则"
          description="只有已生效且资料准备充分的产品才能加入本月计划；各渠道篇数将在策略建议中分配。"
          style={{ marginBottom: 16 }}
        />

        <Form layout="vertical" className="monthly-plan-base-form">
          <Form.Item label="月份" required>
            <Input
              type="month"
              value={draft.month}
              data-testid="monthly-plan-month-input"
              onChange={(event) => setDraft((current) => ({ ...current, month: event.target.value }))}
            />
          </Form.Item>
          <Form.Item label="GEO 基线比例" required>
            <div className="monthly-plan-ratio-control">
              <Slider
                min={0}
                max={100}
                step={5}
                value={draft.baselineRatio}
                onChange={(baselineRatio) => setDraft((current) => ({ ...current, baselineRatio }))}
              />
              <Tag color="blue">{`基线 ${draft.baselineRatio}% / 探索 ${explorationRatio}%`}</Tag>
            </div>
          </Form.Item>
          <Form.Item label="月度业务目标" required className="monthly-plan-goal-field">
            <Input.TextArea
              value={draft.businessGoal}
              maxLength={160}
              autoSize={{ minRows: 2, maxRows: 4 }}
              showCount
              data-testid="monthly-plan-goal-input"
              onChange={(event) => setDraft((current) => ({ ...current, businessGoal: event.target.value }))}
            />
          </Form.Item>
        </Form>

        {draft.baselineRatio !== 20 ? (
          <Form layout="vertical">
            <Form.Item label="测试比例调整原因" required>
              <Input
                value={draft.ratioAdjustmentReason}
                placeholder="说明为什么本月不采用默认 20% baseline / 80% exploration"
                onChange={(event) => setDraft((current) => ({ ...current, ratioAdjustmentReason: event.target.value }))}
              />
            </Form.Item>
          </Form>
        ) : null}

        <div className="monthly-plan-groups-header">
          <div>
            <strong>产品分组</strong>
            <div className="monthly-plan-section-caption">选择产品 → 选择渠道 → 填写该产品的月度文章数</div>
          </div>
          <Button icon={<PlusOutlined />} disabled={!unusedPackages.length} onClick={handleAddGroup}>
            新增产品分组
          </Button>
        </div>

        <div className="monthly-plan-group-list">
          {draft.groups.map((group, index) => {
            const selectedPackage = getRulePackage(group.rulePackageVersionId);
            const allowedChannels = selectedPackage?.allowedChannels || channels;

            return (
              <div className="monthly-plan-group-row" key={group.groupQuotaId}>
                <Form.Item label="产品表达规则包" required>
                  <Select
                    value={group.rulePackageVersionId}
                    onChange={(packageId) => handlePackageChange(index, packageId)}
                    options={rulePackages.map((item) => ({
                      value: item.id,
                      disabled: !isSelectablePackage(item) || (selectedPackageIds.has(item.id) && item.id !== group.rulePackageVersionId),
                      label: `${item.productName}${item.disabledReason ? ` · ${item.disabledReason}` : ""}`
                    }))}
                  />
                </Form.Item>
                <Form.Item label="产品">
                  <Input value={group.productName} disabled />
                </Form.Item>
                <Form.Item label="发布渠道" required>
                  <Select
                    mode="multiple"
                    value={group.selectedChannels}
                    maxTagCount="responsive"
                    onChange={(selectedChannels) => updateGroup(index, { selectedChannels })}
                    options={allowedChannels.map((channel) => ({ value: channel, label: channel }))}
                  />
                </Form.Item>
                <Form.Item label="文章数量" required>
                  <InputNumber
                    min={1}
                    max={200}
                    value={group.articleQuota}
                    addonAfter="篇/月"
                    onChange={(articleQuota) => updateGroup(index, { articleQuota: Number(articleQuota || 0) })}
                  />
                </Form.Item>
                <Button
                  aria-label={`删除${group.productName}分组`}
                  title="删除产品分组"
                  icon={<DeleteOutlined />}
                  disabled={draft.groups.length === 1}
                  onClick={() => handleRemoveGroup(index)}
                />
              </div>
            );
          })}
        </div>

        <div className="monthly-plan-summary-bar">
          <span><strong>{monthlyTotal}</strong> 篇月度总量</span>
          <span><strong>{draft.groups.length}</strong> 个产品分组</span>
          <span><strong>{coveredChannels.length}</strong> 个覆盖渠道</span>
          <span><strong>{availablePackages.length}</strong> 个当前可用规则包</span>
        </div>

        {unavailablePackages.length ? (
          <Alert
            className="monthly-plan-unavailable-alert"
            type="warning"
            showIcon
            message="以下规则包不能进入生产池"
            description={unavailablePackages.map((item) => `${item.productName} ${item.version}：${item.disabledReason}`).join("；")}
          />
        ) : null}

        {issues.length ? (
          <Alert
            className="monthly-plan-balance-alert"
            type="warning"
            showIcon
            message="月度计划尚不能保存"
            description={<ul className="monthly-plan-issue-list">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
          />
        ) : null}
      </Modal>
    </>
  );
}

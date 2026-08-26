"use client";

import { ArrowLeftOutlined, CheckOutlined, MailOutlined, SaveOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Checkbox, InputNumber, Spin, Switch } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { HostedAiFrontendTestPanel } from "@/components/HostedAiFrontendTestPanel";
import styles from "../../hosted-mode.module.css";

interface Order {
  orderId: string;
  productId: string;
  productName: string;
  rowVersion: number;
  channels: Array<{ channel: string; dailyCap?: number }>;
  dailyCaps: Record<string, number>;
  notificationPreferences: { dailyDigest: boolean; monthlyCompleted: boolean };
}

interface ChannelOption {
  channel: string;
  capability: "auto_publish" | "draft_only" | "unsupported";
  authorizationStatus: "connected" | "required" | "not_applicable" | "unavailable";
  authorizationPhase: "system_setup" | "needs_login" | "manual_takeover_required" | "needs_account_confirmation" | "connected";
  accountCandidate?: string;
  accountCandidateLabel?: string;
  accountBindingVersion?: number;
  detail: string;
  nextAction?: string;
}

const channelLabels: Record<string, string> = { wechat: "微信公众号", zhihu: "知乎", csdn: "CSDN", juejin: "掘金" };

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return String(record.message || fallback);
}

export default function HostedSettingsPage() {
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<Order>();
  const [options, setOptions] = useState<ChannelOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [caps, setCaps] = useState<Record<string, number | undefined>>({});
  const [dailyDigest, setDailyDigest] = useState(true);
  const [monthlyCompleted, setMonthlyCompleted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [connectingChannel, setConnectingChannel] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async (targetOrderId: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const orderResponse = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(targetOrderId)}`, { cache: "no-store" });
      const orderPayload = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(readError(orderPayload, "托管设置读取失败。"));
      const nextOrder = orderPayload.order as Order;
      const channelResponse = await fetch(`/api/v5/hosted/channels?productId=${encodeURIComponent(nextOrder.productId)}`, { cache: "no-store" });
      const channelPayload = await channelResponse.json();
      if (!channelResponse.ok) throw new Error(readError(channelPayload, "渠道状态读取失败。"));
      setOrder(nextOrder);
      setOptions(Array.isArray(channelPayload.channels) ? channelPayload.channels : []);
      setSelected(nextOrder.channels.map((item) => item.channel));
      setCaps(nextOrder.dailyCaps || {});
      setDailyDigest(nextOrder.notificationPreferences.dailyDigest);
      setMonthlyCompleted(nextOrder.notificationPreferences.monthlyCompleted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "托管设置读取失败。请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const targetOrderId = new URLSearchParams(window.location.search).get("orderId")?.trim() || "";
    setOrderId(targetOrderId);
    if (targetOrderId) void load(targetOrderId);
    else { setError("缺少托管任务编号。"); setLoading(false); }
  }, [load]);

  async function save() {
    if (!order || !selected.length) return setError("至少保留一个托管渠道。");
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      const response = await fetch(`/api/v5/hosted/orders/${encodeURIComponent(order.orderId)}/settings`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": `hosted-settings-${crypto.randomUUID()}` },
        body: JSON.stringify({
          expectedVersion: order.rowVersion,
          channels: selected.map((channel) => ({ channel, ...(caps[channel] ? { dailyCap: caps[channel] } : {}) })),
          dailyDigest,
          monthlyCompleted
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "设置保存失败。"));
      setOrder(payload.order as Order);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设置保存失败。请刷新后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function confirmChannelAccount(option: ChannelOption) {
    if (!order || !option.accountCandidate) return;
    setConnectingChannel(option.channel);
    setError(undefined);
    try {
      const idempotencyKey = `hosted-account-${order.orderId}-${option.channel}-${crypto.randomUUID()}`;
      const response = await fetch(`/api/v5/products/${encodeURIComponent(order.productId)}/publish-account-binding`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({ platform: option.channel, accountLabel: option.accountCandidate, expectedVersion: option.accountBindingVersion || 0, idempotencyKey })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "发布账号确认失败。"));
      await load(order.orderId);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发布账号确认失败。请刷新后重试。");
    } finally {
      setConnectingChannel(undefined);
    }
  }

  if (loading) return <div className={styles.reviewLoading}><Spin /><span>正在读取托管设置</span></div>;
  if (!order) return <div className={styles.reviewError}><strong>无法打开托管设置</strong><span>{error}</span><Link href="/"><Button>返回发起推广</Button></Link></div>;

  return (
    <div className={styles.settingsPage}>
      <header className={styles.settingsHeader}><div><div className={styles.kicker}>MANAGED SETTINGS</div><h1>{order.productName} 的托管设置</h1><p>只保留会改变自动执行结果的选项。策略和内部指标仍由系统管理。</p></div><Link href={`/hosted/success?orderId=${encodeURIComponent(order.orderId)}`}><Button icon={<ArrowLeftOutlined />}>返回托管状态</Button></Link></header>
      <section className={styles.settingsCard}><div className={styles.settingsTitle}><SettingOutlined /><div><strong>渠道与每日上限</strong><span>关闭渠道会阻止尚未进入发布作业的内容；已交给平台处理或已公开的内容不会撤回。自定义上限只能收紧系统安全上限。</span></div></div><div className={styles.settingsRows}>{options.map((option) => {
        const checked = selected.includes(option.channel);
        const disabled = option.capability !== "auto_publish";
        const authorizationControl = !checked || option.authorizationStatus !== "required"
          ? null
          : option.channel === "wechat"
            ? option.authorizationPhase === "needs_account_confirmation" && option.accountCandidate
              ? <Button size="small" loading={connectingChannel === option.channel} onClick={() => confirmChannelAccount(option)}>确认使用 {option.accountCandidateLabel || "此公众号"}</Button>
              : <Link href={`/?orderId=${encodeURIComponent(order.orderId)}#setup-accounts`}><Button size="small">按引导连接公众号</Button></Link>
            : <Link href={`/hosted/connections?orderId=${encodeURIComponent(order.orderId)}`}><Button size="small">{option.authorizationPhase === "needs_account_confirmation" ? "确认发布账号" : option.authorizationPhase === "manual_takeover_required" ? "完成安全验证" : "连接发布账号"}</Button></Link>;
        return <div className={styles.settingsRow} key={option.channel}><Checkbox checked={checked} disabled={disabled} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, option.channel])] : current.filter((item) => item !== option.channel))}><strong>{channelLabels[option.channel] || option.channel}</strong><span>{option.detail}</span></Checkbox><div className={styles.channelControls}><div className={styles.capControl}><InputNumber min={1} max={100} value={caps[option.channel]} disabled={!checked || disabled} placeholder="系统上限" onChange={(value) => setCaps((current) => ({ ...current, [option.channel]: value || undefined }))} /><small>篇 / 日</small></div>{authorizationControl}</div></div>;
      })}</div></section>
      <section className={styles.settingsCard}><div className={styles.settingsTitle}><MailOutlined /><div><strong>结果通知</strong><span>需要你操作的策略、样文和异常邮件不能关闭。</span></div></div><div className={styles.switchRows}><label><span><strong>每日 URL 汇总</strong><small>当日批次关闭后发送一封</small></span><Switch checked={dailyDigest} onChange={setDailyDigest} /></label><label><span><strong>月度完成通知</strong><small>MonthlyReview 形成后发送结果</small></span><Switch checked={monthlyCompleted} onChange={setMonthlyCompleted} /></label></div></section>
      <section className={styles.settingsCard}><div className={styles.settingsTitle}><SettingOutlined /><div><strong>AI 前台验证（可选）</strong><span>不影响托管主流程；需要复测当前产品的 AI 提及时，再点击已绑定账号。</span></div></div><HostedAiFrontendTestPanel productId={order.productId} /></section>
      {error ? <div className={styles.formError}><strong>暂时不能保存</strong><span>{error}</span></div> : null}
      {saved ? <div className={styles.savedNotice}><CheckOutlined /> 设置已生效，系统会自动重新检查并继续托管。</div> : null}
      <div className={styles.settingsActions}><Button type="primary" size="large" icon={<SaveOutlined />} loading={saving} onClick={save}>保存托管设置</Button></div>
    </div>
  );
}

"use client";

import { CheckOutlined, MailOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Spin, Switch } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../../../hosted-mode.module.css";

interface PreferenceOrder {
  orderId: string;
  productName: string;
  rowVersion: number;
  notificationPreferences: { dailyDigest: boolean; actionRequired: true; monthlyCompleted: boolean };
}

function readError(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return String(record.message || fallback);
}

export default function HostedPreferencesPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [order, setOrder] = useState<PreferenceOrder>();
  const [dailyDigest, setDailyDigest] = useState(true);
  const [monthlyCompleted, setMonthlyCompleted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async (targetToken: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/preferences/${encodeURIComponent(targetToken)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "通知偏好读取失败。"));
      const nextOrder = payload.order as PreferenceOrder;
      setOrder(nextOrder);
      setDailyDigest(nextOrder.notificationPreferences.dailyDigest);
      setMonthlyCompleted(nextOrder.notificationPreferences.monthlyCompleted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "通知偏好读取失败。请重新打开邮件中的链接。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void params.then(({ token: targetToken }) => {
      setToken(targetToken);
      void load(targetToken);
    });
  }, [load, params]);

  async function save() {
    if (!order || !token) return;
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      const response = await fetch(`/api/v5/hosted/preferences/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": `hosted-preference-${crypto.randomUUID()}` },
        body: JSON.stringify({ dailyDigest, monthlyCompleted, expectedVersion: order.rowVersion })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readError(payload, "通知偏好保存失败。"));
      setOrder(payload.order as PreferenceOrder);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "通知偏好保存失败。请刷新后重试。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.reviewLoading}><Spin /><span>正在读取通知偏好</span></div>;
  if (!order) return <div className={styles.reviewError}><strong>这个通知偏好链接不可用</strong><span>{error}</span></div>;

  return (
    <div className={styles.settingsPage}>
      <header className={styles.settingsHeader}><div><div className={styles.kicker}>EMAIL PREFERENCES</div><h1>{order.productName} 的通知偏好</h1><p>关闭结果汇总不会暂停托管。需要你确认或处理异常的邮件仍会发送，避免任务无声卡住。</p></div><Link href={`/hosted/success?orderId=${encodeURIComponent(order.orderId)}`}><Button>查看托管状态</Button></Link></header>
      <section className={styles.settingsCard}><div className={styles.settingsTitle}><MailOutlined /><div><strong>可选结果通知</strong><span>设置立即生效，后续邮件中的链接也可以再次修改。</span></div></div><div className={styles.switchRows}><label><span><strong>每日 URL 汇总</strong><small>当日批次关闭后发送一封；关闭相当于退订每日结果</small></span><Switch checked={dailyDigest} onChange={setDailyDigest} /></label><label><span><strong>月度完成通知</strong><small>当月发布任务全部收口后发送</small></span><Switch checked={monthlyCompleted} onChange={setMonthlyCompleted} /></label><label><span><strong>必须处理的行动邮件</strong><small>策略、样文、授权失效和阻断，不能关闭</small></span><Switch checked disabled /></label></div></section>
      {error ? <div className={styles.formError}><strong>暂时不能保存</strong><span>{error}</span></div> : null}
      {saved ? <div className={styles.savedNotice}><CheckOutlined /> 通知偏好已更新。</div> : null}
      <div className={styles.settingsActions}><Button type="primary" size="large" icon={<SaveOutlined />} loading={saving} onClick={save}>保存通知偏好</Button></div>
    </div>
  );
}

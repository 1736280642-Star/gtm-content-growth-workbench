"use client";

import { ArrowRightOutlined, CheckCircleFilled, ClockCircleOutlined, FileTextOutlined, MailOutlined, PauseCircleOutlined, SettingOutlined } from "@ant-design/icons";
import { Button } from "antd";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../../hosted-mode.module.css";

interface ProductInfo {
  productId: string;
  displayName: string;
  isNew: boolean;
  officialUrl?: string;
  materials?: Array<{ name: string; size: number }>;
}

interface HostedTaskData {
  email?: string;
  product?: ProductInfo;
  channels?: string[];
  expression?: string;
}

const fallback: Required<HostedTaskData> = {
  email: "marketing@example.cn",
  product: { productId: "tencent-adp", displayName: "腾讯云 ADP", isNew: false },
  channels: ["微信公众号", "知乎"],
  expression: "系统推荐"
};

export default function HostedSuccessPage() {
  const [task, setTask] = useState<Required<HostedTaskData>>(fallback);

  useEffect(() => {
    window.scrollTo(0, 0);
    const stored = window.sessionStorage.getItem("joto-hosted-task");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as HostedTaskData;
      setTask({
        email: parsed.email || fallback.email,
        product: parsed.product || fallback.product,
        channels: parsed.channels?.length ? parsed.channels : fallback.channels,
        expression: parsed.expression || fallback.expression
      });
    } catch {
      // Keep the deterministic preview when session data is unavailable.
    }
  }, []);

  const materialCount = task.product.materials?.length ?? 0;
  const hasUrl = !!task.product.officialUrl;
  const productMaterialLabel = task.product.isNew
    ? (hasUrl && materialCount ? `${materialCount} 份文件 + 官网链接` : hasUrl ? "官网链接" : `${materialCount} 份资料`)
    : "知识库已就绪";

  return (
    <div className={styles.successPage}>
      <section className={styles.successIntro}>
        <span className={styles.successIcon}><CheckCircleFilled /></span>
        <div className={styles.kicker}>HANDOFF ACCEPTED · JOTO-0820-01</div>
        <h1>已交给系统，可以关掉页面了。</h1>
        <p>{task.email} 会收到发布 URL、平台反馈和测试结论。系统会在后台继续完成本月内容生产与发布，不需要你守着进度。</p>
      </section>

      <div className={styles.successGrid}>
        <section className={styles.successPanel}>
          <div className={styles.successPanelHeader}><h2>托管回执</h2><span className={styles.statusPill}>自动运行中</span></div>
          <div className={styles.taskFacts}>
            <div className={styles.taskFact}><span>推广产品</span><strong>{task.product.displayName}</strong></div>
            <div className={styles.taskFact}><span>资料状态</span><strong>{productMaterialLabel}</strong></div>
            <div className={styles.taskFact}><span>发布渠道</span><strong>{task.channels.join("、")}</strong></div>
          </div>
          <div className={styles.timeline}>
            <div className={`${styles.timelineItem} ${styles.isActive}`}>
              <span className={styles.timelineDot} />
              <div className={styles.timelineCopy}>
                <strong>{task.product.isNew ? "构建产品知识库" : "整理产品资料"}</strong>
                <span>{task.product.isNew ? "系统正在从官网和资料中提取产品事实、用户问题和可引用证据" : "系统正在提取产品事实、用户问题和可引用证据"}</span>
              </div>
              <span className={styles.timelineTime}>现在</span>
            </div>
            <div className={styles.timelineItem}><span className={styles.timelineDot} /><div className={styles.timelineCopy}><strong>生成文章组合</strong><span>会根据资料质量和渠道特点自动决定数量</span></div><span className={styles.timelineTime}>即将开始</span></div>
            <div className={styles.timelineItem}><span className={styles.timelineDot} /><div className={styles.timelineCopy}><strong>批量发布</strong><span>按账号额度排程，发布成功后自动回填公开 URL</span></div><span className={styles.timelineTime}>本月周期内</span></div>
            <div className={styles.timelineItem}><span className={styles.timelineDot} /><div className={styles.timelineCopy}><strong>效果反馈</strong><span>获得公开结果后发送首封结果邮件，并在 24h / 72h 继续测试</span></div><span className={styles.timelineTime}>8 月 21 日起</span></div>
          </div>
        </section>

        <aside className={styles.successSide}>
          <div className={styles.mailNotice}><strong><MailOutlined /> 结果会发到阿里邮箱</strong><span>{task.email}<br />下一封更新：完成首批发布后</span></div>
          <div className={styles.sideNote}><strong>这期间你不需要做什么</strong><span>不需要打开页面等待、不需要手动生成文章，也不需要逐条确认正常发布。只有产品事实冲突、账号授权失效等无法自动判断的情况才会收到操作请求。</span></div>
          <div className={styles.sideNote}><strong>想看更细的过程？</strong><span>运营控制台保留策略包、排程、发布生命周期和原始指标。</span><Link className={styles.sideLink} href="/content-automation">进入运营控制台 <ArrowRightOutlined /></Link></div>
        </aside>
      </div>

      <div className={styles.successActions}>
        <Link href="/hosted/email"><Button type="primary" icon={<MailOutlined />}>预览结果邮件</Button></Link>
        <Link href="/"><Button icon={<FileTextOutlined />}>再发起一项推广</Button></Link>
        <Button type="text" icon={<PauseCircleOutlined />}>暂停这项推广</Button>
        <Button type="text" icon={<SettingOutlined />}>通知设置</Button>
      </div>
    </div>
  );
}

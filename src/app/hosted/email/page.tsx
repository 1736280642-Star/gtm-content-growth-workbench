"use client";

import { ArrowLeftOutlined, ArrowRightOutlined, CheckCircleFilled, LinkOutlined, MailOutlined } from "@ant-design/icons";
import { Button } from "antd";
import Link from "next/link";
import { useEffect } from "react";
import styles from "../../hosted-mode.module.css";

const results = [
  { title: "WorkBuddy 如何把团队知识变成可执行的工作流", channel: "微信公众号", time: "今天 10:12", url: "查看公开文章" },
  { title: "企业为什么需要一个能记住上下文的 AI 助手？", channel: "知乎", time: "今天 10:18", url: "查看公开文章" },
  { title: "从资料整理到任务执行：WorkBuddy 的真实使用场景", channel: "微信公众号", time: "今天 11:04", url: "查看公开文章" },
  { title: "AI 工作流选型时，如何判断产品是否真的能落地", channel: "知乎", time: "等待平台审核", url: "查看发布状态" }
];

export default function HostedEmailPreviewPage() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className={styles.emailPage}>
      <div className={styles.emailToolbar}>
        <div><h1>结果邮件预览</h1><span>模拟阿里邮箱收件视图 · 公开 URL 和测试结论优先</span></div>
        <Link href="/hosted/success"><Button icon={<ArrowLeftOutlined />}>返回托管回执</Button></Link>
      </div>

      <section className={styles.mailWindow} aria-label="结果邮件">
        <div className={styles.mailChrome}><div className={styles.mailChromeBrand}><i>邮</i> 阿里邮箱 <span>收件箱 / JOTO GTM</span></div><span>结果通知 · 2026-08-18 18:00</span></div>
        <article className={styles.mailBody}>
          <header className={styles.mailMeta}>
            <h2>今日发布完成：4 篇文章，3 个公开 URL</h2>
            <div className={styles.mailSender}><span className={styles.senderAvatar}>J</span><div><strong>JOTO GTM · 自动结果通知</strong><span>noreply@joto.ai · 发给 marketing@example.cn</span></div></div>
          </header>

          <div className={styles.mailConclusion}><strong><CheckCircleFilled /> 先看结论</strong><p>JOTO WorkBuddy 的首批内容已完成发布。场景型表达在 AI 测试回答中表现更好，已有 2 次回答主动提到产品名称；1 篇仍在等待平台审核，系统会自动跟踪。</p></div>

          <section className={styles.mailSection}><h3>公开结果</h3><div className={styles.resultList}>{results.map((result) => <div className={styles.resultRow} key={`${result.title}-${result.channel}`}><div className={styles.resultIdentity}><strong>{result.title}</strong><span>{result.time}</span></div><span className={styles.resultChannel}>{result.channel}</span><a className={styles.resultLink} href="#result"><LinkOutlined /> {result.url}</a></div>)}</div></section>

          <section className={styles.mailSection}><h3>首轮测试反馈</h3><div className={styles.effectGrid}><div className={styles.effectItem}><strong>7 / 10</strong><span>AI 测试问题中出现品牌或产品</span></div><div className={styles.effectItem}><strong>2 次</strong><span>回答主动引用产品名称</span></div><div className={styles.effectItem}><strong>↑ 18%</strong><span>相比上次测试的可见度变化</span></div></div></section>

          <div className={styles.mailActions}><Link href="/content-monitor"><Button type="primary" icon={<ArrowRightOutlined />}>查看完整结果</Button></Link><Link href="/"><Button icon={<MailOutlined />}>继续发起推广</Button></Link></div>
          <footer className={styles.mailFooter}>这封邮件只汇总已经产生的结果。平台审核、URL 稳定性和 24h / 72h 效果测试会继续自动更新；如果不需要你判断，系统不会重复打扰。</footer>
        </article>
      </section>
    </div>
  );
}

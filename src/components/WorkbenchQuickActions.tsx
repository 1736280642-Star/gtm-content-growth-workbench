import { BookOutlined, CloudUploadOutlined, ExceptionOutlined, LineChartOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card } from "antd";
import Link from "next/link";

const actions = [
  { key: "product", icon: <PlusOutlined />, title: "绑定产品", detail: "登记产品身份与官网，系统据此建立调研边界。", href: "/products/new", label: "登记产品" },
  { key: "upload", icon: <CloudUploadOutlined />, title: "管理产品资料", detail: "先选择产品或服务，再在对应页面上传文档或网页。", href: "/products", label: "选择产品", primary: true },
  { key: "strategy", icon: <BookOutlined />, title: "查看自动策略", detail: "查看系统生成的问题、内容类型、矩阵和生产进度。", href: "/monthly-plan", label: "进入内容中心" },
  { key: "exception", icon: <ExceptionOutlined />, title: "处理异常", detail: "只查看证据不足、连接缺失或发布失败等需人工判断事项。", href: "/monthly-plan?step=production", label: "查看异常" },
  { key: "review", icon: <LineChartOutlined />, title: "查看复盘", detail: "汇总发布回传、官网监控和 GEO 数据表现。", href: "/geo-monitor?tab=review", label: "查看数据复盘" }
];

export function WorkbenchQuickActions() {
  return (
    <section className="quick-action-section" aria-label="工作台快捷入口">
      <div className="quick-action-heading">
        <div><span>START HERE</span><h2>你只需绑定产品并上传知识</h2></div>
        <p>调研、问题与关键词、策略、生产、排程和监控由系统持续完成。</p>
      </div>
      <div className="quick-action-grid">
        {actions.map((action) => (
          <Card key={action.key} size="small" className={action.primary ? "quick-action-card is-primary" : "quick-action-card"}>
            <div className="quick-action-icon">{action.icon}</div>
            <strong>{action.title}</strong>
            <p>{action.detail}</p>
            <Link href={action.href}><Button type={action.primary ? "primary" : "link"}>{action.label}</Button></Link>
          </Card>
        ))}
      </div>
    </section>
  );
}

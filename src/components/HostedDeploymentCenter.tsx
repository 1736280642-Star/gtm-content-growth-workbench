"use client";

import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CheckOutlined,
  ChromeOutlined,
  CloudServerOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  LaptopOutlined,
  LinkOutlined,
  LockOutlined,
  MailOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserOutlined
} from "@ant-design/icons";
import { Button, Input, Spin } from "antd";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { HostedDeploymentFeature, HostedDeploymentMode } from "@/lib/v5/hosted-deployment-readiness";
import styles from "@/app/hosted-mode.module.css";

const HostedAiCaptureDeploymentGuide = dynamic(
  () => import("@/components/HostedAiCaptureDeploymentGuide").then((module) => module.HostedAiCaptureDeploymentGuide),
  {
    ssr: false,
    loading: () => <div className={styles.embeddedConnectionLoading}><Spin /><span>正在加载共享采集服务器控制台</span></div>
  }
);

interface SenderSetupStatus {
  configured: boolean;
  provider?: string;
  senderHint?: string;
}

interface HostedDeploymentCenterProps {
  senderStatus?: SenderSetupStatus;
  senderStatusLoading: boolean;
  onReloadSenderStatus: () => void;
  onSwitchToUserTest: () => void;
}

type Requirement = "required" | "conditional" | "optional" | "default" | "generated";

interface ConfigField {
  name: string;
  title: string;
  description: string;
  requirement: Requirement;
  location: string;
  source: string;
  sourceUrl?: string;
  example?: string;
}

interface ReadinessResult {
  readyGroups: number;
  totalGroups: number;
  configurationReady: boolean;
  groups: Array<{
    id: string;
    label: string;
    missing: string[];
    ready: boolean;
    manualChecks: string[];
  }>;
  safety: { directPublishEnabled: boolean; directPublishMock: boolean };
  sender?: SenderSetupStatus;
}

const requirementLabels: Record<Requirement, string> = {
  required: "必填",
  conditional: "条件必填",
  optional: "可选",
  default: "有默认值",
  generated: "自行生成"
};

const deploymentModes: Array<{ id: HostedDeploymentMode; title: string; description: string; icon: ReactNode }> = [
  { id: "docker", title: "本地 Docker", description: "在当前电脑运行 3027、MySQL、OpenSearch 和 Worker，适合本地验收。", icon: <LaptopOutlined /> },
  { id: "server", title: "服务器部署", description: "在 24 小时在线的自有服务器运行完整 Docker 服务与执行器。", icon: <CloudServerOutlined /> }
];

const allDeploymentFeatures: HostedDeploymentFeature[] = [
  "email",
  "geo",
  "wechat",
  "browser_publish",
  "metrics",
  "capture"
];

const runtimeDockerFields: ConfigField[] = [
  { name: "MYSQL_PASSWORD", title: "业务数据库密码", description: "Workbench 连接 MySQL 使用。首次建库后不要随意更换。", requirement: "required", location: "项目根 .env", source: "由部署脚本自动生成，或使用密码管理器生成独立随机值。", example: "replace-with-a-long-random-password" },
  { name: "MYSQL_ROOT_PASSWORD", title: "MySQL root 密码", description: "只用于数据库初始化和运维，必须与业务密码不同。", requirement: "required", location: "项目根 .env", source: "由部署脚本自动生成，或使用密码管理器生成另一条随机值。", example: "replace-with-a-different-random-password" },
  { name: "MYSQL_DATABASE / MYSQL_USER", title: "数据库名与业务用户", description: "默认值已能直接运行，新部署通常不用修改。", requirement: "default", location: "项目根 .env", source: "复制仓库 .env.example 的默认值。", example: "MYSQL_DATABASE=joto_workbench\nMYSQL_USER=joto" },
  { name: "OPENSEARCH_*", title: "OpenSearch 端口与内存", description: "正式 RAG 使用。只有端口冲突或资源不足时才调整。", requirement: "default", location: "项目根 .env", source: "复制仓库默认值，建议部署机至少分配 1 GB JVM 内存。", example: "OPENSEARCH_EXPOSE_PORT=9200\nOPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g" }
];

const runtimeServerFields: ConfigField[] = [
  { name: "MYSQL_PASSWORD", title: "业务数据库密码", description: "Workbench 容器连接 MySQL 使用。首次建库后不要随意更换。", requirement: "required", location: "服务器项目根 .env", source: "使用密码管理器生成独立长随机值。" },
  { name: "MYSQL_ROOT_PASSWORD", title: "MySQL root 密码", description: "只用于数据库初始化和运维，必须与业务密码不同。", requirement: "required", location: "服务器项目根 .env", source: "生成另一条独立长随机值。" },
  { name: "HOSTED_PUBLIC_BASE_URL", title: "服务器 HTTPS 域名", description: "用于登录邮件、审核链接和扩展回传，必须能被用户访问。", requirement: "required", location: "服务器 .env.local", source: "使用已解析到服务器并完成 HTTPS 反向代理的域名。", example: "https://workbench.your-domain.example" },
  { name: "MYSQL_DATABASE / MYSQL_USER / OPENSEARCH_*", title: "数据库与检索默认项", description: "沿用仓库默认值即可；只在端口冲突或容量规划需要时修改。", requirement: "default", location: "服务器项目根 .env", source: "复制仓库 .env.example 的已填默认值。" }
];

const aiFields: ConfigField[] = [
  { name: "DASHSCOPE_API_KEY", title: "阿里云百炼 API Key", description: "用于 Qwen 内容生成和默认 Embedding，是完整内容链路的核心凭证。", requirement: "required", location: "部署机 .env.local", source: "阿里云百炼控制台 → API Key → 创建 API Key。", sourceUrl: "https://help.aliyun.com/zh/model-studio/get-api-key", example: "sk-your-dashscope-key" },
  { name: "QWEN_MODEL", title: "内容生成模型", description: "默认 qwen-plus。只有经过成本和质量验收后才修改。", requirement: "default", location: "部署机 .env.local", source: "使用仓库推荐默认值。", example: "qwen-plus" },
  { name: "QWEN_EMBEDDING_MODEL", title: "向量模型", description: "默认 text-embedding-v3，正式 RAG 使用。", requirement: "default", location: "部署机 .env.local", source: "使用仓库推荐默认值。", example: "text-embedding-v3" },
  { name: "GEO_RESEARCH_ZHIPU_API_KEY", title: "智谱 GEO 编排 Key", description: "智谱负责 GEO 语义综合和编排，启用完整 GEO 调研时必填。", requirement: "required", location: "部署机 .env.local", source: "智谱开放平台 → API Keys → 创建 API Key。", sourceUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys" },
  { name: "GEO_RESEARCH_DOUBAO_API_KEY / MODEL", title: "豆包事实搜索", description: "需要把事实搜索扩展到豆包时填写；不启用豆包可留空。", requirement: "optional", location: "部署机 .env.local", source: "火山方舟 → 系统管理 → API Key 管理；模型值填写已开通的推理接入点。", sourceUrl: "https://console.volcengine.com/ark" },
  { name: "GEO_RESEARCH_QWEN_API_KEY", title: "独立 Qwen GEO Key", description: "留空时复用 DASHSCOPE_API_KEY，只有需要供应商隔离或独立计费时单独创建。", requirement: "optional", location: "部署机 .env.local", source: "与 DASHSCOPE_API_KEY 使用同一百炼入口。", sourceUrl: "https://help.aliyun.com/zh/model-studio/get-api-key" }
];

const emailFields: ConfigField[] = [
  { name: "HOSTED_PUBLIC_BASE_URL", title: "用户访问地址", description: "生成登录、审核和偏好设置链接。本地验收用 3027，服务器使用 HTTPS 域名。", requirement: "required", location: "部署机 .env.local", source: "本地 Docker 填 http://127.0.0.1:3027；服务器填反向代理后的 HTTPS 域名。", example: "http://127.0.0.1:3027" },
  { name: "HOSTED_REVIEW_LINK_SECRET", title: "安全链接签名密钥", description: "防止审核链接和设置链接被伪造。", requirement: "generated", location: "部署机 .env.local", source: "在部署机生成 32 字节随机值。", example: "node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"" },
  { name: "HOSTED_EMAIL_SETUP_TOKEN", title: "部署级 Setup Token", description: "保护发件邮箱和部署检查入口，普通用户不需要知道。", requirement: "generated", location: "部署机 .env.local", source: "在部署机生成独立的 32 字节随机值。", example: "node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"" },
  { name: "HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY", title: "邮箱凭证加密密钥", description: "加密保存 SMTP 或 OAuth 凭证。更换后必须重新连接邮箱。", requirement: "generated", location: "部署机 .env.local", source: "在部署机生成 32 字节随机值，输出为 64 位 hex。", example: "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"" },
  { name: "HOSTED_EMAIL_OAUTH_REDIRECT_BASE_URL", title: "OAuth 返回地址", description: "只有 Gmail 或 Outlook OAuth 需要。填写域名，不带末尾斜杠。", requirement: "conditional", location: "部署机 .env.local", source: "本机验收使用 http://127.0.0.1:3027；服务器使用正式 HTTPS 域名。" },
  { name: "HOSTED_EMAIL_GOOGLE_CLIENT_ID / SECRET", title: "Google OAuth 应用", description: "Gmail 发件授权需要。Secret 只能保存在服务端。", requirement: "conditional", location: "部署机 .env.local", source: "Google Auth Platform → Clients → Create client → Web application。", sourceUrl: "https://console.cloud.google.com/auth/clients" },
  { name: "HOSTED_EMAIL_MICROSOFT_CLIENT_ID / SECRET", title: "Microsoft OAuth 应用", description: "Outlook 发件授权需要。复制 Secret Value，不是 Secret ID。", requirement: "conditional", location: "部署机 .env.local", source: "Microsoft Entra → App registrations → New registration。", sourceUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" },
  { name: "HOSTED_EMAIL_DELIVERY_URL / TOKEN", title: "统一邮件中继", description: "只有选择外部邮件服务而不使用个人发件邮箱时填写。", requirement: "optional", location: "部署机 .env.local", source: "由企业邮件中继或邮件 API 服务管理员提供。" }
];

const publishFields: ConfigField[] = [
  { name: "PUBLISH_EXECUTOR_REGISTRATION_SECRET", title: "执行节点注册密钥", description: "浏览器执行节点首次注册时使用，不能发给普通用户。", requirement: "conditional", location: "部署机 .env.local", source: "部署人员自行生成 32 字节随机值。", example: "node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"" },
  { name: "JOTO_PUBLISH_RUNNER_TOKEN", title: "发布 Runner Token", description: "Workbench 与发布 Runner 相互鉴权，双方填写完全相同的值。", requirement: "conditional", location: "部署机 .env.local 与 Runner", source: "部署人员自行生成另一条 32 字节随机值。" },
  { name: "JOTO_PUBLISH_RUNNER_URL", title: "发布 Runner 地址", description: "Docker 内已有默认地址；只有 Runner 与 Workbench 分机部署时才需要修改。", requirement: "default", location: "部署机 .env.local", source: "同机部署使用仓库默认值。", example: "http://host.docker.internal:9530" },
  { name: "WECHATSYNC_BRIDGE_TOKEN", title: "旧版 Bridge Token", description: "只在启用本机 Wechatsync Bridge 时填写，必须与 Bridge 进程一致。", requirement: "conditional", location: ".env.local 与 Bridge 本机", source: "部署人员自行生成，不从第三方平台获取。" },
  { name: "DIRECT_PUBLISH_ENABLED / DIRECT_PUBLISH_MOCK", title: "真实发布安全开关", description: "首次部署保持关闭和模拟。模拟验收通过后才允许开启真实写入。", requirement: "default", location: "部署机 .env.local", source: "使用安全默认值。", example: "DIRECT_PUBLISH_ENABLED=false\nDIRECT_PUBLISH_MOCK=true" }
];

const channelFields: ConfigField[] = [
  { name: "WECHAT_MP_APP_ID", title: "微信公众号 AppID", description: "选择微信公众号发布时必填，用于识别公众号和调用官方接口。", requirement: "conditional", location: "部署机 .env.local", source: "微信公众平台 → 设置与开发 → 基本配置。", sourceUrl: "https://mp.weixin.qq.com/" },
  { name: "WECHAT_MP_APP_SECRET", title: "微信公众号 AppSecret", description: "只保存在服务端。重置后旧值会立即失效。", requirement: "conditional", location: "部署机 .env.local", source: "微信公众平台同一基本配置页面生成或重置。", sourceUrl: "https://mp.weixin.qq.com/" },
  { name: "WECHAT_MP_THUMB_MEDIA_ID / IMAGE_PATH", title: "公众号封面来源", description: "自动创建草稿时二选一。已有永久素材填 media_id，本机部署也可填图片路径。", requirement: "conditional", location: ".env.local", source: "从公众号素材库获取 media_id，或使用部署机上的合规封面文件。" },
  { name: "知乎 / CSDN / 掘金账号", title: "浏览器渠道账号", description: "普通用户只在平台官方页面登录，工作台不要求在前端填写密码或 Cookie。", requirement: "conditional", location: "普通用户第 5 步", source: "在工作台点击连接后跳转到平台官方登录页。" }
];

const optionalFields: ConfigField[] = [
  { name: "CONTENT_METRICS_RUNNER_TOKEN", title: "指标 Runner Token", description: "启用自动指标回收时必填，Workbench 与指标 Runner 使用同一随机值。", requirement: "conditional", location: "部署机 .env.local", source: "部署人员自行生成 32 字节随机值。" },
  { name: "HOSTED_CAPTURE_SETUP_TOKEN", title: "AI 共享采集部署口令", description: "保护部署人员的采集服务器控制台。", requirement: "conditional", location: "部署机 .env.local", source: "部署人员自行生成，不能发给普通用户。" },
  { name: "V5_CAPTURE_EXTENSION_ID / V5_WORKBENCH_BASE_URL", title: "采集伴侣绑定", description: "只填写在常开 Windows 电脑，不能放在普通用户浏览器。", requirement: "conditional", location: "共享 Windows 电脑", source: "扩展 ID 来自 Chrome 扩展程序页；Base URL 使用正式工作台域名。" },
  { name: "WECHAT_VISUAL_IMAGE_*", title: "AI 配图服务", description: "需要自动生成微信公众号封面候选时才配置。", requirement: "optional", location: "部署机 .env.local", source: "从所选 OpenAI-compatible Images API 服务商获取 Base URL、API Key 和模型名。" },
  { name: "SITE_AUDIT_RENDERER_URL / TOKEN", title: "网站渲染服务", description: "只有需要审计大量客户端渲染页面时填写，留空会安全地标记为未验证。", requirement: "optional", location: "部署机 .env.local", source: "由自建或企业浏览器渲染服务提供。" }
];

function StepHeader({ number, title, description, state = "active" }: { number: number; title: string; description: string; state?: "active" | "done" | "optional" }) {
  return (
    <div className={styles.deploymentStepHeader}>
      <span>{number}</span>
      <div><h2>{title}</h2><p>{description}</p></div>
      <b className={styles[`deploymentStep-${state}`]}>{state === "done" ? "已完成" : state === "optional" ? "按需配置" : "需要操作"}</b>
    </div>
  );
}

function FieldGrid({ fields }: { fields: ConfigField[] }) {
  return (
    <div className={styles.deploymentFieldGrid}>
      {fields.map((field) => (
        <article className={styles.deploymentFieldCard} key={field.name}>
          <div className={styles.deploymentFieldTop}><code>{field.name}</code><span className={styles[`requirement-${field.requirement}`]}>{requirementLabels[field.requirement]}</span></div>
          <strong>{field.title}</strong>
          <p>{field.description}</p>
          <dl>
            <div><dt>填写位置</dt><dd>{field.location}</dd></div>
            <div><dt>值从哪里来</dt><dd>{field.source}</dd></div>
          </dl>
          {field.example ? <pre>{field.example}</pre> : null}
          {field.sourceUrl ? <a href={field.sourceUrl} target="_blank" rel="noreferrer">打开官方获取入口 <ArrowRightOutlined /></a> : null}
        </article>
      ))}
    </div>
  );
}

function buildTemplates(mode: HostedDeploymentMode, features: HostedDeploymentFeature[]) {
  const selected = new Set(features);
  const baseUrl = mode === "server" ? "https://workbench.your-domain.example" : "http://127.0.0.1:3027";
  const infrastructure = [
    `# ${mode === "server" ? "服务器" : "本地"} Docker：保存为项目根 .env，不要提交 Git`,
    "# 【默认】下列值已填好，无端口冲突时不要修改",
    "DEPLOYMENT_PROFILE=full",
    "WORKBENCH_PORT=3027",
    "MYSQL_DATABASE=joto_workbench",
    "MYSQL_USER=joto",
    "OPENSEARCH_EXPOSE_PORT=9200",
    "OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g",
    "",
    "# 【必填】替换为两条不同的长随机密码",
    "MYSQL_PASSWORD=",
    "MYSQL_ROOT_PASSWORD="
  ];
  const business = [
    `# ${mode === "server" ? "服务器" : "本地"} Docker：保存为 .env.local，不要提交 Git`,
    "# 【默认】本地地址已填好；服务器模板已换成 HTTPS 域名占位符",
    `HOSTED_PUBLIC_BASE_URL=${baseUrl}`,
    `HOSTED_EMAIL_OAUTH_REDIRECT_BASE_URL=${baseUrl}`,
    `V5_WORKBENCH_BASE_URL=${baseUrl}`,
    "QWEN_MODEL=qwen-plus",
    "QWEN_EMBEDDING_MODEL=text-embedding-v3",
    "RAG_EMBEDDING_PROVIDER=qwen_embedding",
    "DIRECT_PUBLISH_ENABLED=false",
    "DIRECT_PUBLISH_MOCK=true",
    "",
    "# 【必填】密钥和 Token 保持空值，由部署人员填写真实值"
  ];
  if (selected.has("geo")) business.push(
    "DASHSCOPE_API_KEY=",
    "GEO_RESEARCH_ZHIPU_API_KEY=",
    "GEO_RESEARCH_ZHIPU_MODEL=glm-4-air"
  );
  if (selected.has("email")) business.push(
    "HOSTED_REVIEW_LINK_SECRET=",
    "HOSTED_EMAIL_SETUP_TOKEN=",
    "HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY="
  );
  if (selected.has("wechat")) business.push(
    "WECHAT_MP_APP_ID=",
    "WECHAT_MP_APP_SECRET="
  );
  if (selected.has("browser_publish")) business.push(
    "PUBLISH_EXECUTOR_REGISTRATION_SECRET=",
    "JOTO_PUBLISH_RUNNER_TOKEN=",
    "JOTO_PUBLISH_RUNNER_URL=http://host.docker.internal:9530",
    "WECHATSYNC_BRIDGE_TOKEN="
  );
  if (selected.has("metrics")) business.push("CONTENT_METRICS_RUNNER_TOKEN=");
  if (selected.has("capture")) business.push(
    "HOSTED_CAPTURE_SETUP_TOKEN=",
    "V5_CAPTURE_EXTENSION_ID=",
    "",
    "# 【选填】只填实际启用的供应商或增强服务",
    "GEO_RESEARCH_DOUBAO_API_KEY=",
    "HOSTED_EMAIL_GOOGLE_CLIENT_ID=",
    "HOSTED_EMAIL_GOOGLE_CLIENT_SECRET=",
    "HOSTED_EMAIL_MICROSOFT_CLIENT_ID=",
    "HOSTED_EMAIL_MICROSOFT_CLIENT_SECRET=",
    "SITE_AUDIT_RENDERER_URL=",
    "SITE_AUDIT_RENDERER_TOKEN="
  );
  return [
    { id: "infrastructure", label: "Docker 基础 .env", filename: ".env.example", content: infrastructure.join("\n") + "\n" },
    { id: "business", label: "业务 .env.local", filename: ".env.local.example", content: business.join("\n") + "\n" }
  ];
}

function readApiMessage(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  return String(record.message || nested.message || fallback);
}

export function HostedDeploymentCenter({ senderStatus, senderStatusLoading, onReloadSenderStatus, onSwitchToUserTest }: HostedDeploymentCenterProps) {
  const [mode, setMode] = useState<HostedDeploymentMode>("docker");
  const features = allDeploymentFeatures;
  const templates = useMemo(() => buildTemplates(mode, allDeploymentFeatures), [mode]);
  const [templateId, setTemplateId] = useState("infrastructure");
  const activeTemplate = templates.find((template) => template.id === templateId) || templates[0];
  const [copied, setCopied] = useState(false);
  const [setupToken, setSetupToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string>();
  const [readiness, setReadiness] = useState<ReadinessResult>();

  async function copyTemplate() {
    await navigator.clipboard.writeText(activeTemplate.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadTemplate() {
    const blob = new Blob([activeTemplate.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeTemplate.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function checkReadiness() {
    setChecking(true);
    setCheckError(undefined);
    setReadiness(undefined);
    try {
      const response = await fetch("/api/v5/hosted/deployment-readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, features, setupToken })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(readApiMessage(payload, "部署检查失败。"));
      setReadiness(payload as ReadinessResult);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "部署检查失败。请检查服务端日志。");
    } finally {
      setChecking(false);
    }
  }

  const runtimeFields = mode === "server" ? runtimeServerFields : runtimeDockerFields;
  return (
    <div className={styles.deploymentWorkspace}>
      <main className={styles.deploymentMain}>
        <section className={styles.deploymentScope} aria-labelledby="deployment-scope-title">
          <div className={styles.deploymentScopeIntro}>
            <div><strong id="deployment-scope-title">只需选择部署方式，所有产品能力默认开启</strong><span>邮箱、AI 与 GEO、微信公众号、浏览器渠道、指标回收和 AI 前台采集全部进入配置与验收清单。</span></div>
            <span>全部能力已开启 · {features.length + 1} 个检查组</span>
          </div>
          <div className={styles.deploymentModeGrid}>
            {deploymentModes.map((item) => <button type="button" key={item.id} aria-pressed={mode === item.id} className={mode === item.id ? styles.deploymentChoiceActive : ""} onClick={() => { setMode(item.id); setReadiness(undefined); }}><span>{item.icon}</span><strong>{item.title}</strong><small>{item.description}</small>{mode === item.id ? <CheckCircleFilled /> : null}</button>)}
          </div>
        </section>

        <section className={styles.deploymentSection} id="deployment-runtime">
          <StepHeader number={1} title="准备运行环境和数据库" description="先把基础设施跑通，再添加业务密钥。Docker 的 .env 与业务 .env.local 不是同一个文件。" />
          <div className={styles.deploymentLocationNotice}><DatabaseOutlined /><div><strong>Docker 会分层读取两个配置文件</strong><span>{mode === "server" ? "服务器项目根 .env 管 MySQL、端口和镜像；.env.local 管业务密钥和 HTTPS 域名。修改后重建 Web 容器。" : "项目根 .env 管 MySQL、端口和镜像；.env.local 管 AI、邮箱、GEO 和发布密钥。启动脚本会把允许的业务变量安全传入容器。"}</span></div></div>
          <FieldGrid fields={runtimeFields} />
          <div className={styles.deploymentTemplatePanel}>
            <div className={styles.deploymentTemplateHeader}>
              <div><strong>按当前部署方式生成的全能力脱敏模板</strong><span>模板只有占位符。请在部署环境中替换，不要把真实值上传 GitHub。</span></div>
              <div>{templates.map((template) => <button type="button" key={template.id} className={template.id === activeTemplate.id ? styles.deploymentTemplateTabActive : ""} onClick={() => setTemplateId(template.id)}>{template.label}</button>)}</div>
            </div>
            <pre className={styles.deploymentTemplateCode}>{activeTemplate.content}</pre>
            <div className={styles.deploymentTemplateActions}><Button icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={copyTemplate}>{copied ? "已复制" : "复制当前模板"}</Button><Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载 {activeTemplate.filename}</Button></div>
          </div>
        </section>

        <section className={styles.deploymentSection} id="deployment-ai-geo">
          <StepHeader number={2} title="连接 AI 与 GEO 服务" description="默认用 Qwen 生成和 Embedding，用智谱完成 GEO 语义综合。豆包和独立 Qwen 搜索按需配置。" />
          <FieldGrid fields={aiFields} />
        </section>

        <section className={styles.deploymentSection} id="deployment-email">
          <StepHeader number={3} title="配置邮箱登录与安全链接" description="先配置服务端安全参数，再连接一个系统发件邮箱。普通用户只负责接收邮件。" state={senderStatus?.configured ? "done" : "active"} />
          <>
            <FieldGrid fields={emailFields} />
            <div className={styles.deploymentOauthCallbacks}>
              <strong>OAuth 回调地址必须逐字匹配</strong>
              <code>{`https://你的域名/api/v5/hosted/email-sender/oauth/callback/gmail`}</code>
              <code>{`https://你的域名/api/v5/hosted/email-sender/oauth/callback/outlook`}</code>
            </div>
            <div className={`${styles.deploymentActionCard} ${senderStatus?.configured ? styles.deploymentActionReady : ""}`}>
              {senderStatusLoading ? <Spin size="small" /> : senderStatus?.configured ? <CheckCircleFilled /> : <MailOutlined />}
              <div><strong>{senderStatusLoading ? "正在检查发件邮箱" : senderStatus?.configured ? "发件邮箱已经连接" : "安全参数保存后，继续连接发件邮箱"}</strong><span>{senderStatus?.configured ? `${senderStatus.senderHint || "已连接邮箱"} 可以发送系统邮件。` : "系统会自动识别 Gmail、Outlook、QQ、163 和常见企业邮箱。"}</span></div>
              <Link href="/hosted/email-sender"><Button type={senderStatus?.configured ? "default" : "primary"}>{senderStatus?.configured ? "检查或更换邮箱" : "连接系统发件邮箱"}</Button></Link>
            </div>
          </>
        </section>

        <section className={styles.deploymentSection} id="deployment-publish-runtime">
          <StepHeader number={4} title="启动自动发布执行器" description="Docker Workbench 负责任务编排，Runner 或 Desktop Connector 负责真实浏览器操作。" />
          <>
            <div className={styles.deploymentTopology}>
              <div><CloudServerOutlined /><strong>Docker Workbench</strong><span>接收任务、隔离工作区、保存发布账本</span></div><ArrowRightOutlined /><div><SafetyCertificateOutlined /><strong>Runner Token</strong><span>只允许受信执行器领取任务</span></div><ArrowRightOutlined /><div><LaptopOutlined /><strong>常开执行器</strong><span>打开真实平台页面并等待用户完成安全挑战</span></div>
            </div>
            <FieldGrid fields={publishFields} />
            <div className={styles.deploymentSafetyGate}><LockOutlined /><div><strong>首次部署不得直接开启真实发布</strong><span>保持 DIRECT_PUBLISH_ENABLED=false、DIRECT_PUBLISH_MOCK=true。先完成账号识别和模拟发布，再由部署人员明确切换。</span></div></div>
          </>
        </section>

        <section className={styles.deploymentSection} id="deployment-channels">
          <StepHeader number={5} title="配置发布渠道与增强能力" description="公众号凭证由部署人员设置，浏览器渠道账号由普通用户本人登录。密码和 Cookie 不进入托管前端。" />
          <FieldGrid fields={channelFields} />
          <details className={styles.deploymentAdvanced}>
            <summary><SafetyCertificateOutlined /><span><strong>旧版私有 Bridge 高级配置</strong><small>只有已确认风险并由企业自己维护时才展开</small></span></summary>
            <div><p><strong>推荐方式：</strong>让普通用户通过 Connector 在知乎、CSDN、掘金官方页面登录。验证码、扫码和风控确认必须由账号本人完成。</p><p><strong>不要默认使用：</strong><code>ZHIHU_COOKIE</code>、<code>CSDN_COOKIE</code>、<code>JUEJIN_COOKIE</code> 属于易失效敏感凭证，只能保存在受控部署机的 <code>.env.local</code>，不能进入前端、聊天、文档或 GitHub。</p></div>
          </details>
          <details className={styles.deploymentAdvanced} open>
            <summary><SettingOutlined /><span><strong>增强能力配置</strong><small>指标回收、AI 前台采集、AI 配图和网站渲染</small></span></summary>
            <div>
              <div className={styles.captureInstallGuide} aria-labelledby="capture-install-guide-title">
                <div className={styles.captureInstallHeader}>
                  <ChromeOutlined />
                  <div><strong id="capture-install-guide-title">先安装浏览器扩展，再启动浏览器伴侣</strong><span>只在部署人员维护的 24 小时共享 Windows 电脑操作一次。普通用户不安装，也不接触测试账号。</span></div>
                  <b>部署人员操作</b>
                </div>
                <ol>
                  <li><strong>取得最新扩展包</strong><span>在共享电脑拉取 GitHub <code>main</code>，或下载 main ZIP 并解压。确认目录中存在 <code>browser-extension\manifest.json</code>；不要只选 ZIP 文件。</span></li>
                  <li><strong>打开浏览器扩展管理页</strong><span>Chrome 在地址栏输入 <code>chrome://extensions/</code>，Edge 输入 <code>edge://extensions/</code>；回车后打开“开发者模式”。浏览器内部地址无法由网页按钮直接打开，需要在地址栏手动输入。</span></li>
                  <li><strong>加载已解压的扩展程序</strong><span>点击“加载已解压的扩展程序”，选择整个 <code>&lt;项目根目录&gt;\browser-extension</code> 文件夹。加载成功后应看到 <code>JOTO AI Front Test Companion</code>，建议将它固定到工具栏。</span></li>
                  <li><strong>复制扩展 ID 并配置伴侣</strong><span>在扩展卡片中复制 ID，写入共享电脑的 <code>V5_CAPTURE_EXTENSION_ID</code>；把正式工作台 HTTPS 地址写入 <code>V5_WORKBENCH_BASE_URL</code>。这两个值只属于共享电脑。</span></li>
                  <li><strong>启动本机 Runner</strong><span>在项目根目录运行 <code>npm.cmd run capture-companion:start</code>。保持窗口运行，确认本地 Runner 正在监听 <code>127.0.0.1:17321</code>。</span></li>
                  <li><strong>配对、登录并设置开机运行</strong><span>在下方生成一次性配对码，打开扩展弹窗完成配对；只在该 Chrome Profile 登录共享测试账号。验收采集成功后运行 <code>npm.cmd run capture-companion:autostart</code>。</span></li>
                </ol>
                <div className={styles.captureInstallActions}>
                  <a href="https://github.com/1736280642-Star/gtm-content-growth-workbench/archive/refs/heads/main.zip"><DownloadOutlined /><span><strong>下载最新 main ZIP</strong><small>下载后先完整解压</small></span></a>
                </div>
                <p><InfoCircleOutlined /><span><strong>不要混淆：</strong>浏览器扩展负责打开和采集 AI 官方页面；浏览器伴侣（本机 Runner）负责领取任务、鉴权和回传。两者必须同时在线，关闭伴侣窗口后扩展不能领取新任务。</span></p>
              </div>
              <FieldGrid fields={optionalFields} />
              <HostedAiCaptureDeploymentGuide />
            </div>
          </details>
        </section>

        <section className={styles.deploymentSection} id="deployment-acceptance">
          <StepHeader number={6} title="检查配置并完成交接" description="服务端只返回是否配置和缺失变量名，不返回任何 Secret、Token、API Key 或密码。" />
          <div className={styles.deploymentCheckForm}>
            <label><span>部署级 Setup Token</span><Input.Password value={setupToken} onChange={(event) => setSetupToken(event.target.value)} placeholder="填写 HOSTED_EMAIL_SETUP_TOKEN" /></label>
            <Button type="primary" icon={<ReloadOutlined />} loading={checking} disabled={!setupToken.trim()} onClick={checkReadiness}>检查当前部署</Button>
          </div>
          {checkError ? <div className={styles.deploymentCheckError} role="alert"><InfoCircleOutlined /><span>{checkError}</span></div> : null}
          {readiness ? <div className={styles.deploymentReadinessResult}>
            <div className={styles.deploymentReadinessSummary}><span className={readiness.configurationReady ? styles.deploymentReadinessReady : styles.deploymentReadinessPending}>{readiness.readyGroups}/{readiness.totalGroups}</span><div><strong>{readiness.configurationReady ? "环境变量已经齐全" : "还有配置没有完成"}</strong><span>环境变量齐全不等于真实链路通过。每组下方的人工验收仍需逐项完成。</span></div></div>
            <div className={styles.deploymentReadinessGroups}>{readiness.groups.map((group) => <article key={group.id} className={group.ready ? styles.readinessGroupReady : ""}><span>{group.ready ? <CheckCircleFilled /> : <InfoCircleOutlined />}</span><div><strong>{group.label}</strong><small>{group.ready ? "必填环境变量已配置" : `缺少：${group.missing.join("、")}`}</small><ul>{group.manualChecks.map((check) => <li key={check}>{check}</li>)}</ul></div></article>)}</div>
            {readiness.safety.directPublishEnabled && readiness.safety.directPublishMock ? <div className={styles.deploymentCheckError}><InfoCircleOutlined /><span>检测到真实发布开关已开启，但仍处于 Mock。请先完成模拟验收，不要把这一状态当作可正式发布。</span></div> : null}
          </div> : null}
          <div className={styles.deploymentHandoff}>
            <div><strong>最后做一次真实用户验收</strong><span>部署人员切到普通用户，发送登录邮件、打开一次性链接、创建委托并检查账号连接入口。</span></div>
            <Button type="primary" size="large" icon={<UserOutlined />} disabled={!senderStatus?.configured} onClick={onSwitchToUserTest}>切到普通用户试跑</Button>
            {!senderStatus?.configured ? <small>先完成系统发件邮箱连接，才能验证邮件登录。</small> : null}
          </div>
        </section>
      </main>

      <aside className={styles.deploymentPassport} aria-label="部署完成清单">
        <SafetyCertificateOutlined />
        <h2>部署完成清单</h2>
        <p>{mode === "server" ? "服务器 Docker、HTTPS 域名与常开执行器分项验收。" : "本地基础设施和业务密钥分层配置。"}</p>
        <ol>
          <li><span>1</span><div><strong>运行环境</strong><small>{mode === "server" ? "服务器 Docker、HTTPS、MySQL" : "本地 .env、MySQL、OpenSearch"}</small></div></li>
          <li><span>2</span><div><strong>AI 与 GEO</strong><small>Qwen、Embedding、智谱</small></div></li>
          <li className={senderStatus?.configured ? styles.deploymentPassportDone : ""}><span>{senderStatus?.configured ? <CheckOutlined /> : "3"}</span><div><strong>邮箱与安全链接</strong><small>{senderStatus?.configured ? "发件邮箱已连接" : "等待配置"}</small></div></li>
          <li><span>4</span><div><strong>发布执行器</strong><small>Runner、Token、模拟发布</small></div></li>
          <li><span>5</span><div><strong>渠道账号</strong><small>公众号与浏览器连接</small></div></li>
          <li><span>6</span><div><strong>总体验收</strong><small>{readiness ? `${readiness.readyGroups}/${readiness.totalGroups} 组变量齐全` : "等待检查"}</small></div></li>
        </ol>
        <Button block icon={<ReloadOutlined />} loading={senderStatusLoading} onClick={onReloadSenderStatus}>重新检查发件邮箱</Button>
        <a className={styles.deploymentDocsLink} href="https://github.com/1736280642-Star/gtm-content-growth-workbench/blob/main/.env.local.example" target="_blank" rel="noreferrer"><LinkOutlined /> 查看仓库完整 .env.local.example</a>
      </aside>
    </div>
  );
}

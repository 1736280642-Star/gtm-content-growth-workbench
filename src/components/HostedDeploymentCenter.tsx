"use client";

import {
  ArrowRightOutlined,
  CheckCircleFilled,
  ChromeOutlined,
  CloudServerOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  LaptopOutlined,
  LinkOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserOutlined
} from "@ant-design/icons";
import { Button, Input, Spin } from "antd";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import type { HostedDeploymentFeature, HostedDeploymentMode } from "@/lib/v5/hosted-deployment-readiness";
import styles from "@/app/hosted-mode.module.css";

const HostedAiCaptureDeploymentGuide = dynamic(
  () => import("@/components/HostedAiCaptureDeploymentGuide").then((module) => module.HostedAiCaptureDeploymentGuide),
  {
    ssr: false,
    loading: () => <div className={styles.embeddedConnectionLoading}><Spin /><span>正在加载共享采集服务器控制台</span></div>
  }
);

interface HostedDeploymentCenterProps {
  onSwitchToUserTest: () => void;
}

type Requirement = "required" | "optional";

interface EnvInputField {
  name: string;
  title: string;
  description: string;
  requirement: Requirement;
  source: string;
  sourceUrl?: string;
  placeholder?: string;
  secret?: boolean;
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
}

const requirementLabels: Record<Requirement, string> = {
  required: "必填",
  optional: "选填"
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

const requiredAiFields: EnvInputField[] = [
  { name: "DASHSCOPE_API_KEY", title: "阿里云百炼 API Key", description: "用于 Qwen 内容生成和默认 Embedding。", requirement: "required", secret: true, source: "阿里云百炼控制台创建 API Key。", sourceUrl: "https://help.aliyun.com/zh/model-studio/get-api-key", placeholder: "粘贴百炼 API Key" },
  { name: "GEO_RESEARCH_ZHIPU_API_KEY", title: "智谱 GEO API Key", description: "用于 GEO 联网搜索、证据整合和语义编排。", requirement: "required", secret: true, source: "智谱开放平台创建 API Key。", sourceUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys", placeholder: "粘贴智谱 API Key" }
];

const requiredChannelFields: EnvInputField[] = [
  { name: "WECHAT_MP_APP_ID", title: "微信公众号 AppID", description: "用于识别公众号并调用官方草稿接口。", requirement: "required", source: "微信公众平台 → 设置与开发 → 基本配置。", sourceUrl: "https://mp.weixin.qq.com/", placeholder: "粘贴 AppID" },
  { name: "WECHAT_MP_APP_SECRET", title: "微信公众号 AppSecret", description: "只进入最终 .env.local，不写入浏览器存储。", requirement: "required", secret: true, source: "微信公众平台同一页面生成或重置。", sourceUrl: "https://mp.weixin.qq.com/", placeholder: "粘贴 AppSecret" },
  { name: "V5_CAPTURE_EXTENSION_ID", title: "共享采集扩展 ID", description: "只在部署人员维护的 24 小时 Windows 电脑获取。", requirement: "required", source: "加载扩展后，在 Chrome 扩展管理页复制 ID。", sourceUrl: "https://github.com/1736280642-Star/gtm-content-growth-workbench/archive/refs/heads/main.zip", placeholder: "粘贴扩展 ID" }
];

const optionalProviderFields: EnvInputField[] = [
  { name: "DEEPSEEK_API_KEY", title: "DeepSeek API Key", description: "只有需要切换或增加 DeepSeek 时填写。", requirement: "optional", secret: true, source: "DeepSeek 开放平台 API Keys。", sourceUrl: "https://platform.deepseek.com/api_keys", placeholder: "选填" },
  { name: "DOUBAO_API_KEY", title: "豆包 / 火山方舟 API Key", description: "只有启用豆包生成或事实搜索时填写。", requirement: "optional", secret: true, source: "火山方舟 → 系统管理 → API Key 管理。", sourceUrl: "https://console.volcengine.com/ark", placeholder: "选填" },
  { name: "DOUBAO_MODEL", title: "豆包推理接入点", description: "填写已开通的 Endpoint ID；未启用豆包则留空。", requirement: "optional", source: "火山方舟在线推理页面。", sourceUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint", placeholder: "例如 ep-..." },
  { name: "GEO_RESEARCH_QWEN_API_KEY", title: "独立 Qwen GEO Key", description: "留空时自动复用百炼 Key，仅供应商隔离或独立计费时填写。", requirement: "optional", secret: true, source: "与百炼 API Key 使用相同入口。", sourceUrl: "https://help.aliyun.com/zh/model-studio/get-api-key", placeholder: "选填" }
];

const optionalEnhancementFields: EnvInputField[] = [
  { name: "WECHAT_MP_THUMB_MEDIA_ID", title: "公众号永久封面 media_id", description: "与本地图片路径二选一；已有素材库封面时填写。", requirement: "optional", source: "微信公众号素材库。", sourceUrl: "https://mp.weixin.qq.com/", placeholder: "选填，二选一" },
  { name: "WECHAT_MP_THUMB_IMAGE_PATH", title: "公众号本地封面路径", description: "与 media_id 二选一；填写部署机上可读取的图片路径。", requirement: "optional", source: "由部署人员准备合规封面文件，无需外部密钥。", placeholder: "选填，二选一" },
  { name: "XCRAWL_API_KEY", title: "XCrawl 抓取 API Key", description: "需要增强官网和博客抓取时填写。", requirement: "optional", secret: true, source: "XCrawl 服务控制台。", sourceUrl: "https://www.xcrawl.com/", placeholder: "选填" },
  { name: "WECHAT_VISUAL_IMAGE_BASE_URL", title: "AI 配图 Base URL", description: "只有启用 OpenAI-compatible 封面生成时填写。", requirement: "optional", source: "由所选图片模型服务商提供。", placeholder: "选填" },
  { name: "WECHAT_VISUAL_IMAGE_API_KEY", title: "AI 配图 API Key", description: "与配图 Base URL 和模型成组填写。", requirement: "optional", secret: true, source: "由所选图片模型服务商提供。", placeholder: "选填" },
  { name: "WECHAT_VISUAL_IMAGE_MODEL", title: "AI 配图模型", description: "填写服务商支持的图片模型名。", requirement: "optional", source: "由所选图片模型服务商提供。", placeholder: "选填" },
  { name: "SITE_AUDIT_RENDERER_URL", title: "网站 Renderer URL", description: "只有需要审计大量客户端渲染页面时填写。", requirement: "optional", source: "由自建或企业浏览器渲染服务提供。", placeholder: "选填" },
  { name: "SITE_AUDIT_RENDERER_TOKEN", title: "网站 Renderer Token", description: "与 Renderer URL 成对填写。", requirement: "optional", secret: true, source: "由同一渲染服务提供。", placeholder: "选填" }
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

function EnvFieldForm({ fields, values, onChange }: { fields: EnvInputField[]; values: Record<string, string>; onChange: (name: string, value: string) => void }) {
  return (
    <div className={styles.deploymentEnvFieldList}>
      {fields.map((field) => (
        <label className={styles.deploymentEnvField} key={field.name}>
          <span className={styles.deploymentEnvFieldHeading}><span><strong>{field.title}</strong><code>{field.name}</code></span><b className={styles[`requirement-${field.requirement}`]}>{requirementLabels[field.requirement]}</b></span>
          <span className={styles.deploymentEnvFieldInput}>{field.secret
            ? <Input.Password value={values[field.name] || ""} onChange={(event) => onChange(field.name, event.target.value)} placeholder={field.placeholder} autoComplete="off" required={field.requirement === "required"} />
            : <Input value={values[field.name] || ""} onChange={(event) => onChange(field.name, event.target.value)} placeholder={field.placeholder} autoComplete="off" required={field.requirement === "required"} />}</span>
          <span className={styles.deploymentEnvFieldHelp}><span>{field.description}</span><small>{field.source}</small>{field.sourceUrl ? <a href={field.sourceUrl} target="_blank" rel="noreferrer">打开获取页面 <ArrowRightOutlined /></a> : null}</span>
        </label>
      ))}
    </div>
  );
}

function readApiMessage(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  return String(record.message || nested.message || fallback);
}

export function HostedDeploymentCenter({ onSwitchToUserTest }: HostedDeploymentCenterProps) {
  const [mode, setMode] = useState<HostedDeploymentMode>("docker");
  const features = allDeploymentFeatures;
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string>();
  const [readiness, setReadiness] = useState<ReadinessResult>();
  const [readinessTokenOverride, setReadinessTokenOverride] = useState("");
  const readinessToken = readinessTokenOverride.trim();

  function updateEnvValue(name: string, value: string) {
    setEnvValues((current) => ({ ...current, [name]: value }));
    setReadiness(undefined);
  }

  async function checkReadiness() {
    setChecking(true);
    setCheckError(undefined);
    setReadiness(undefined);
    try {
      const response = await fetch("/api/v5/hosted/deployment-readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, features, setupToken: readinessToken })
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

  return (
    <div className={styles.deploymentWorkspace}>
      <main className={styles.deploymentMain}>
        <section className={styles.deploymentScope} aria-labelledby="deployment-scope-title">
          <div className={styles.deploymentScopeIntro}>
            <div><strong id="deployment-scope-title">只需选择部署方式，所有产品能力默认开启</strong><span>这里只展示仍需部署人员填写或验收的配置。</span></div>
            <span>3 个用户操作步骤</span>
          </div>
          <div className={styles.deploymentModeGrid}>
            {deploymentModes.map((item) => <button type="button" key={item.id} aria-pressed={mode === item.id} className={mode === item.id ? styles.deploymentChoiceActive : ""} onClick={() => { setMode(item.id); setReadiness(undefined); }}><span>{item.icon}</span><strong>{item.title}</strong><small>{item.description}</small>{mode === item.id ? <CheckCircleFilled /> : null}</button>)}
          </div>
        </section>

        <section className={styles.deploymentSection} id="deployment-ai-geo">
          <StepHeader number={1} title="填写 AI 与 GEO 凭证" description="只需粘贴两条必填 Key。Qwen 模型、Embedding 模型、Base URL 和智谱参数全部使用安全默认值。" />
          <EnvFieldForm fields={requiredAiFields} values={envValues} onChange={updateEnvValue} />
          <details className={styles.deploymentAdvanced}>
            <summary><SettingOutlined /><span><strong>选填：增加其他 AI Provider</strong><small>不启用 DeepSeek、豆包或独立 Qwen 时完全不用填写</small></span></summary>
            <div><EnvFieldForm fields={optionalProviderFields} values={envValues} onChange={updateEnvValue} /></div>
          </details>
        </section>

        <section className={styles.deploymentSection} id="deployment-channels">
          <StepHeader number={2} title="填写渠道必需信息" description="只填写公众号官方凭证和共享采集扩展 ID。知乎、CSDN、掘金仍在官方页面登录，不填写 Cookie。" />
          <EnvFieldForm fields={requiredChannelFields} values={envValues} onChange={updateEnvValue} />
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
              <details className={styles.deploymentAdvanced}>
                <summary><SettingOutlined /><span><strong>选填：封面、抓取、配图和网站渲染</strong><small>不启用对应增强能力时全部留空</small></span></summary>
                <div><EnvFieldForm fields={optionalEnhancementFields} values={envValues} onChange={updateEnvValue} /></div>
              </details>
              <HostedAiCaptureDeploymentGuide />
            </div>
          </details>
        </section>

        <section className={styles.deploymentSection} id="deployment-acceptance">
          <StepHeader number={3} title="检查配置并完成交接" description="服务端只返回是否配置和缺失变量名，不返回任何 Secret、Token、API Key 或密码。" />
          <div className={styles.deploymentCheckForm}>
            <div><strong>现在做什么</strong><span>粘贴当前部署使用的 Setup Token，再检查数据库、AI、邮箱和发布链路。</span></div>
            <Button type="primary" icon={<ReloadOutlined />} loading={checking} disabled={!readinessToken} onClick={checkReadiness}>检查当前部署</Button>
          </div>
          <details className={styles.deploymentAdvanced}>
            <summary><LockOutlined /><span><strong>填写部署检查口令</strong><small>从当前 .env.local 中复制 HOSTED_EMAIL_SETUP_TOKEN</small></span></summary>
            <div className={styles.deploymentExistingToken}><Input.Password value={readinessTokenOverride} onChange={(event) => { setReadinessTokenOverride(event.target.value); setReadiness(undefined); }} placeholder="当前环境的 HOSTED_EMAIL_SETUP_TOKEN" autoComplete="off" /><small>口令只随本次检查请求发送，不写入浏览器存储。</small></div>
          </details>
          {checkError ? <div className={styles.deploymentCheckError} role="alert"><InfoCircleOutlined /><span>{checkError}</span></div> : null}
          {readiness ? <div className={styles.deploymentReadinessResult}>
            <div className={styles.deploymentReadinessSummary}><span className={readiness.configurationReady ? styles.deploymentReadinessReady : styles.deploymentReadinessPending}>{readiness.readyGroups}/{readiness.totalGroups}</span><div><strong>{readiness.configurationReady ? "环境变量已经齐全" : "还有配置没有完成"}</strong><span>环境变量齐全不等于真实链路通过。每组下方的人工验收仍需逐项完成。</span></div></div>
            <div className={styles.deploymentReadinessGroups}>{readiness.groups.map((group) => <article key={group.id} className={group.ready ? styles.readinessGroupReady : ""}><span>{group.ready ? <CheckCircleFilled /> : <InfoCircleOutlined />}</span><div><strong>{group.label}</strong><small>{group.ready ? "必填环境变量已配置" : `缺少：${group.missing.join("、")}`}</small><ul>{group.manualChecks.map((check) => <li key={check}>{check}</li>)}</ul></div></article>)}</div>
            {readiness.safety.directPublishEnabled && readiness.safety.directPublishMock ? <div className={styles.deploymentCheckError}><InfoCircleOutlined /><span>检测到真实发布开关已开启，但仍处于 Mock。请先完成模拟验收，不要把这一状态当作可正式发布。</span></div> : null}
          </div> : null}
          <div className={styles.deploymentHandoff}>
            <div><strong>最后做一次真实用户验收</strong><span>部署人员切到普通用户，发送登录邮件、打开一次性链接、创建委托并检查账号连接入口。</span></div>
            <Button type="primary" size="large" icon={<UserOutlined />} onClick={onSwitchToUserTest}>切到普通用户试跑</Button>
          </div>
        </section>
      </main>

      <aside className={styles.deploymentPassport} aria-label="部署完成清单">
        <SafetyCertificateOutlined />
        <h2>部署完成清单</h2>
        <p>{mode === "server" ? "服务器上的 AI、渠道与整体能力分项验收。" : "本地业务能力按顺序配置与验收。"}</p>
        <ol>
          <li><span>1</span><div><strong>AI 与 GEO</strong><small>Qwen、Embedding、智谱</small></div></li>
          <li><span>2</span><div><strong>渠道账号</strong><small>公众号与浏览器连接</small></div></li>
          <li><span>3</span><div><strong>总体验收</strong><small>{readiness ? `${readiness.readyGroups}/${readiness.totalGroups} 组变量齐全` : "等待检查"}</small></div></li>
        </ol>
        <a className={styles.deploymentDocsLink} href="https://github.com/1736280642-Star/gtm-content-growth-workbench/blob/main/.env.local.example" target="_blank" rel="noreferrer"><LinkOutlined /> 查看仓库完整 .env.local.example</a>
      </aside>
    </div>
  );
}

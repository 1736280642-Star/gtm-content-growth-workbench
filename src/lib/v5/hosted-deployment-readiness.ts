import { getDeploymentRuntimeEnvironment } from "./deployment-ai-config";

export type HostedDeploymentMode = "docker" | "server";

export type HostedDeploymentFeature =
  | "email"
  | "geo"
  | "wechat"
  | "browser_publish"
  | "metrics"
  | "capture";

export interface HostedDeploymentReadinessGroup {
  id: string;
  label: string;
  required: string[];
  missing: string[];
  ready: boolean;
  manualChecks: string[];
}

const MODE_REQUIREMENTS: Record<HostedDeploymentMode, string[]> = {
  docker: ["MYSQL_PASSWORD"],
  server: ["MYSQL_PASSWORD"]
};

const FEATURE_REQUIREMENTS: Record<HostedDeploymentFeature, {
  label: string;
  required: string[];
  manualChecks: string[];
}> = {
  email: {
    label: "邮箱登录与安全链接",
    required: [
      "HOSTED_PUBLIC_BASE_URL",
      "HOSTED_REVIEW_LINK_SECRET",
      "HOSTED_EMAIL_SETUP_TOKEN",
      "HOSTED_EMAIL_CREDENTIAL_ENCRYPTION_KEY"
    ],
    manualChecks: ["连接系统发件邮箱", "发送并打开一封真实登录邮件"]
  },
  geo: {
    label: "AI 内容与 GEO 调研",
    required: ["DASHSCOPE_API_KEY", "GEO_RESEARCH_ZHIPU_API_KEY"],
    manualChecks: ["调用一次内容生成预检", "完成一次 GEO 搜索预检"]
  },
  wechat: {
    label: "微信公众号",
    required: ["WECHAT_MP_APP_ID", "WECHAT_MP_APP_SECRET"],
    manualChecks: ["识别公众号名称", "创建一篇测试草稿"]
  },
  browser_publish: {
    label: "浏览器渠道自动发布",
    required: ["PUBLISH_EXECUTOR_REGISTRATION_SECRET", "JOTO_PUBLISH_RUNNER_TOKEN"],
    manualChecks: ["发布 Runner 在线", "知乎、CSDN、掘金账号由用户在官方页面登录", "模拟发布通过"]
  },
  metrics: {
    label: "内容指标自动回收",
    required: ["CONTENT_METRICS_RUNNER_TOKEN"],
    manualChecks: ["指标 Runner 在线", "至少一个渠道返回真实指标"]
  },
  capture: {
    label: "AI 前台共享采集",
    required: ["HOSTED_CAPTURE_SETUP_TOKEN"],
    manualChecks: ["常开 Windows 伴侣在线", "浏览器扩展已绑定", "至少一个 AI 测试账号可用"]
  }
};

function isConfigured(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) return false;
  return !/^(replace-with|change-me|example|password|your[-_])/i.test(value);
}

export function evaluateHostedDeploymentReadiness(input: {
  mode: HostedDeploymentMode;
  features: HostedDeploymentFeature[];
  environment?: NodeJS.ProcessEnv;
}) {
  const environment = input.environment || getDeploymentRuntimeEnvironment();
  const runtimeRequired = MODE_REQUIREMENTS[input.mode];
  const groups: HostedDeploymentReadinessGroup[] = [
    {
      id: "runtime",
      label: input.mode === "server" ? "服务器 Docker 运行环境与数据库" : "本地 Docker 运行环境与数据库",
      required: runtimeRequired,
      missing: runtimeRequired.filter((name) => !isConfigured(environment, name)),
      ready: runtimeRequired.every((name) => isConfigured(environment, name)),
      manualChecks: input.mode === "server"
        ? ["服务器 Docker 健康检查通过", "HTTPS 域名可从公网访问", "MySQL 与 OpenSearch 容器健康"]
        : ["本地 Docker 健康检查通过", "MySQL 与 OpenSearch 容器健康"]
    }
  ];

  for (const feature of input.features) {
    const definition = FEATURE_REQUIREMENTS[feature];
    const missing = definition.required.filter((name) => !isConfigured(environment, name));
    groups.push({
      id: feature,
      label: definition.label,
      required: definition.required,
      missing,
      ready: missing.length === 0,
      manualChecks: definition.manualChecks
    });
  }

  return {
    groups,
    readyGroups: groups.filter((group) => group.ready).length,
    totalGroups: groups.length,
    configurationReady: groups.every((group) => group.ready),
    safety: {
      directPublishEnabled: environment.DIRECT_PUBLISH_ENABLED === "true",
      directPublishMock: environment.DIRECT_PUBLISH_MOCK !== "false"
    }
  };
}

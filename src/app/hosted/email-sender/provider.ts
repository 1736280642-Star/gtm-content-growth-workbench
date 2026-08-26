export type HostedEmailProvider = "qq" | "163" | "aliyun" | "gmail" | "outlook";

export interface HostedEmailProviderDetail {
  key: HostedEmailProvider;
  name: string;
  method: string;
  description: string;
}

export const hostedEmailProviderDetails: Record<HostedEmailProvider, HostedEmailProviderDetail> = {
  qq: {
    key: "qq",
    name: "QQ 邮箱",
    method: "SMTP 授权码",
    description: "在 QQ 邮箱设置中开启 SMTP，并使用授权码连接。"
  },
  "163": {
    key: "163",
    name: "163 邮箱",
    method: "SMTP 授权码",
    description: "在 163 邮箱设置中开启 SMTP，并使用客户端授权密码连接。"
  },
  aliyun: {
    key: "aliyun",
    name: "阿里云企业邮箱",
    method: "SMTP 安全密码",
    description: "在阿里邮箱开启第三方客户端 SMTP，并使用独立的客户端安全密码连接。"
  },
  gmail: {
    key: "gmail",
    name: "Gmail",
    method: "Google OAuth",
    description: "跳转 Google，只授权发送邮件，不读取收件箱。"
  },
  outlook: {
    key: "outlook",
    name: "Outlook",
    method: "Microsoft OAuth",
    description: "跳转 Microsoft，只授予发信与确认账号所需的权限。"
  }
};

const providerByDomain: Record<string, HostedEmailProvider> = {
  "qq.com": "qq",
  "163.com": "163",
  "jotoglobal.com": "aliyun",
  "gmail.com": "gmail",
  "googlemail.com": "gmail",
  "outlook.com": "outlook",
  "hotmail.com": "outlook",
  "live.com": "outlook",
  "msn.com": "outlook"
};

export function detectHostedEmailProvider(email: string) {
  const normalized = email.trim().toLocaleLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) return undefined;
  const separator = normalized.lastIndexOf("@");
  const domain = normalized.slice(separator + 1);
  return providerByDomain[domain];
}

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "内容自动化 | JOTO GTM 工作台",
  description: "查看正在生成、排程、发布和归档的内容任务。"
};

export default function ContentAutomationLayout({ children }: { children: ReactNode }) {
  return children;
}
